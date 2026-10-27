import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { PrismaService } from '../database/prisma.service.js';
import { StockMovementService } from './stock-movement.service.js';

/**
 * A minimal in-memory stand-in for the slice of Prisma the primitive uses: a `stockBalance` table
 * keyed on (product, store), a `stockMovement` append-only log, and an `$transaction` that just
 * runs the callback against this same store. It is the independent source of truth the
 * reconciliation test reads back from, so the assertions can't recompute the way the code does.
 */
class FakePrisma {
  balances: {
    id: string;
    productId: string;
    storeId: string;
    quantity: number;
    reorderThreshold: number;
    version: number;
  }[] = [];
  movements: { id: string; productId: string; storeId: string; delta: number }[] = [];
  private seq = 0;

  stockBalance = {
    findUnique: async ({
      where,
    }: {
      where: { productId_storeId: { productId: string; storeId: string } };
    }) => {
      const { productId, storeId } = where.productId_storeId;
      const row = this.balances.find((b) => b.productId === productId && b.storeId === storeId);
      // Return a snapshot, as a real read does: a concurrent writer that bumps the stored row
      // afterwards must not retroactively change the version this caller captured.
      return row ? { ...row } : null;
    },
    create: async ({
      data,
    }: {
      data: {
        productId: string;
        storeId: string;
        quantity: number;
        reorderThreshold: number;
        version: number;
      };
    }) => {
      const clash = this.balances.find(
        (b) => b.productId === data.productId && b.storeId === data.storeId,
      );
      // Model the unique (product, store) constraint so the first-movement race is testable.
      if (clash) throw { code: 'P2002' };
      const row = { id: `bal-${this.seq++}`, ...data };
      this.balances.push(row);
      return row;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { id: string; version: number };
      data: { quantity: number; version: number };
    }) => {
      const row = this.balances.find((b) => b.id === where.id && b.version === where.version);
      if (!row) return { count: 0 };
      row.quantity = data.quantity;
      row.version = data.version;
      return { count: 1 };
    },
  };

  stockMovement = {
    create: async ({ data }: { data: { productId: string; storeId: string; delta: number } }) => {
      const row = { id: `mov-${this.seq++}`, ...data };
      this.movements.push(row);
      return row;
    },
  };

  $transaction = async <T>(fn: (tx: FakePrisma) => Promise<T>): Promise<T> => fn(this);
}

async function createService(prisma: FakePrisma) {
  const moduleRef = await Test.createTestingModule({
    providers: [StockMovementService, { provide: PrismaService, useValue: prisma }],
  }).compile();
  return moduleRef.get(StockMovementService);
}

const base = { productId: 'p1', storeId: 's1', type: 'OPENING' as const, actorId: 'u1' };

/** The single balance row the tests act on, asserted present so strict indexing is satisfied. */
function onlyBalance(prisma: FakePrisma) {
  const row = prisma.balances[0];
  expect(row).toBeDefined();
  return row as NonNullable<typeof row>;
}

describe('StockMovementService.postMovement', () => {
  it('opens a balance and records before/after on the first movement', async () => {
    const prisma = new FakePrisma();
    const service = await createService(prisma);

    const result = await service.postMovement({ ...base, delta: 10, sourceDocument: 'OPEN' });

    expect(result).toMatchObject({ balanceBefore: 0, balanceAfter: 10 });
    expect(prisma.balances).toHaveLength(1);
    expect(onlyBalance(prisma)).toMatchObject({ quantity: 10, version: 0 });
    expect(prisma.movements).toHaveLength(1);
  });

  it('sets the per-store reorder threshold when it opens the balance', async () => {
    const prisma = new FakePrisma();
    const service = await createService(prisma);

    await service.postMovement({ ...base, delta: 10, sourceDocument: 'OPEN', reorderThreshold: 3 });

    expect(onlyBalance(prisma).reorderThreshold).toBe(3);
  });

  it('maps a first-movement race (unique violation on create) to CONFLICT', async () => {
    const prisma = new FakePrisma();
    const service = await createService(prisma);
    // A concurrent first movement created the row between this call's read and its create.
    prisma.stockBalance.findUnique = async () => null;
    prisma.balances.push({
      id: 'bal-x',
      productId: 'p1',
      storeId: 's1',
      quantity: 5,
      reorderThreshold: 0,
      version: 0,
    });

    await expect(
      service.postMovement({ ...base, delta: 1, type: 'GOODS_RECEIPT', sourceDocument: 'GR-1' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('updates the balance and bumps the version on a later movement', async () => {
    const prisma = new FakePrisma();
    const service = await createService(prisma);
    await service.postMovement({ ...base, delta: 10, sourceDocument: 'OPEN' });

    const result = await service.postMovement({
      ...base,
      delta: -4,
      type: 'SALE',
      sourceDocument: 'SAL-1',
    });

    expect(result).toMatchObject({ balanceBefore: 10, balanceAfter: 6 });
    expect(onlyBalance(prisma)).toMatchObject({ quantity: 6, version: 1 });
  });

  it('rejects a movement that would make the balance negative, writing nothing', async () => {
    const prisma = new FakePrisma();
    const service = await createService(prisma);
    await service.postMovement({ ...base, delta: 5, sourceDocument: 'OPEN' });

    await expect(
      service.postMovement({ ...base, delta: -6, type: 'SALE', sourceDocument: 'SAL-1' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(onlyBalance(prisma).quantity).toBe(5);
    expect(prisma.movements).toHaveLength(1);
  });

  it('rejects a concurrent update whose version moved under it (INV-04)', async () => {
    const prisma = new FakePrisma();
    const service = await createService(prisma);
    await service.postMovement({ ...base, delta: 10, sourceDocument: 'OPEN' });
    // Simulate another transaction committing between this call's read and its versioned update:
    // the optimistic-lock update matches zero rows.
    prisma.stockBalance.updateMany = async () => ({ count: 0 });

    await expect(
      service.postMovement({ ...base, delta: -1, type: 'SALE', sourceDocument: 'SAL-1' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('reconciles: balance equals opening plus the sum of movements, never negative', async () => {
    const prisma = new FakePrisma();
    const service = await createService(prisma);
    // An independent sequence: known deltas whose running total never dips below zero.
    const opening = 10;
    const deltas = [-3, 5, -2, -4, 6, -1];

    await service.postMovement({ ...base, delta: opening, sourceDocument: 'OPEN' });
    let running = opening;
    for (const delta of deltas) {
      running += delta;
      expect(running).toBeGreaterThanOrEqual(0); // guard the fixture itself
      const type = delta >= 0 ? 'GOODS_RECEIPT' : 'SALE';
      await service.postMovement({ ...base, delta, type, sourceDocument: 'DOC' });
    }

    const expected = opening + deltas.reduce((a, b) => a + b, 0);
    const movedSum = prisma.movements.reduce((a, m) => a + m.delta, 0);
    const balance = onlyBalance(prisma);
    expect(balance.quantity).toBe(expected);
    expect(balance.quantity).toBe(movedSum);
    expect(balance.quantity).toBeGreaterThanOrEqual(0);
  });
});
