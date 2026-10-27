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
};
