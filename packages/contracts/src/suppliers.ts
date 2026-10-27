import { oc } from '@orpc/contract';
import * as z from 'zod';

/** A goods supplier a purchase order can reference. */
export const SupplierSchema = z.object({
  id: z.string(),
  /** Unique org-wide. */
  code: z.string().min(1),
  name: z.string().min(1),
  contactName: z.string().nullable().optional(),
  contactEmail: z.email().nullable().optional(),
  contactPhone: z.string().nullable().optional(),
});
export type Supplier = z.infer<typeof SupplierSchema>;

export const CreateSupplierSchema = SupplierSchema.omit({ id: true });
export type CreateSupplier = z.infer<typeof CreateSupplierSchema>;

/** Code is the stable identifier, so it cannot change; every other field is optional on update. */
export const UpdateSupplierSchema = CreateSupplierSchema.omit({ code: true }).partial();
export type UpdateSupplier = z.infer<typeof UpdateSupplierSchema>;

const SupplierIdSchema = z.object({ id: z.string() });

export const suppliersContract = {
  list: oc
    .route({ method: 'GET', path: '/suppliers', summary: 'List suppliers', tags: ['Suppliers'] })
    .output(z.array(SupplierSchema)),
  get: oc
    .route({
      method: 'GET',
      path: '/suppliers/{id}',
      summary: 'Get a supplier',
      tags: ['Suppliers'],
    })
    .input(SupplierIdSchema)
    .output(SupplierSchema),
  create: oc
    .route({
      method: 'POST',
      path: '/suppliers',
      summary: 'Create a supplier',
      tags: ['Suppliers'],
    })
    .input(CreateSupplierSchema)
    .output(SupplierSchema),
  update: oc
    .route({
      method: 'PATCH',
      path: '/suppliers/{id}',
      summary: 'Edit a supplier (code cannot change)',
      tags: ['Suppliers'],
    })
    .input(SupplierIdSchema.extend(UpdateSupplierSchema.shape))
    .output(SupplierSchema),
};
