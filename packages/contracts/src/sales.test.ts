import { describe, expect, it } from 'vitest';
import { ConfirmSaleSchema, CreateSaleSchema, SaleStatusSchema } from './sales.js';

const validLine = { productId: 'p1', quantity: 3 };
const validCreate = { storeId: 'st1', lines: [validLine] };

describe('SaleStatusSchema', () => {
  it('accepts the two lifecycle statuses', () => {
    for (const status of ['DRAFT', 'CONFIRMED']) {
      expect(SaleStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it('rejects an unknown status', () => {
    expect(SaleStatusSchema.safeParse('RETURNED').success).toBe(false);
  });
});

describe('CreateSaleSchema', () => {
  it('accepts a well-formed draft', () => {
    expect(CreateSaleSchema.safeParse(validCreate).success).toBe(true);
  });

  it('carries no price field: the price is snapshotted server-side, no override (SAL-01)', () => {
    const parsed = CreateSaleSchema.parse({
      ...validCreate,
      lines: [{ productId: 'p1', quantity: 3, unitPrice: 999 }],
    });
    expect('unitPrice' in parsed.lines[0]!).toBe(false);
  });

  it('requires at least one line', () => {
    expect(CreateSaleSchema.safeParse({ ...validCreate, lines: [] }).success).toBe(false);
  });

  it('rejects a non-positive quantity', () => {
    expect(
      CreateSaleSchema.safeParse({ ...validCreate, lines: [{ productId: 'p1', quantity: 0 }] })
        .success,
    ).toBe(false);
  });

  it('rejects a fractional quantity', () => {
    expect(
      CreateSaleSchema.safeParse({ ...validCreate, lines: [{ productId: 'p1', quantity: 1.5 }] })
        .success,
    ).toBe(false);
  });

  it('rejects duplicate products in one sale', () => {
    expect(
      CreateSaleSchema.safeParse({
        ...validCreate,
        lines: [validLine, { productId: 'p1', quantity: 2 }],
      }).success,
    ).toBe(false);
  });

  it('accepts distinct products in one sale', () => {
    expect(
      CreateSaleSchema.safeParse({
        ...validCreate,
        lines: [validLine, { productId: 'p2', quantity: 2 }],
      }).success,
    ).toBe(true);
  });

  it('requires a store', () => {
    expect(CreateSaleSchema.safeParse({ storeId: '', lines: [validLine] }).success).toBe(false);
  });
});

describe('ConfirmSaleSchema', () => {
  it('requires both an id and a non-empty idempotency key (SAL-03)', () => {
    expect(ConfirmSaleSchema.safeParse({ id: 's1', idempotencyKey: 'key-1' }).success).toBe(true);
    expect(ConfirmSaleSchema.safeParse({ id: 's1', idempotencyKey: '' }).success).toBe(false);
    expect(ConfirmSaleSchema.safeParse({ id: '', idempotencyKey: 'key-1' }).success).toBe(false);
  });
});
