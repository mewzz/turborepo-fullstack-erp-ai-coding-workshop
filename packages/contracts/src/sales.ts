import { oc } from '@orpc/contract';
import * as z from 'zod';

/**
 * A sale's lifecycle (SAL-01..04). A draft has no stock effect; a confirmed sale is terminal —
 * never edited, cancelled or returned.
 */
export const SaleStatusSchema = z.enum(['DRAFT', 'CONFIRMED']);
export type SaleStatus = z.infer<typeof SaleStatusSchema>;

/**
 * A selling price in Thai baht stored as `DECIMAL(12,2)`: never negative, at most two decimals, and
 * below 10^10 so the ten integer digits fit the column. The API snapshots it from the product, so
 * this only ever validates server-produced output, never caller input.
 */
const UnitPriceSchema = z
  .number()
  .nonnegative()
  .lt(10_000_000_000, 'Unit price must be below 10,000,000,000')
  .refine((value) => Math.round(value * 100) === value * 100, {
    message: 'Unit price cannot have more than two decimal places',
  });

/** A line as it is stored, with the product name and unit price snapshotted at creation (SAL-01). */
export const SaleLineSchema = z.object({
  id: z.string(),
  productId: z.string(),
  /** Snapshot of the product name at creation time. */
  productName: z.string().min(1),
  /** Snapshot of the current selling price at creation time; no override (SAL-01). */
  unitPrice: UnitPriceSchema,
  /** Whole units, strictly positive. */
  quantity: z.number().int().positive(),
});
export type SaleLine = z.infer<typeof SaleLineSchema>;

/** A full sale with its lines, as the API returns it. `number` is null until confirmed (SAL-03). */
export const SaleSchema = z.object({
  id: z.string(),
  /** Human-facing document number, unique org-wide, e.g. "SALE-0001". Null while a draft. */
  number: z.string().min(1).nullable(),
  storeId: z.string(),
  status: SaleStatusSchema,
  /** The store employee who recorded the sale. */
  createdById: z.string(),
  /** ISO timestamp of confirmation; null while a draft. */
  confirmedAt: z.string().nullable(),
  lines: z.array(SaleLineSchema),
});
export type Sale = z.infer<typeof SaleSchema>;

/**
 * One line the caller supplies when drafting a sale. There is deliberately no price: the API
 * snapshots the current selling price, with no override (SAL-01).
 */
export const SaleLineInputSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive(),
});
export type SaleLineInput = z.infer<typeof SaleLineInputSchema>;

/** At least one line, with no product repeated. */
const LinesSchema = z
  .array(SaleLineInputSchema)
  .min(1, 'A sale needs at least one line')
  .refine((lines) => new Set(lines.map((line) => line.productId)).size === lines.length, {
    message: 'A product can appear only once per sale',
  });

/**
 * The draft a store employee creates (SAL-01). The number, status, author and prices are all
 * server-set; the caller supplies only the store and the product lines.
 */
export const CreateSaleSchema = z.object({
  storeId: z.string().min(1),
  lines: LinesSchema,
});
export type CreateSale = z.infer<typeof CreateSaleSchema>;

/**
 * Confirm a draft (SAL-02, SAL-03). The idempotency key makes a retried confirm return the original
 * sale instead of posting a second one — a duplicate confirm never double-sells (SAL-03).
 */
export const ConfirmSaleSchema = z.object({
  id: z.string().min(1),
  idempotencyKey: z.string().min(1),
});
export type ConfirmSale = z.infer<typeof ConfirmSaleSchema>;

const SaleIdSchema = z.object({ id: z.string() });

export const salesContract = {
  list: oc
    .route({ method: 'GET', path: '/sales', summary: 'List sales', tags: ['Sales'] })
    .output(z.array(SaleSchema)),
  get: oc
    .route({ method: 'GET', path: '/sales/{id}', summary: 'Get a sale', tags: ['Sales'] })
    .input(SaleIdSchema)
    .output(SaleSchema),
  create: oc
    .route({
      method: 'POST',
      path: '/sales',
      summary: 'Create a draft sale',
      tags: ['Sales'],
    })
    .input(CreateSaleSchema)
    .output(SaleSchema),
  confirm: oc
    .route({
      method: 'POST',
      path: '/sales/{id}/confirm',
      summary: 'Confirm a draft sale, decreasing stock (idempotent)',
      tags: ['Sales'],
    })
    .input(ConfirmSaleSchema)
    .output(SaleSchema),
};
