import { describe, expect, it } from 'vitest';
import {
  AdjustStockInputSchema,
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

describe('AdjustStockInputSchema', () => {
  const valid = {
    productId: 'p1',
    storeId: 's1',
    direction: 'DECREASE' as const,
    quantity: 4,
    reason: 'นับสต็อกใหม่',
  };

  it('accepts a well-formed decrease with a reason', () => {
    expect(AdjustStockInputSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts an increase', () => {
    expect(AdjustStockInputSchema.safeParse({ ...valid, direction: 'INCREASE' }).success).toBe(
      true,
    );
  });

  it('rejects a missing reason (mandatory, INV-05)', () => {
    const { reason: _reason, ...withoutReason } = valid;
    expect(AdjustStockInputSchema.safeParse(withoutReason).success).toBe(false);
  });

  it('rejects a blank or whitespace-only reason', () => {
    expect(AdjustStockInputSchema.safeParse({ ...valid, reason: '   ' }).success).toBe(false);
  });

  it('rejects a zero or negative quantity (direction carries the sign)', () => {
    expect(AdjustStockInputSchema.safeParse({ ...valid, quantity: 0 }).success).toBe(false);
    expect(AdjustStockInputSchema.safeParse({ ...valid, quantity: -3 }).success).toBe(false);
  });

  it('rejects a fractional quantity (stock is whole units)', () => {
    expect(AdjustStockInputSchema.safeParse({ ...valid, quantity: 2.5 }).success).toBe(false);
  });

  it('rejects an unknown direction', () => {
    expect(AdjustStockInputSchema.safeParse({ ...valid, direction: 'TRANSFER' }).success).toBe(
      false,
    );
  });
});
