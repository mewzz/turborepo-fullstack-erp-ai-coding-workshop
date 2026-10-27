import { oc } from '@orpc/contract';
import * as z from 'zod';
import { PurchaseOrderStatusSchema } from './purchase-orders.js';

/** One line of the receiving screen: what was ordered, already received, and still outstanding. */
export const ReceivingLineSchema = z.object({
  productId: z.string(),
  productName: z.string().min(1),
  ordered: z.number().int().nonnegative(),
  /** Sum of confirmed receipts for this line so far. */
  received: z.number().int().nonnegative(),
  /** `ordered - received`, never negative. */
  outstanding: z.number().int().nonnegative(),
});
export type ReceivingLine = z.infer<typeof ReceivingLineSchema>;

/** The receiving screen's data for one order (GR-01). */
export const ReceivingSummarySchema = z.object({
  purchaseOrderId: z.string(),
  purchaseOrderNumber: z.string().min(1),
  status: PurchaseOrderStatusSchema,
  destinationStoreId: z.string(),
  lines: z.array(ReceivingLineSchema),
});
export type ReceivingSummary = z.infer<typeof ReceivingSummarySchema>;

/** A received quantity: a non-negative whole number (GR-02). */
const ReceivedQuantitySchema = z.number().int().nonnegative();

export const GoodsReceiptLineSchema = z.object({
  productId: z.string(),
  productName: z.string().min(1),
  quantity: z.number().int().positive(),
});
export type GoodsReceiptLine = z.infer<typeof GoodsReceiptLineSchema>;

/** A confirmed receipt. Terminal: there is no edit or cancel (GR-05). */
export const GoodsReceiptSchema = z.object({
  id: z.string(),
  /** Human-facing document number, unique org-wide, e.g. "GR-0001". */
  number: z.string().min(1),
  purchaseOrderId: z.string(),
  storeId: z.string(),
  receivedById: z.string(),
  /** ISO timestamp of confirmation. */
  receivedAt: z.string(),
  lines: z.array(GoodsReceiptLineSchema),
});
export type GoodsReceipt = z.infer<typeof GoodsReceiptSchema>;

/**
 * Confirm a receipt against an order (GR-02, GR-03, GR-04). Each quantity is a non-negative whole
 * number, at least one is above zero, and a product appears once. The idempotency key makes a
 * retry return the original receipt.
 */
export const ReceiveGoodsSchema = z.object({
  purchaseOrderId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  lines: z
    .array(z.object({ productId: z.string().min(1), quantity: ReceivedQuantitySchema }))
    .refine((lines) => lines.some((line) => line.quantity > 0), {
      message: 'At least one line must have a quantity above zero',
    })
    .refine((lines) => new Set(lines.map((line) => line.productId)).size === lines.length, {
      message: 'A product can appear only once per receipt',
    }),
});
export type ReceiveGoods = z.infer<typeof ReceiveGoodsSchema>;

const PurchaseOrderIdSchema = z.object({ purchaseOrderId: z.string() });

export const goodsReceiptsContract = {
  summary: oc
    .route({
      method: 'GET',
      path: '/purchase-orders/{purchaseOrderId}/receiving',
      summary: 'Ordered, received and outstanding per line for an order',
      tags: ['Goods Receipts'],
    })
    .input(PurchaseOrderIdSchema)
    .output(ReceivingSummarySchema),
  receive: oc
    .route({
      method: 'POST',
      path: '/purchase-orders/{purchaseOrderId}/receipts',
      summary: 'Confirm a goods receipt against an order',
      tags: ['Goods Receipts'],
    })
    .input(ReceiveGoodsSchema)
    .output(GoodsReceiptSchema),
  listForOrder: oc
    .route({
      method: 'GET',
      path: '/purchase-orders/{purchaseOrderId}/receipts',
      summary: 'List confirmed receipts for an order',
      tags: ['Goods Receipts'],
    })
    .input(PurchaseOrderIdSchema)
    .output(z.array(GoodsReceiptSchema)),
  get: oc
    .route({
      method: 'GET',
      path: '/goods-receipts/{id}',
      summary: 'Get a confirmed goods receipt',
      tags: ['Goods Receipts'],
    })
    .input(z.object({ id: z.string() }))
    .output(GoodsReceiptSchema),
};
