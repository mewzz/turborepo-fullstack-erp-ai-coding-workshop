import { describe, expect, it } from 'vitest';
import { LoginInputSchema, RoleSchema, SessionSchema, StoreSchema, UserSchema } from './auth.js';

describe('LoginInputSchema', () => {
  it('accepts an email and password', () => {
    const result = LoginInputSchema.safeParse({ email: 'admin@erp.local', password: 'password' });

    expect(result.success).toBe(true);
  });

  it('rejects an invalid email', () => {
    const result = LoginInputSchema.safeParse({ email: 'admin', password: 'password' });

    expect(result.success).toBe(false);
  });

  it('rejects an empty password', () => {
    const result = LoginInputSchema.safeParse({ email: 'admin@erp.local', password: '' });

    expect(result.success).toBe(false);
  });
});

describe('RoleSchema', () => {
  it.each(['ADMINISTRATOR', 'PURCHASING_OFFICER', 'STORE_EMPLOYEE', 'MANAGER'])(
    'accepts the %s role',
    (role) => {
      expect(RoleSchema.safeParse(role).success).toBe(true);
    },
  );

  it.each(['ADMIN', 'STAFF', 'OWNER'])('rejects the removed/unknown role %s', (role) => {
    expect(RoleSchema.safeParse(role).success).toBe(false);
  });
});

describe('StoreSchema', () => {
  it('accepts a store with code and name', () => {
    const result = StoreSchema.safeParse({ id: 's1', code: 'B01', name: 'Central' });

    expect(result.success).toBe(true);
  });

  it('rejects a store missing its code', () => {
    const result = StoreSchema.safeParse({ id: 's1', name: 'Central' });

    expect(result.success).toBe(false);
  });
});

describe('UserSchema', () => {
  const base = { id: '1', email: 'a@erp.local', name: 'A', role: 'MANAGER' };

  it('accepts a user with no store assignment', () => {
    expect(UserSchema.safeParse(base).success).toBe(true);
  });

  it('accepts a user assigned to a store', () => {
    expect(UserSchema.safeParse({ ...base, storeId: 's1' }).success).toBe(true);
  });

  it('accepts a user with an explicitly null store', () => {
    expect(UserSchema.safeParse({ ...base, storeId: null }).success).toBe(true);
  });
});

describe('SessionSchema', () => {
  it('accepts a signed-out session', () => {
    expect(SessionSchema.safeParse({ user: null }).success).toBe(true);
  });

  it('rejects an unknown role', () => {
    const result = SessionSchema.safeParse({
      user: { id: '1', email: 'a@erp.local', name: 'A', role: 'OWNER' },
    });

    expect(result.success).toBe(false);
  });
});
