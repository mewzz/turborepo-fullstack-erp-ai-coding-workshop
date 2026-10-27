import { describe, expect, it } from 'vitest';
import {
  ApprovePurchaseOrderSchema,
  CancelPurchaseOrderSchema,
  CreatePurchaseOrderSchema,
  PurchaseOrderStatusSchema,
  RejectPurchaseOrderSchema,
  UpdatePurchaseOrderSchema,
} from './purchase-orders.js';

const validLine = { productId: 'p1', quantity: 10, purchasePrice: 25.5 };

const validCreate = {
  supplierId: 's1',
  destinationStoreId: 'st1',
  expectedReceiptDate: '2026-01-15',
  lines: [validLine],
};

describe('PurchaseOrderStatusSchema', () => {
  it('accepts the seven lifecycle statuses', () => {
    for (const status of [
      'DRAFT',
      'PENDING_APPROVAL',
      'APPROVED',
      'PARTIALLY_RECEIVED',
      'COMPLETED',
      'REJECTED',
      'CANCELLED',
    ]) {
      expect(PurchaseOrderStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it('rejects an unknown status', () => {
    expect(PurchaseOrderStatusSchema.safeParse('SHIPPED').success).toBe(false);
  });
});

describe('CreatePurchaseOrderSchema', () => {
  it('accepts a well-formed draft', () => {
    expect(CreatePurchaseOrderSchema.safeParse(validCreate).success).toBe(true);
  });

  it('requires at least one line (PO-01)', () => {
    expect(CreatePurchaseOrderSchema.safeParse({ ...validCreate, lines: [] }).success).toBe(false);
  });

  it('rejects a non-positive quantity (PO-01)', () => {
    const result = CreatePurchaseOrderSchema.safeParse({
      ...validCreate,
      lines: [{ ...validLine, quantity: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a fractional quantity (PO-01)', () => {
    const result = CreatePurchaseOrderSchema.safeParse({
      ...validCreate,
      lines: [{ ...validLine, quantity: 1.5 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a negative purchase price (PO-01)', () => {
    const result = CreatePurchaseOrderSchema.safeParse({
      ...validCreate,
      lines: [{ ...validLine, purchasePrice: -1 }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a zero purchase price (non-negative, PO-01)', () => {
    const result = CreatePurchaseOrderSchema.safeParse({
      ...validCreate,
      lines: [{ ...validLine, purchasePrice: 0 }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a purchase price with more than two decimals (PO-01)', () => {
    const result = CreatePurchaseOrderSchema.safeParse({
      ...validCreate,
      lines: [{ ...validLine, purchasePrice: 1.234 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects duplicate SKUs in one order (PO-01)', () => {
    const result = CreatePurchaseOrderSchema.safeParse({
      ...validCreate,
      lines: [validLine, { ...validLine, quantity: 2 }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts distinct products in one order', () => {
    const result = CreatePurchaseOrderSchema.safeParse({
      ...validCreate,
      lines: [validLine, { productId: 'p2', quantity: 2, purchasePrice: 10 }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty expected receipt date', () => {
    expect(
      CreatePurchaseOrderSchema.safeParse({ ...validCreate, expectedReceiptDate: '' }).success,
    ).toBe(false);
  });
});

describe('UpdatePurchaseOrderSchema', () => {
  it('carries the id and the same line rules as create', () => {
    expect(UpdatePurchaseOrderSchema.safeParse({ id: 'po1', ...validCreate }).success).toBe(true);
  });

  it('still rejects an empty line list', () => {
    expect(
      UpdatePurchaseOrderSchema.safeParse({ id: 'po1', ...validCreate, lines: [] }).success,
    ).toBe(false);
  });
});

describe('RejectPurchaseOrderSchema', () => {
  it('requires a non-empty reason (PO-03)', () => {
    expect(RejectPurchaseOrderSchema.safeParse({ id: 'po1', reason: '' }).success).toBe(false);
    expect(RejectPurchaseOrderSchema.safeParse({ id: 'po1', reason: 'ราคาสูงไป' }).success).toBe(
      true,
    );
  });
});

describe('CancelPurchaseOrderSchema', () => {
  it('requires a non-empty reason (PO-04)', () => {
    expect(CancelPurchaseOrderSchema.safeParse({ id: 'po1', reason: '' }).success).toBe(false);
    expect(CancelPurchaseOrderSchema.safeParse({ id: 'po1', reason: 'ยกเลิก' }).success).toBe(true);
  });
});

describe('ApprovePurchaseOrderSchema', () => {
  it('takes just the id (no reason)', () => {
    expect(ApprovePurchaseOrderSchema.safeParse({ id: 'po1' }).success).toBe(true);
  });
});
