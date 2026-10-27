import { describe, expect, it } from 'vitest';
import { CreateProductSchema, ProductSchema, UpdateProductSchema } from './products.js';

const validProduct = {
  id: 'p1',
  sku: 'SKU001',
  name: 'น้ำดื่ม',
  category: 'เครื่องดื่ม',
  unit: 'ขวด',
  sellingPrice: 10.5,
  active: true,
};

describe('ProductSchema', () => {
  it('accepts a well-formed product', () => {
    expect(ProductSchema.safeParse(validProduct).success).toBe(true);
  });

  it('rejects a negative selling price', () => {
    expect(ProductSchema.safeParse({ ...validProduct, sellingPrice: -1 }).success).toBe(false);
  });

  it('accepts a zero selling price', () => {
    expect(ProductSchema.safeParse({ ...validProduct, sellingPrice: 0 }).success).toBe(true);
  });

  it('rejects an empty SKU', () => {
    expect(ProductSchema.safeParse({ ...validProduct, sku: '' }).success).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(ProductSchema.safeParse({ ...validProduct, name: '' }).success).toBe(false);
  });
});

describe('CreateProductSchema', () => {
  it('accepts input without id or active', () => {
    const { id: _id, active: _active, ...input } = validProduct;
    expect(CreateProductSchema.safeParse(input).success).toBe(true);
  });

  it('rejects a negative selling price', () => {
    const { id: _id, active: _active, ...input } = validProduct;
    expect(CreateProductSchema.safeParse({ ...input, sellingPrice: -0.01 }).success).toBe(false);
  });
});

describe('UpdateProductSchema', () => {
  it('accepts a partial update', () => {
    expect(UpdateProductSchema.safeParse({ sellingPrice: 20 }).success).toBe(true);
  });

  it('accepts an empty update', () => {
    expect(UpdateProductSchema.safeParse({}).success).toBe(true);
  });

  it('does not allow editing the SKU', () => {
    const result = UpdateProductSchema.safeParse({ sku: 'SKU999' });
    // SKU is omitted from the schema, so it is stripped rather than applied.
    expect(result.success).toBe(true);
    expect(result.success && 'sku' in result.data).toBe(false);
  });

  it('rejects a negative selling price', () => {
    expect(UpdateProductSchema.safeParse({ sellingPrice: -5 }).success).toBe(false);
  });
});
