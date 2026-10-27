import { oc } from '@orpc/contract';
import * as z from 'zod';

/**
 * Thai baht stored as `DECIMAL(12,2)`: never negative, at most two decimal places,
 * and strictly below 10^10 so the ten integer digits fit the column. Bounding it here,
 * in the contract, keeps an out-of-range price a 400 at the edge instead of an unmapped
 * Postgres 500 at the database.
 */
const SellingPriceSchema = z
  .number()
  .nonnegative()
  .lt(10_000_000_000, 'Selling price must be below 10,000,000,000')
  .refine((value) => Math.round(value * 100) === value * 100, {
    message: 'Selling price cannot have more than two decimal places',
  });

/** A catalogue item. One base unit per SKU; stock is tracked per store elsewhere. */
export const ProductSchema = z.object({
  id: z.string(),
  /** Unique org-wide, immutable once a transaction references it (enforced in later slices). */
  sku: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  /** The base unit of measure, e.g. "ชิ้น" (piece). */
  unit: z.string().min(1),
  /** Thai baht, two decimals. Never negative. */
  sellingPrice: SellingPriceSchema,
  /** Deactivated products stay searchable in history but are blocked from new documents. */
  active: z.boolean(),
});
export type Product = z.infer<typeof ProductSchema>;

/** The caller supplies everything except the generated id and the default-true active flag. */
export const CreateProductSchema = ProductSchema.omit({ id: true, active: true });
export type CreateProduct = z.infer<typeof CreateProductSchema>;

/** SKU is immutable, so it cannot be edited; every other field is optional on update. */
export const UpdateProductSchema = CreateProductSchema.omit({ sku: true }).partial();
export type UpdateProduct = z.infer<typeof UpdateProductSchema>;

const ProductIdSchema = z.object({ id: z.string() });

export const productsContract = {
  list: oc
    .route({ method: 'GET', path: '/products', summary: 'List products', tags: ['Products'] })
    .output(z.array(ProductSchema)),
  get: oc
    .route({ method: 'GET', path: '/products/{id}', summary: 'Get a product', tags: ['Products'] })
    .input(ProductIdSchema)
    .output(ProductSchema),
  create: oc
    .route({
      method: 'POST',
      path: '/products',
      summary: 'Create a product',
      tags: ['Products'],
    })
    .input(CreateProductSchema)
    .output(ProductSchema),
  update: oc
    .route({
      method: 'PATCH',
      path: '/products/{id}',
      summary: 'Edit a product (SKU cannot change)',
      tags: ['Products'],
    })
    .input(ProductIdSchema.extend(UpdateProductSchema.shape))
    .output(ProductSchema),
  deactivate: oc
    .route({
      method: 'POST',
      path: '/products/{id}/deactivate',
      summary: 'Deactivate a product',
      tags: ['Products'],
    })
    .input(ProductIdSchema)
    .output(ProductSchema),
  reactivate: oc
    .route({
      method: 'POST',
      path: '/products/{id}/reactivate',
      summary: 'Reactivate a product',
      tags: ['Products'],
    })
    .input(ProductIdSchema)
    .output(ProductSchema),
};
