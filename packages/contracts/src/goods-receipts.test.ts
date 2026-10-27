import { describe, expect, it } from 'vitest';
import { ReceiveGoodsSchema } from './goods-receipts.js';

const valid = {
  purchaseOrderId: 'po1',
  idempotencyKey: 'key-1',
  lines: [
    { productId: 'p1', quantity: 5 },
    { productId: 'p2', quantity: 0 },
  ],
};

describe('ReceiveGoodsSchema', () => {
  it('accepts a receipt with at least one line above zero (zero lines allowed)', () => {
    expect(ReceiveGoodsSchema.safeParse(valid).success).toBe(true);
  });

  it('requires a non-empty idempotency key', () => {
    expect(ReceiveGoodsSchema.safeParse({ ...valid, idempotencyKey: '' }).success).toBe(false);
  });

  it('rejects when every line is zero', () => {
    const lines = [{ productId: 'p1', quantity: 0 }];
    expect(ReceiveGoodsSchema.safeParse({ ...valid, lines }).success).toBe(false);
  });

  it('rejects an empty line list', () => {
    expect(ReceiveGoodsSchema.safeParse({ ...valid, lines: [] }).success).toBe(false);
  });

  it('rejects negative and fractional quantities', () => {
    for (const quantity of [-1, 1.5]) {
      const lines = [
        { productId: 'p1', quantity },
        { productId: 'p2', quantity: 3 },
      ];
      expect(ReceiveGoodsSchema.safeParse({ ...valid, lines }).success).toBe(false);
    }
  });

  it('rejects a product repeated in one receipt', () => {
    const lines = [
      { productId: 'p1', quantity: 1 },
      { productId: 'p1', quantity: 2 },
    ];
    expect(ReceiveGoodsSchema.safeParse({ ...valid, lines }).success).toBe(false);
  });
});
