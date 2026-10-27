import { oc } from '@orpc/contract';
import * as z from 'zod';

/**
 * The purchase-order lifecycle (PO-02/03/04). A guarded state machine with no effect on stock.
 * `PARTIALLY_RECEIVED` and `COMPLETED` are reached only by goods receiving (T6), never here.
 */
export const PurchaseOrderStatusSchema = z.enum([
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'PARTIALLY_RECEIVED',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
]);
export type PurchaseOrderStatus = z.infer<typeof PurchaseOrderStatusSchema>;

/**
 * A purchase price in Thai baht stored as `DECIMAL(12,2)`: never negative, at most two decimals,
 * and below 10^10 so the ten integer digits fit the column. Bounding it in the contract keeps an
 * out-of-range price a 400 at the edge instead of an unmapped Postgres 500. Mirrors the product
 * selling-price rule but allows zero (a free line is valid on a PO).
 */
const PurchasePriceSchema = z
  .number()
  .nonnegative()
  .lt(10_000_000_000, 'Purchase price must be below 10,000,000,000')
  .refine((value) => Math.round(value * 100) === value * 100, {
    message: 'Purchase price cannot have more than two decimal places',
  });

/** A line as it is stored, with the product name and price snapshotted at creation. */
export const PurchaseOrderLineSchema = z.object({
  id: z.string(),
  productId: z.string(),
  /** Snapshot of the product name at creation time. */
  productName: z.string().min(1),
  /** Snapshot of the agreed purchase price at creation time. Thai baht, two decimals. */
  purchasePrice: PurchasePriceSchema,
  /** Whole units, strictly positive (PO-01). */
  quantity: z.number().int().positive(),
});
export type PurchaseOrderLine = z.infer<typeof PurchaseOrderLineSchema>;

/** A full purchase order with its lines, as the API returns it. */
export const PurchaseOrderSchema = z.object({
  id: z.string(),
  /** Human-facing document number, unique org-wide, e.g. "PO-0001". */
  number: z.string().min(1),
  supplierId: z.string(),
  destinationStoreId: z.string(),
  /** ISO date (YYYY-MM-DD) the goods are expected. */
  expectedReceiptDate: z.string().min(1),
  status: PurchaseOrderStatusSchema,
  /** The purchasing officer who created the order. */
  createdById: z.string(),
  /** Mandatory reason captured on reject or cancel (PO-03/04); null otherwise. */
  reason: z.string().nullable().optional(),
  lines: z.array(PurchaseOrderLineSchema),
});
export type PurchaseOrder = z.infer<typeof PurchaseOrderSchema>;

/** One line the caller supplies when drafting or editing an order. */
export const PurchaseOrderLineInputSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive(),
  purchasePrice: PurchasePriceSchema,
});
export type PurchaseOrderLineInput = z.infer<typeof PurchaseOrderLineInputSchema>;

/** At least one line, with no product repeated (no duplicate SKUs in one order, PO-01). */
const LinesSchema = z
  .array(PurchaseOrderLineInputSchema)
  .min(1, 'A purchase order needs at least one line')
  .refine((lines) => new Set(lines.map((line) => line.productId)).size === lines.length, {
    message: 'A product can appear only once per order',
  });

/** The draft a purchasing officer creates (PO-01). The number, status and author are server-set. */
export const CreatePurchaseOrderSchema = z.object({
  supplierId: z.string().min(1),
  destinationStoreId: z.string().min(1),
  expectedReceiptDate: z.string().min(1),
  lines: LinesSchema,
});
export type CreatePurchaseOrder = z.infer<typeof CreatePurchaseOrderSchema>;

/** Editing a draft replaces the whole header and line set under the same id and rules (PO-01). */
export const UpdatePurchaseOrderSchema = CreatePurchaseOrderSchema.extend({ id: z.string() });
export type UpdatePurchaseOrder = z.infer<typeof UpdatePurchaseOrderSchema>;

const PurchaseOrderIdSchema = z.object({ id: z.string() });

/** Submit (Draft→Pending) and approve (Pending→Approved) need only the id. */
export const SubmitPurchaseOrderSchema = PurchaseOrderIdSchema;
export const ApprovePurchaseOrderSchema = PurchaseOrderIdSchema;

/** Reject (Pending→Rejected) requires a reason (PO-03). */
export const RejectPurchaseOrderSchema = PurchaseOrderIdSchema.extend({
  reason: z.string().min(1),
});
export type RejectPurchaseOrder = z.infer<typeof RejectPurchaseOrderSchema>;

/** Cancel (Draft|Pending→Cancelled) requires a reason (PO-04). */
export const CancelPurchaseOrderSchema = PurchaseOrderIdSchema.extend({
  reason: z.string().min(1),
});
export type CancelPurchaseOrder = z.infer<typeof CancelPurchaseOrderSchema>;

export const purchaseOrdersContract = {
  list: oc
    .route({
      method: 'GET',
      path: '/purchase-orders',
      summary: 'List purchase orders',
      tags: ['Purchase Orders'],
    })
    .output(z.array(PurchaseOrderSchema)),
  get: oc
    .route({
      method: 'GET',
      path: '/purchase-orders/{id}',
      summary: 'Get a purchase order',
      tags: ['Purchase Orders'],
    })
    .input(PurchaseOrderIdSchema)
    .output(PurchaseOrderSchema),
  create: oc
    .route({
      method: 'POST',
      path: '/purchase-orders',
      summary: 'Create a draft purchase order',
      tags: ['Purchase Orders'],
    })
    .input(CreatePurchaseOrderSchema)
    .output(PurchaseOrderSchema),
  update: oc
    .route({
      method: 'PATCH',
      path: '/purchase-orders/{id}',
      summary: 'Edit a draft purchase order',
      tags: ['Purchase Orders'],
    })
    .input(UpdatePurchaseOrderSchema)
    .output(PurchaseOrderSchema),
  submit: oc
    .route({
      method: 'POST',
      path: '/purchase-orders/{id}/submit',
      summary: 'Submit a draft for approval (Draft→Pending)',
      tags: ['Purchase Orders'],
    })
    .input(SubmitPurchaseOrderSchema)
    .output(PurchaseOrderSchema),
  approve: oc
    .route({
      method: 'POST',
      path: '/purchase-orders/{id}/approve',
      summary: 'Approve a pending order (Pending→Approved)',
      tags: ['Purchase Orders'],
    })
    .input(ApprovePurchaseOrderSchema)
    .output(PurchaseOrderSchema),
  reject: oc
    .route({
      method: 'POST',
      path: '/purchase-orders/{id}/reject',
      summary: 'Reject a pending order with a reason (Pending→Rejected)',
      tags: ['Purchase Orders'],
    })
    .input(RejectPurchaseOrderSchema)
    .output(PurchaseOrderSchema),
  cancel: oc
    .route({
      method: 'POST',
      path: '/purchase-orders/{id}/cancel',
      summary: 'Cancel a draft or pending order with a reason (Draft|Pending→Cancelled)',
      tags: ['Purchase Orders'],
    })
    .input(CancelPurchaseOrderSchema)
    .output(PurchaseOrderSchema),
};
