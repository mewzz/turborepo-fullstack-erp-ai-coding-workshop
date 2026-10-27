import { Test } from '@nestjs/testing';
import type { User } from '@erp/contracts';
import { call } from '@orpc/server';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../database/prisma.service.js';
import { InventoryController } from './inventory.controller.js';

function balanceRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    productId: 'p1',
    storeId: 's1',
    quantity: 10,
    reorderThreshold: 3,
    product: { sku: 'SKU001', name: 'สินค้า 001', unit: 'ชิ้น' },
    store: { code: 'B01' },
    ...over,
  };
}

async function createController(findMany: ReturnType<typeof vi.fn>) {
  const moduleRef = await Test.createTestingModule({
    controllers: [InventoryController],
    providers: [{ provide: PrismaService, useValue: { stockBalance: { findMany } } }],
  }).compile();
  return moduleRef.get(InventoryController);
}

const admin: User = { id: 'u1', email: 'admin@erp.local', name: 'Admin', role: 'ADMINISTRATOR' };
const employee: User = {
  id: 'u2',
  email: 'staff@erp.local',
  name: 'Staff',
  role: 'STORE_EMPLOYEE',
  storeId: 's1',
};

describe('InventoryController.search', () => {
  it('returns quantity, unit, threshold and low-stock for each row', async () => {
    const findMany = vi.fn().mockResolvedValue([balanceRow()]);
    const controller = await createController(findMany);

    await expect(call(controller.search(admin), {})).resolves.toEqual([
      {
        productId: 'p1',
        sku: 'SKU001',
        name: 'สินค้า 001',
        unit: 'ชิ้น',
        storeId: 's1',
        storeCode: 'B01',
        quantity: 10,
        reorderThreshold: 3,
        lowStock: false,
      },
    ]);
  });

  it('flags low-stock inclusively when quantity equals the threshold', async () => {
    const findMany = vi.fn().mockResolvedValue([balanceRow({ quantity: 3, reorderThreshold: 3 })]);
    const controller = await createController(findMany);

    const results = await call(controller.search(admin), {});
    expect(results[0]?.lowStock).toBe(true);
  });

  it('does not flag low-stock when quantity is above the threshold', async () => {
    const findMany = vi.fn().mockResolvedValue([balanceRow({ quantity: 4, reorderThreshold: 3 })]);
    const controller = await createController(findMany);

    const results = await call(controller.search(admin), {});
    expect(results[0]?.lowStock).toBe(false);
  });

  it('filters by SKU or name when a query is given', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const controller = await createController(findMany);

    await call(controller.search(admin), { query: 'SKU001' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          product: {
            OR: [
              { sku: { contains: 'SKU001', mode: 'insensitive' } },
              { name: { contains: 'SKU001', mode: 'insensitive' } },
            ],
          },
        }),
      }),
    );
  });

  it('filters by the requested store for an unscoped role', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const controller = await createController(findMany);

    await call(controller.search(admin), { storeId: 's2' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ storeId: 's2' }) }),
    );
  });

  it('clamps a store employee to their assigned store, ignoring a wider request', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const controller = await createController(findMany);

    await call(controller.search(employee), { storeId: 's2' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ storeId: 's1' }) }),
    );
  });

  it('returns nothing for a store employee with no assigned store, without querying', async () => {
    const findMany = vi.fn();
    const controller = await createController(findMany);
    const unassigned: User = { ...employee, storeId: null };

    await expect(call(controller.search(unassigned), {})).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
