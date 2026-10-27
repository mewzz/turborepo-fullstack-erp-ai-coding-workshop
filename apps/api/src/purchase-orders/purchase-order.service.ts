import { Injectable } from '@nestjs/common';
import type {
  CreatePurchaseOrder,
  PurchaseOrder,
  UpdatePurchaseOrder,
  User,
} from '@erp/contracts';
import { ORPCError } from '@orpc/nest';
import { PrismaService } from '../database/prisma.service.js';
import {
  nextStatus,
  type PurchaseOrderAction,
  type TransitionActor,
} from './purchase-order-transitions.js';

/** A stored line, where purchasePrice is a Decimal we serialize to a number for the contract. */
type LineRow = {
  id: string;
  productId: string;
  productName: string;
  purchasePrice: { toString(): string };
  quantity: number;
};

/** A stored order with its lines joined, as Prisma returns it. */
type OrderRow = Omit<PurchaseOrder, 'lines'> & { lines: LineRow[] };

const MESSAGES = {
  notFound: 'ไม่พบใบสั่งซื้อ',
  notDraft: 'แก้ไขได้เฉพาะใบสั่งซื้อที่เป็นแบบร่างเท่านั้น',
  notOwner: 'แก้ไขได้เฉพาะใบสั่งซื้อที่คุณเป็นผู้สร้างเท่านั้น',
  unknownProduct: 'มีสินค้าในรายการที่ไม่พบหรือถูกปิดการใช้งาน',
};

/**
 * The purchase-order lifecycle (T5): create and edit drafts, and run the guarded transitions. No
 * method here posts a stock movement — the lifecycle is stock-neutral (PO-02); goods receiving
 * (T6) is the module that will. Line product name and price are snapshotted at creation so later
 * catalogue edits never rewrite history.
 */
@Injectable()
export class PurchaseOrderService {
  constructor(private readonly prisma: PrismaService) {}

  /** The contract exposes purchasePrice as a number; Prisma stores it as a Decimal. */
  private toOrder(row: OrderRow): PurchaseOrder {
    return {
      ...row,
      lines: row.lines.map((line) => ({
        ...line,
        purchasePrice: Number(line.purchasePrice.toString()),
      })),
    };
  }

  /** Snapshot the name and price for each requested line, rejecting unknown or inactive products. */
  private async snapshotLines(lines: CreatePurchaseOrder['lines']) {
    const products = await this.prisma.product.findMany({
      where: { id: { in: lines.map((line) => line.productId) } },
      select: { id: true, name: true, active: true },
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
        purchasePrice: line.purchasePrice,
        quantity: line.quantity,
      };
    });
  }

  /** Next document number, "PO-0001" style, from the current count. */
  private async nextNumber(): Promise<string> {
    const count = await this.prisma.purchaseOrder.count();
    return `PO-${String(count + 1).padStart(4, '0')}`;
  }

  async create(input: CreatePurchaseOrder, user: User): Promise<PurchaseOrder> {
    const lines = await this.snapshotLines(input.lines);
    const number = await this.nextNumber();
    const row = await this.prisma.purchaseOrder.create({
      data: {
        number,
        supplierId: input.supplierId,
        destinationStoreId: input.destinationStoreId,
        expectedReceiptDate: input.expectedReceiptDate,
        status: 'DRAFT',
        createdById: user.id,
        lines: { create: lines },
      },
      include: { lines: true },
    });
    return this.toOrder(row as OrderRow);
  }

  async update(input: UpdatePurchaseOrder, user: User): Promise<PurchaseOrder> {
    const existing = await this.prisma.purchaseOrder.findUnique({ where: { id: input.id } });
    if (!existing) throw new ORPCError('NOT_FOUND', { message: MESSAGES.notFound });
    if (existing.createdById !== user.id) {
      throw new ORPCError('FORBIDDEN', { message: MESSAGES.notOwner });
    }
    if (existing.status !== 'DRAFT') {
      throw new ORPCError('BAD_REQUEST', { message: MESSAGES.notDraft });
    }

    const lines = await this.snapshotLines(input.lines);
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: input.id } });
      return tx.purchaseOrder.update({
        where: { id: input.id },
        data: {
          supplierId: input.supplierId,
          destinationStoreId: input.destinationStoreId,
          expectedReceiptDate: input.expectedReceiptDate,
          lines: { create: lines },
        },
        include: { lines: true },
      });
    });
    return this.toOrder(row as OrderRow);
  }

  async get(id: string): Promise<PurchaseOrder> {
    const row = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!row) throw new ORPCError('NOT_FOUND', { message: MESSAGES.notFound });
    return this.toOrder(row as OrderRow);
  }

  async list(): Promise<PurchaseOrder[]> {
    const rows = await this.prisma.purchaseOrder.findMany({
      include: { lines: true },
      orderBy: { number: 'desc' },
    });
    return rows.map((row) => this.toOrder(row as OrderRow));
  }

  /**
   * Run a guarded transition. Loads the order, derives the actor's role and authorship, validates
   * the move with the pure `nextStatus` guard (which throws FORBIDDEN or BAD_REQUEST), then writes
   * the new status and the reason, if any. Never posts a stock movement (PO-02).
   */
  async transition(
    action: PurchaseOrderAction,
    input: { id: string; reason?: string },
    user: User,
  ): Promise<PurchaseOrder> {
    const existing = await this.prisma.purchaseOrder.findUnique({ where: { id: input.id } });
    if (!existing) throw new ORPCError('NOT_FOUND', { message: MESSAGES.notFound });

    const actor: TransitionActor = {
      role: user.role,
      isCreator: existing.createdById === user.id,
    };
    const status = nextStatus(action, existing.status, actor, input.reason);

    const row = await this.prisma.purchaseOrder.update({
      where: { id: input.id },
      data: { status, reason: input.reason ?? null },
      include: { lines: true },
    });
    return this.toOrder(row as OrderRow);
  }
}
