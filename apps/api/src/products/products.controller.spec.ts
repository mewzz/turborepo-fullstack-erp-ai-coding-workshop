import { Test } from '@nestjs/testing';
import { call } from '@orpc/server';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../database/prisma.service.js';
import { ProductsController } from './products.controller.js';

const row = {
  id: 'p1',
  sku: 'SKU001',
  name: 'สินค้า 001',
  category: 'ทั่วไป',
  unit: 'ชิ้น',
  sellingPrice: { toString: () => '45.00' },
  active: true,
};
const expected = {
  id: 'p1',
  sku: 'SKU001',
  name: 'สินค้า 001',
  category: 'ทั่วไป',
  unit: 'ชิ้น',
  sellingPrice: 45,
  active: true,
};

async function createController(product: Record<string, unknown>) {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProductsController],
    providers: [{ provide: PrismaService, useValue: { product } }],
  }).compile();
  return moduleRef.get(ProductsController);
}

describe('ProductsController', () => {
  it('lists products, converting the Decimal price to a number', async () => {
    const controller = await createController({ findMany: vi.fn().mockResolvedValue([row]) });

    await expect(call(controller.list(), undefined)).resolves.toEqual([expected]);
  });

  it('gets one product', async () => {
    const controller = await createController({ findUnique: vi.fn().mockResolvedValue(row) });

    await expect(call(controller.get(), { id: 'p1' })).resolves.toEqual(expected);
  });

  it('returns NOT_FOUND for a missing product', async () => {
    const controller = await createController({ findUnique: vi.fn().mockResolvedValue(null) });

    await expect(call(controller.get(), { id: 'nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('creates a product with active defaulting to true', async () => {
    const create = vi.fn().mockResolvedValue(row);
    const controller = await createController({ create });

    await expect(
      call(controller.create(), {
        sku: 'SKU001',
        name: 'สินค้า 001',
        category: 'ทั่วไป',
        unit: 'ชิ้น',
        sellingPrice: 45,
      }),
    ).resolves.toEqual(expected);
    expect(create).toHaveBeenCalledWith({
      data: {
        sku: 'SKU001',
        name: 'สินค้า 001',
        category: 'ทั่วไป',
        unit: 'ชิ้น',
        sellingPrice: 45,
      },
    });
  });

  it('rejects a duplicate SKU with CONFLICT', async () => {
    const create = vi.fn().mockRejectedValue({ code: 'P2002' });
    const controller = await createController({ create });

    await expect(
      call(controller.create(), {
        sku: 'SKU001',
        name: 'สินค้า 001',
        category: 'ทั่วไป',
        unit: 'ชิ้น',
        sellingPrice: 45,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('updates a product without touching the SKU', async () => {
    const update = vi.fn().mockResolvedValue({ ...row, sellingPrice: { toString: () => '50.00' } });
    const controller = await createController({ update });

    await expect(call(controller.update(), { id: 'p1', sellingPrice: 50 })).resolves.toMatchObject({
      sellingPrice: 50,
    });
    expect(update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { sellingPrice: 50 } });
  });

  it('returns NOT_FOUND when updating a missing product', async () => {
    const update = vi.fn().mockRejectedValue({ code: 'P2025' });
    const controller = await createController({ update });

    await expect(call(controller.update(), { id: 'nope', name: 'x' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('deactivates a product', async () => {
    const update = vi.fn().mockResolvedValue({ ...row, active: false });
    const controller = await createController({ update });

    await expect(call(controller.deactivate(), { id: 'p1' })).resolves.toMatchObject({
      active: false,
    });
    expect(update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { active: false } });
  });

  it('reactivates a product', async () => {
    const update = vi.fn().mockResolvedValue({ ...row, active: true });
    const controller = await createController({ update });

    await expect(call(controller.reactivate(), { id: 'p1' })).resolves.toMatchObject({
      active: true,
    });
    expect(update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { active: true } });
  });
});
