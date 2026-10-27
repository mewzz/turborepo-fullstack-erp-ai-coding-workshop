import { Injectable } from '@nestjs/common';
import type { ConfirmSale, CreateSale, Sale, User } from '@erp/contracts';
import { ORPCError } from '@orpc/nest';
import { PrismaService } from '../database/prisma.service.js';
import { StockMovementService } from '../inventory/stock-movement.service.js';

const DOCUMENT_TYPE = 'SALE';

const MESSAGES = {
  notFound: 'ไม่พบรายการขาย',
  forbidden: 'บันทึกการขายได้เฉพาะร้านที่คุณรับผิดชอบเท่านั้น',
  unknownProduct: 'มีสินค้าในรายการที่ไม่พบหรือถูกปิดการใช้งาน',
  notDraft: 'ยืนยันได้เฉพาะรายการขายที่เป็นแบบร่างเท่านั้น',
  keyReused: 'รหัสป้องกันการทำรายการซ้ำนี้ถูกใช้กับรายการอื่นแล้ว',
  /** Prefix for the short-stock rejection; the affected product names follow (AC-05). */
  shortStock: 'สต็อกไม่พอสำหรับสินค้า',
};

/** A stored line, where unitPrice is a Decimal we serialize to a number for the contract. */
interface LineRow {
  id: string;
  productId: string;
  productName: string;
  unitPrice: { toString(): string };
  quantity: number;
}

/** A stored sale with its lines joined, as Prisma returns it. */
interface SaleRow {
  id: string;
  number: string | null;
  storeId: string;
  status: Sale['status'];
  createdById: string;
  confirmedAt: Date | string | null;
  lines: LineRow[];
}

/** The human-facing sale number for a database sequence value, e.g. 1 becomes "SALE-0001". */
function formatNumber(sequence: bigint | number): string {
  return `SALE-${String(sequence).padStart(4, '0')}`;
}

/**
 * Sales (T7): store employees record draft sales and confirm them, decreasing stock.
 *
 * A draft has no stock effect (SAL-02). `confirm` runs in one transaction: it dedupes on the
 * idempotency key (a retry returns the original sale, never a second deduction — SAL-03), validates
 * the latest stock for every line and rejects the whole document naming any short product (no
 * partial posting — AC-05), then generates a document number, records the sale and posts one SALE
 * ledger movement per line through the shared primitive on the same transaction — all or nothing
 * (AC-06). Concurrency safety comes from that primitive's optimistic lock: a racing confirm that
 * read a stale balance loses and is rejected (INV-04, AC-07). A confirmed sale is terminal: it is
 * viewable but never edited, cancelled or returned (SAL-04).
 */
@Injectable()
export class SaleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly movements: StockMovementService,
  ) {}

  private toSale(row: SaleRow): Sale {
    return {
      id: row.id,
      number: row.number,
      storeId: row.storeId,
      status: row.status,
      createdById: row.createdById,
      confirmedAt:
        row.confirmedAt instanceof Date ? row.confirmedAt.toISOString() : (row.confirmedAt ?? null),
      lines: row.lines.map((line) => ({
        id: line.id,
        productId: line.productId,
        productName: line.productName,
        unitPrice: Number(line.unitPrice.toString()),
        quantity: line.quantity,
      })),
    };
  }

  /** A store employee may act only on their assigned store; no other role records sales (SAL-01). */
  private assertCanSell(user: User, storeId: string): void {
    if (user.role !== 'STORE_EMPLOYEE' || !user.storeId || user.storeId !== storeId) {
      throw new ORPCError('FORBIDDEN', { message: MESSAGES.forbidden });
    }
  }

  /**
   * Who may view a sale for `storeId`. A store employee sees only their assigned store; every other
   * role sees any store. Kept consistent with `list` so a role can never see a sale in the list it
   * is then forbidden to open.
   */
  private canView(user: User, storeId: string): boolean {
    return user.role !== 'STORE_EMPLOYEE' || (!!user.storeId && user.storeId === storeId);
  }

  /** Snapshot the name and current selling price for each line, rejecting unknown/inactive products. */
  private async snapshotLines(lines: CreateSale['lines']) {
    const products = await this.prisma.product.findMany({
      where: { id: { in: lines.map((line) => line.productId) } },
      select: { id: true, name: true, sellingPrice: true, active: true },
    });
    const byId = new Map(products.map((product) => [product.id, product]));
    return lines.map((line) => {
      const product = byId.get(line.productId);
      if (!product || !product.active) {
        throw new ORPCError('BAD_REQUEST', { message: MESSAGES.unknownProduct });
      }
      return {
        productId: line.productId,
        productName: product.name,
        unitPrice: Number(product.sellingPrice.toString()),
        quantity: line.quantity,
      };
    });
  }

  async create(input: CreateSale, user: User): Promise<Sale> {
    this.assertCanSell(user, input.storeId);
    const lines = await this.snapshotLines(input.lines);
    const row = await this.prisma.sale.create({
      data: {
        storeId: input.storeId,
        status: 'DRAFT',
        createdById: user.id,
        lines: { create: lines },
      },
      include: { lines: true },
    });
    return this.toSale(row);
  }

  async get(id: string, user: User): Promise<Sale> {
    const row = await this.prisma.sale.findUnique({ where: { id }, include: { lines: true } });
    if (!row) throw new ORPCError('NOT_FOUND', { message: MESSAGES.notFound });
    if (!this.canView(user, row.storeId)) {
      throw new ORPCError('FORBIDDEN', { message: MESSAGES.forbidden });
    }
    return this.toSale(row);
  }

  async list(user: User): Promise<Sale[]> {
    // A store employee sees their own store only; with no assigned store they see nothing. Every
    // other role sees all stores — matching `canView`, so the list never shows a sale `get` denies.
    if (user.role === 'STORE_EMPLOYEE' && !user.storeId) return [];
    const rows = await this.prisma.sale.findMany({
      where: user.role === 'STORE_EMPLOYEE' ? { storeId: user.storeId! } : {},
      include: { lines: true },
      orderBy: [{ createdAt: 'desc' }],
    });
    return rows.map((row) => this.toSale(row));
  }

  async confirm(input: ConfirmSale, user: User): Promise<Sale> {
    const row = await this.prisma.$transaction(async (tx) => {
      // A replay returns the original sale, with no second deduction (SAL-03).
      const existing = await tx.idempotencyKey.findUnique({ where: { key: input.idempotencyKey } });
      if (existing) {
        const original = await tx.sale.findUnique({
          where: { id: existing.documentId },
          include: { lines: true },
        });
        if (!original || existing.documentType !== DOCUMENT_TYPE || original.id !== input.id) {
          throw new ORPCError('CONFLICT', { message: MESSAGES.keyReused });
        }
        this.assertCanSell(user, original.storeId);
        return original;
      }

      const sale = await tx.sale.findUnique({ where: { id: input.id }, include: { lines: true } });
      if (!sale) throw new ORPCError('NOT_FOUND', { message: MESSAGES.notFound });
      this.assertCanSell(user, sale.storeId);
      if (sale.status !== 'DRAFT') {
        throw new ORPCError('BAD_REQUEST', { message: MESSAGES.notDraft });
      }

      // Validate the latest stock for every line and reject the whole document if any is short,
      // naming the affected products — no partial posting (AC-05).
      const balances = await tx.stockBalance.findMany({
        where: {
          storeId: sale.storeId,
          productId: { in: sale.lines.map((line) => line.productId) },
        },
      });
      const onHand = new Map(balances.map((balance) => [balance.productId, balance.quantity]));
      const short = sale.lines.filter((line) => (onHand.get(line.productId) ?? 0) < line.quantity);
      if (short.length > 0) {
        const names = short.map((line) => line.productName).join(', ');
        throw new ORPCError('CONFLICT', { message: `${MESSAGES.shortStock}: ${names}` });
      }

      const [sequence] = await tx.$queryRaw<
        { n: bigint }[]
      >`SELECT nextval('sale_number_seq') AS n`;
      const number = formatNumber(sequence!.n);

      const updated = await tx.sale.update({
        where: { id: sale.id },
        data: { status: 'CONFIRMED', number, confirmedAt: new Date() },
        include: { lines: true },
      });

      await tx.idempotencyKey.create({
        data: { key: input.idempotencyKey, documentType: DOCUMENT_TYPE, documentId: sale.id },
      });

      // Decrease stock through the shared primitive on this same transaction, so the sale, its key
      // and every movement commit or roll back together (AC-06). A stale-balance race here is
      // rejected by the primitive's optimistic lock (INV-04, AC-07).
      for (const line of sale.lines) {
        await this.movements.postMovement(
          {
            productId: line.productId,
            storeId: sale.storeId,
            delta: -line.quantity,
            type: 'SALE',
            sourceDocument: number,
            actorId: user.id,
          },
          tx,
        );
      }

      return updated;
    });

    return this.toSale(row);
  }
}
