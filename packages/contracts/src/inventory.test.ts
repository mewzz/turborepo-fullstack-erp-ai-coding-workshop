import { describe, expect, it } from 'vitest';
import {
  MovementTypeSchema,
  StockSearchInputSchema,
  StockSearchResultSchema,
} from './inventory.js';

const validResult = {
  productId: 'p1',
  sku: 'SKU001',
  name: 'สินค้า 001',
  unit: 'ชิ้น',
  storeId: 's1',
  storeCode: 'B01',
  quantity: 10,
  reorderThreshold: 3,
  lowStock: false,
};

describe('StockSearchResultSchema', () => {
  it('accepts a well-formed stock row', () => {
    expect(StockSearchResultSchema.safeParse(validResult).success).toBe(true);
  });

  it('accepts a zero quantity (zero-stock rows stay visible)', () => {
    expect(StockSearchResultSchema.safeParse({ ...validResult, quantity: 0 }).success).toBe(true);
  });

  it('rejects a negative quantity', () => {
    expect(StockSearchResultSchema.safeParse({ ...validResult, quantity: -1 }).success).toBe(false);
  });

  it('rejects a fractional quantity (stock is whole units)', () => {
    expect(StockSearchResultSchema.safeParse({ ...validResult, quantity: 2.5 }).success).toBe(
      false,
    );
  });

  it('rejects a negative reorder threshold', () => {
    expect(
      StockSearchResultSchema.safeParse({ ...validResult, reorderThreshold: -1 }).success,
    ).toBe(false);
  });
});

describe('StockSearchInputSchema', () => {
  it('accepts an empty filter', () => {
    expect(StockSearchInputSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a query and store filter', () => {
    expect(StockSearchInputSchema.safeParse({ query: 'SKU001', storeId: 's1' }).success).toBe(true);
  });
});

describe('MovementTypeSchema', () => {
  it('accepts the four movement types', () => {
    for (const type of ['GOODS_RECEIPT', 'SALE', 'ADJUSTMENT', 'OPENING']) {
      expect(MovementTypeSchema.safeParse(type).success).toBe(true);
    }
  });

  it('rejects an unknown movement type', () => {
    expect(MovementTypeSchema.safeParse('TRANSFER').success).toBe(false);
  });
});
