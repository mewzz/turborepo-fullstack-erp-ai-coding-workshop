import { Test } from '@nestjs/testing';
import type { User } from '@erp/contracts';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../database/prisma.service.js';
import { StockAdjustmentService } from './stock-adjustment.service.js';
import { StockMovementService } from './stock-movement.service.js';

/**
 * An in-memory stand-in for the slice of Prisma the adjustment touches: the two ledger tables the
 * movement primitive uses, an `auditLog` append log, and an `$transaction` that runs the callback
 * against this same store so a rolled-back success never leaves a half-written pair. It is the
 * independent source of truth the assertions read back from.
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
  movements: {
    id: string;
    productId: string;
    storeId: string;
    delta: number;
    type: string;
    sourceDocument: string;
    actorId: string;
  }[] = [];
  auditLogs: {
    id: string;
    actorId: string;
    action: string;
    sourceDocument: string;
    outcome: string;
  }[] = [];
  private seq = 0;

  stockBalance = {
    findUnique: async ({
      where,
    }: {
      where: { productId_storeId: { productId: string; storeId: string } };
    }) => {
      const { productId, storeId } = where.productId_storeId;
      const row = this.balances.find((b) => b.productId === productId && b.storeId === storeId);
      return row ? { ...row } : null;
    },
    create: async ({ data }: { data: Omit<FakePrisma['balances'][number], 'id'> }) => {
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
    create: async ({ data }: { data: Omit<FakePrisma['movements'][number], 'id'> }) => {
      const row = { id: `mov-${this.seq++}`, ...data };
      this.movements.push(row);
      return row;
    },
  };

  auditLog = {
    create: async ({ data }: { data: Omit<FakePrisma['auditLogs'][number], 'id'> }) => {
      const row = { id: `aud-${this.seq++}`, ...data };
      this.auditLogs.push(row);
      return row;
    },
  };

  $transaction = async <T>(fn: (tx: FakePrisma) => Promise<T>): Promise<T> => {
    // Snapshot so a thrown callback leaves nothing half-written, as a real rollback would.
    const snapshot = {
      balances: structuredClone(this.balances),
      movements: structuredClone(this.movements),
      auditLogs: structuredClone(this.auditLogs),
    };
    try {
      return await fn(this);
    } catch (error) {
      this.balances = snapshot.balances;
      this.movements = snapshot.movements;
      this.auditLogs = snapshot.auditLogs;
      throw error;
    }
  };
}

async function createService(prisma: FakePrisma) {
  const moduleRef = await Test.createTestingModule({
    providers: [
      StockAdjustmentService,
      StockMovementService,
      { provide: PrismaService, useValue: prisma },
    ],
  }).compile();
  return moduleRef.get(StockAdjustmentService);
}

const manager: User = {
  id: 'u-mgr',
  email: 'manager01@erp.local',
  name: 'Manager One',
  role: 'MANAGER',
};

function openingBalance(prisma: FakePrisma, quantity: number) {
  prisma.balances.push({
    id: 'bal-seed',
    productId: 'p1',
    storeId: 's1',
    quantity,
    reorderThreshold: 3,
    version: 0,
  });
}

const base = { productId: 'p1', storeId: 's1', reason: 'นับสต็อกใหม่' } as const;

describe('StockAdjustmentService.adjust', () => {
  it('decreases the balance, writing an ADJUSTMENT movement with before/after history', async () => {
    const prisma = new FakePrisma();
    openingBalance(prisma, 10);
    const service = await createService(prisma);

    const result = await service.adjust({ ...base, direction: 'DECREASE', quantity: 4 }, manager);

    expect(result).toMatchObject({ balanceBefore: 10, balanceAfter: 6 });
    expect(prisma.movements).toHaveLength(1);
    expect(prisma.movements[0]).toMatchObject({ delta: -4, type: 'ADJUSTMENT' });
    expect(prisma.balances[0]?.quantity).toBe(6);
  });

  it('increases the balance with a positive delta', async () => {
    const prisma = new FakePrisma();
    openingBalance(prisma, 10);
    const service = await createService(prisma);

    const result = await service.adjust({ ...base, direction: 'INCREASE', quantity: 5 }, manager);

    expect(result.balanceAfter).toBe(15);
    expect(prisma.movements[0]).toMatchObject({ delta: 5, type: 'ADJUSTMENT' });
  });

  it('writes the movement and a SUCCESS audit entry together', async () => {
    const prisma = new FakePrisma();
    openingBalance(prisma, 10);
    const service = await createService(prisma);

    await service.adjust({ ...base, direction: 'DECREASE', quantity: 4 }, manager);

    expect(prisma.auditLogs).toHaveLength(1);
    expect(prisma.auditLogs[0]).toMatchObject({
      actorId: 'u-mgr',
      action: 'STOCK_ADJUSTMENT',
      outcome: 'SUCCESS',
    });
    // Same source document on the movement and the audit row: they describe one action.
    expect(prisma.auditLogs[0]?.sourceDocument).toBe(prisma.movements[0]?.sourceDocument);
  });

  it('rejects a decrease greater than the balance; stock never goes negative', async () => {
    const prisma = new FakePrisma();
    openingBalance(prisma, 5);
    const service = await createService(prisma);

    await expect(
      service.adjust({ ...base, direction: 'DECREASE', quantity: 6 }, manager),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(prisma.balances[0]?.quantity).toBe(5);
    expect(prisma.movements).toHaveLength(0);
  });

  it('records a FAILURE audit entry for a rejected over-reduction (append-only, NFR-03)', async () => {
    const prisma = new FakePrisma();
    openingBalance(prisma, 5);
    const service = await createService(prisma);

    await expect(
      service.adjust({ ...base, direction: 'DECREASE', quantity: 6 }, manager),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(prisma.auditLogs).toHaveLength(1);
    expect(prisma.auditLogs[0]).toMatchObject({
      actorId: 'u-mgr',
      action: 'STOCK_ADJUSTMENT',
      outcome: 'FAILURE',
    });
  });

  it('still surfaces the over-reduction when the FAILURE audit write itself fails', async () => {
    const prisma = new FakePrisma();
    openingBalance(prisma, 5);
    const service = await createService(prisma);
    prisma.auditLog.create = vi.fn(async () => {
      throw new Error('audit write failed');
    });

    await expect(
      service.adjust({ ...base, direction: 'DECREASE', quantity: 6 }, manager),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('writes nothing when the audit write fails, keeping the pair atomic', async () => {
    const prisma = new FakePrisma();
    openingBalance(prisma, 10);
    const service = await createService(prisma);
    // The audit insert throws inside the transaction: the movement and balance update roll back.
    prisma.auditLog.create = vi.fn(async () => {
      throw new Error('audit write failed');
    });

    await expect(
      service.adjust({ ...base, direction: 'DECREASE', quantity: 4 }, manager),
    ).rejects.toThrow();

    expect(prisma.movements).toHaveLength(0);
    expect(prisma.balances[0]?.quantity).toBe(10);
  });
});
