import { describe, expect, it } from 'vitest';
import { CreateSupplierSchema, SupplierSchema, UpdateSupplierSchema } from './suppliers.js';

const validSupplier = {
  id: 's1',
  code: 'SUP01',
  name: 'บริษัท ตัวอย่าง จำกัด',
  contactName: 'สมชาย',
  contactEmail: 'contact@supplier.local',
  contactPhone: '021234567',
};

describe('SupplierSchema', () => {
  it('accepts a well-formed supplier', () => {
    expect(SupplierSchema.safeParse(validSupplier).success).toBe(true);
  });

  it('accepts a supplier with no contact details', () => {
    expect(SupplierSchema.safeParse({ id: 's1', code: 'SUP01', name: 'บริษัท' }).success).toBe(
      true,
    );
  });

  it('accepts null contact details', () => {
    const result = SupplierSchema.safeParse({
      id: 's1',
      code: 'SUP01',
      name: 'บริษัท',
      contactName: null,
      contactEmail: null,
      contactPhone: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty code', () => {
    expect(SupplierSchema.safeParse({ ...validSupplier, code: '' }).success).toBe(false);
  });

  it('rejects an invalid contact email', () => {
    expect(
      SupplierSchema.safeParse({ ...validSupplier, contactEmail: 'not-an-email' }).success,
    ).toBe(false);
  });
});

describe('CreateSupplierSchema', () => {
  it('accepts input without an id', () => {
    const { id: _id, ...input } = validSupplier;
    expect(CreateSupplierSchema.safeParse(input).success).toBe(true);
  });
});

describe('UpdateSupplierSchema', () => {
  it('accepts a partial update', () => {
    expect(UpdateSupplierSchema.safeParse({ name: 'ชื่อใหม่' }).success).toBe(true);
  });

  it('does not allow editing the code', () => {
    const result = UpdateSupplierSchema.safeParse({ code: 'SUP99' });
    expect(result.success).toBe(true);
    expect(result.success && 'code' in result.data).toBe(false);
  });
});
