import { oc } from '@orpc/contract';
import * as z from 'zod';

/**
 * Why a stock movement happened. Mirrors the Prisma `MovementType` enum.
 * - `GOODS_RECEIPT` / `SALE`: posted by the transaction modules.
 * - `ADJUSTMENT`: a manager correction with a mandatory reason (INV-05).
 * - `OPENING`: the balance set when stock tracking begins.
 */
export const MovementTypeSchema = z.enum(['GOODS_RECEIPT', 'SALE', 'ADJUSTMENT', 'OPENING']);
export type MovementType = z.infer<typeof MovementTypeSchema>;

/**
 * Stock quantities are whole units and never negative (MD-02). Reused for the quantity on hand and
 * the per-store reorder threshold.
 */
const StockQuantitySchema = z.number().int().nonnegative();

/**
 * A single row in a stock search result (INV-01): a product at a store with its current quantity,
 * unit, per-store reorder threshold, and whether it is low on stock.
 */
export const StockSearchResultSchema = z.object({
  productId: z.string(),
  sku: z.string().min(1),
  name: z.string().min(1),
  /** The product's base unit of measure, e.g. "ชิ้น" (piece). */
  unit: z.string().min(1),
  storeId: z.string(),
  storeCode: z.string().min(1),
  quantity: StockQuantitySchema,
  reorderThreshold: StockQuantitySchema,
  /** True when `quantity <= reorderThreshold`. The threshold is inclusive (INV-01). */
  lowStock: z.boolean(),
});
export type StockSearchResult = z.infer<typeof StockSearchResultSchema>;

/**
 * Stock search filters (INV-01). All optional: a `query` matches SKU or product name, `storeId`
 * limits to one store. Omitting everything lists all tracked (product, store) pairs.
 */
export const StockSearchInputSchema = z.object({
  /** Matches SKU or product name (case-insensitive, substring). */
  query: z.string().optional(),
  storeId: z.string().optional(),
});
export type StockSearchInput = z.infer<typeof StockSearchInputSchema>;

/**
 * Which way a manager moves stock in an adjustment (INV-05). `INCREASE` adds units, `DECREASE`
 * removes them; the handler turns this into a signed delta so the request never carries a sign.
 */
export const AdjustmentDirectionSchema = z.enum(['INCREASE', 'DECREASE']);
export type AdjustmentDirection = z.infer<typeof AdjustmentDirectionSchema>;

/**
 * A manager stock correction (INV-05). The quantity is a positive whole number of units and the
 * direction decides the sign; the reason is mandatory and recorded on both the movement's source
 * document and the audit entry. Decreasing more than is on hand is rejected by the handler, not
 * here, because it depends on the current balance.
 */
export const AdjustStockInputSchema = z.object({
  productId: z.string().min(1),
  storeId: z.string().min(1),
  direction: AdjustmentDirectionSchema,
  /** Whole units to move, strictly positive. The direction, not a sign, says which way. */
  quantity: z.number().int().positive(),
  /** Why the correction was made. Mandatory (INV-05); trimmed, non-empty. */
  reason: z.string().trim().min(1, 'ต้องระบุเหตุผล'),
});
export type AdjustStockInput = z.infer<typeof AdjustStockInputSchema>;

/** The outcome of a successful adjustment: the ledger row it wrote and the balance either side. */
export const AdjustStockResultSchema = z.object({
  movementId: z.string(),
  productId: z.string(),
  storeId: z.string(),
  balanceBefore: StockQuantitySchema,
  balanceAfter: StockQuantitySchema,
});
export type AdjustStockResult = z.infer<typeof AdjustStockResultSchema>;

export const inventoryContract = {
  search: oc
    .route({
      method: 'GET',
      path: '/inventory/stock',
      summary: 'Search stock by SKU, name, and store',
      tags: ['Inventory'],
    })
    .input(StockSearchInputSchema)
    .output(z.array(StockSearchResultSchema)),
  adjust: oc
    .route({
      method: 'POST',
      path: '/inventory/adjustments',
      summary: 'Manager stock adjustment with a mandatory reason (INV-05)',
      tags: ['Inventory'],
    })
    .input(AdjustStockInputSchema)
    .output(AdjustStockResultSchema),
};
