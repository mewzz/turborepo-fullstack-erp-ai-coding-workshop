import { Injectable } from '@nestjs/common';
import { isReceivable } from '@erp/contracts';
import type {
  GoodsReceipt,
  PurchaseOrderStatus,
  ReceiveGoods,
  ReceivingSummary,
  User,
} from '@erp/contracts';
import { ORPCError } from '@orpc/nest';
import { isUniqueViolation } from '../database/prisma-errors.js';
import { PrismaService } from '../database/prisma.service.js';
import { StockMovementService } from '../inventory/stock-movement.service.js';

const DOCUMENT_TYPE = 'GOODS_RECEIPT';

const MESSAGES = {
  orderNotFound: 'ไม่พบใบสั่งซื้อ',
  receiptNotFound: 'ไม่พบใบรับสินค้า',
  forbidden: 'ไม่สามารถรับสินค้าของร้านอื่นได้',
  notReceivable: 'รับสินค้าได้เฉพาะใบสั่งซื้อที่อนุมัติแล้วหรือรับบางส่วนเท่านั้น',
  notOnOrder: 'มีสินค้าที่ไม่อยู่ในใบสั่งซื้อ',
  overReceive: 'จำนวนที่รับรวมแล้วเกินจำนวนที่สั่งซื้อ',
  keyReused: 'รหัสป้องกันการทำรายการซ้ำนี้ถูกใช้กับรายการอื่นแล้ว',
};

/** A stored order line, as far as receiving needs it. */
interface OrderLineRow {
  productId: string;
  productName: string;
  quantity: number;
}

interface OrderRow {
  id: string;
  number: string;
  destinationStoreId: string;
  status: PurchaseOrderStatus;
  lines: OrderLineRow[];
}

interface ReceiptRow {
  id: string;
  number: string;
  purchaseOrderId: string;
  storeId: string;
  receivedById: string;
  receivedAt: Date;
  lines: { productId: string; productName: string; quantity: number }[];
}

/** Statuses a store can still receive against (GR-01). */
/** The human-facing receipt number for a database sequence value, e.g. 1 becomes "GR-0001". */
function formatNumber(sequence: bigint | number): string {
  return `GR-${String(sequence).padStart(4, '0')}`;
}

/**
 * Goods receiving (T6): partial, idempotent and concurrency-safe receipts against approved orders.
 *
 * `receive` takes a row lock on the order (`SELECT … FOR UPDATE`) so racing requests for the same
 * order run one after another, then — in the same transaction — re-reads what has been received,
 * checks the new quantities fit, writes the receipt, records the idempotency key, posts one ledger
 * movement per received line through the shared primitive, and advances the order status. Any
 * failure rolls all of it back. There is deliberately no edit or cancel method (GR-05).
 */
@Injectable()
export class GoodsReceiptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly movements: StockMovementService,
  ) {}

  private toReceipt(row: ReceiptRow): GoodsReceipt {
    return {
      id: row.id,
      number: row.number,
      purchaseOrderId: row.purchaseOrderId,
      storeId: row.storeId,
      receivedById: row.receivedById,
      receivedAt: row.receivedAt.toISOString(),
      lines: row.lines.map((line) => ({
        productId: line.productId,
        productName: line.productName,
        quantity: line.quantity,
      })),
    };
  }

  /** A store employee may only touch their assigned store; other roles are not store-bound. */
  private canSeeStore(user: User, storeId: string): boolean {
    return user.role !== 'STORE_EMPLOYEE' || (!!user.storeId && user.storeId === storeId);
  }

  private assertCanSee(user: User, storeId: string): void {
    if (!this.canSeeStore(user, storeId)) {
      throw new ORPCError('FORBIDDEN', { message: MESSAGES.forbidden });
    }
  }

  /** Only a store employee assigned to the destination store may receive (GR-01, NFR-01). */
  private assertCanReceive(user: User, storeId: string): void {
    if (user.role !== 'STORE_EMPLOYEE') {
      throw new ORPCError('FORBIDDEN', { message: MESSAGES.forbidden });
    }
    this.assertCanSee(user, storeId);
  }

  private async loadOrder(id: string): Promise<OrderRow> {
    const order = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!order) throw new ORPCError('NOT_FOUND', { message: MESSAGES.orderNotFound });
    return order;
  }

  /** Total confirmed quantity per product across every receipt of the order. */
  private async receivedByProduct(
    db: Pick<PrismaService, 'goodsReceipt'>,
    purchaseOrderId: string,
  ): Promise<Map<string, number>> {
    const receipts = await db.goodsReceipt.findMany({
      where: { purchaseOrderId },
      include: { lines: true },
    });
    const totals = new Map<string, number>();
    for (const receipt of receipts) {
      for (const line of receipt.lines) {
        totals.set(line.productId, (totals.get(line.productId) ?? 0) + line.quantity);
      }
    }
    return totals;
  }

  async summary(purchaseOrderId: string, user: User): Promise<ReceivingSummary> {
    const order = await this.loadOrder(purchaseOrderId);
    this.assertCanSee(user, order.destinationStoreId);

    const received = await this.receivedByProduct(this.prisma, purchaseOrderId);
    return {
      purchaseOrderId: order.id,
      purchaseOrderNumber: order.number,
      status: order.status,
      destinationStoreId: order.destinationStoreId,
      lines: order.lines.map((line) => {
        const receivedQty = received.get(line.productId) ?? 0;
        return {
          productId: line.productId,
          productName: line.productName,
          ordered: line.quantity,
          received: receivedQty,
          outstanding: Math.max(line.quantity - receivedQty, 0),
        };
      }),
    };
  }

  async listForOrder(purchaseOrderId: string, user: User): Promise<GoodsReceipt[]> {
    const order = await this.loadOrder(purchaseOrderId);
    this.assertCanSee(user, order.destinationStoreId);

    const rows = await this.prisma.goodsReceipt.findMany({
      where: { purchaseOrderId },
      include: { lines: true },
      orderBy: [{ receivedAt: 'asc' }, { number: 'asc' }],
    });
    return rows.map((row) => this.toReceipt(row));
  }

  async get(id: string, user: User): Promise<GoodsReceipt> {
    const row = await this.prisma.goodsReceipt.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!row) throw new ORPCError('NOT_FOUND', { message: MESSAGES.receiptNotFound });
    this.assertCanSee(user, row.storeId);
    return this.toReceipt(row);
  }

  async receive(input: ReceiveGoods, user: User): Promise<GoodsReceipt> {
    // Authorize before touching the key, so another store can never replay its way to a receipt.
    // The destination store never changes once an order is approved, so checking it here, outside
    // the transaction, is safe.
    const orderForAuthorization = await this.loadOrder(input.purchaseOrderId);
    this.assertCanReceive(user, orderForAuthorization.destinationStoreId);

    const row = await this.prisma.$transaction(async (tx) => {
      // Serialize every receipt for this order. The lock is held until the transaction ends, so a
      // racing request reads the totals only after the winner has committed (GR-05, INV-04).
      // This relies on Postgres's default READ COMMITTED isolation: under REPEATABLE READ or
      // SERIALIZABLE the re-reads below would still see the pre-lock snapshot.
      await tx.$queryRaw`SELECT "id" FROM "PurchaseOrder" WHERE "id" = ${input.purchaseOrderId} FOR UPDATE`;

      // A replay returns the original receipt, even after the order has completed (GR-04).
      const existing = await tx.idempotencyKey.findUnique({ where: { key: input.idempotencyKey } });
      if (existing) {
        const original = await tx.goodsReceipt.findUnique({
          where: { id: existing.documentId },
          include: { lines: true },
        });
        if (
          !original ||
          existing.documentType !== DOCUMENT_TYPE ||
          original.purchaseOrderId !== input.purchaseOrderId
        ) {
          throw new ORPCError('CONFLICT', { message: MESSAGES.keyReused });
        }
        return original;
      }

      // Re-read under the lock: the status and totals may have changed while we waited.
      const order = await tx.purchaseOrder.findUnique({
        where: { id: input.purchaseOrderId },
        include: { lines: true },
      });
      if (!order) throw new ORPCError('NOT_FOUND', { message: MESSAGES.orderNotFound });
      if (!isReceivable(order.status)) {
        throw new ORPCError('BAD_REQUEST', { message: MESSAGES.notReceivable });
      }

      const received = await this.receivedByProduct(tx, order.id);
      const ordered = new Map(order.lines.map((line) => [line.productId, line]));
      const incoming = input.lines.filter((line) => line.quantity > 0);
      const incomingByProduct = new Map(incoming.map((line) => [line.productId, line.quantity]));
      /** Cumulative quantity for a product once this receipt is confirmed. */
      const totalAfter = (productId: string) =>
        (received.get(productId) ?? 0) + (incomingByProduct.get(productId) ?? 0);

      // A zero-quantity line for a product that is not on the order is still a bad request.
      if (input.lines.some((line) => !ordered.has(line.productId))) {
        throw new ORPCError('BAD_REQUEST', { message: MESSAGES.notOnOrder });
      }
      if (
        incoming.some((line) => totalAfter(line.productId) > ordered.get(line.productId)!.quantity)
      ) {
        throw new ORPCError('BAD_REQUEST', { message: MESSAGES.overReceive });
      }
      const [sequence] = await tx.$queryRaw<
        { n: bigint }[]
      >`SELECT nextval('goods_receipt_number_seq') AS n`;
      const number = formatNumber(sequence!.n);

      const created = await tx.goodsReceipt.create({
        data: {
          number,
          purchaseOrderId: order.id,
          storeId: order.destinationStoreId,
          receivedById: user.id,
          lines: {
            create: incoming.map((line) => ({
              productId: line.productId,
              productName: ordered.get(line.productId)!.productName,
              quantity: line.quantity,
            })),
          },
        },
        include: { lines: true },
      });

      try {
        await tx.idempotencyKey.create({
          data: { key: input.idempotencyKey, documentType: DOCUMENT_TYPE, documentId: created.id },
        });
      } catch (error) {
        // The key was taken by another order's receipt between our read and write.
        if (isUniqueViolation(error)) {
          throw new ORPCError('CONFLICT', { message: MESSAGES.keyReused });
        }
        throw error;
      }

      for (const line of incoming) {
        await this.movements.postMovement(
          {
            productId: line.productId,
            storeId: order.destinationStoreId,
            delta: line.quantity,
            type: 'GOODS_RECEIPT',
            sourceDocument: number,
            actorId: user.id,
          },
          tx,
        );
      }

      const complete = order.lines.every((line) => totalAfter(line.productId) === line.quantity);
      await tx.purchaseOrder.update({
        where: { id: order.id },
        data: { status: complete ? 'COMPLETED' : 'PARTIALLY_RECEIVED' },
      });

      return created;
    });

    return this.toReceipt(row);
  }
}
