import { Test } from '@nestjs/testing';
import { call } from '@orpc/server';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../database/prisma.service.js';
import { SuppliersController } from './suppliers.controller.js';

const supplier = {
  id: 's1',
  code: 'SUP01',
  name: 'บริษัท ตัวอย่าง จำกัด',
  contactName: 'ฝ่ายขาย',
  contactEmail: 'sales@sup01.local',
  contactPhone: '021112222',
};

async function createController(model: Record<string, unknown>) {
  const moduleRef = await Test.createTestingModule({
    controllers: [SuppliersController],
    providers: [{ provide: PrismaService, useValue: { supplier: model } }],
  }).compile();
  return moduleRef.get(SuppliersController);
}

describe('SuppliersController', () => {
  it('lists suppliers', async () => {
    const controller = await createController({ findMany: vi.fn().mockResolvedValue([supplier]) });

    await expect(call(controller.list(), undefined)).resolves.toEqual([supplier]);
  });

  it('gets one supplier', async () => {
    const controller = await createController({ findUnique: vi.fn().mockResolvedValue(supplier) });

    await expect(call(controller.get(), { id: 's1' })).resolves.toEqual(supplier);
  });

  it('returns NOT_FOUND for a missing supplier', async () => {
    const controller = await createController({ findUnique: vi.fn().mockResolvedValue(null) });

    await expect(call(controller.get(), { id: 'nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('creates a supplier', async () => {
    const create = vi.fn().mockResolvedValue(supplier);
    const controller = await createController({ create });
    const { id: _id, ...input } = supplier;

    await expect(call(controller.create(), input)).resolves.toEqual(supplier);
    expect(create).toHaveBeenCalledWith({ data: input });
  });

  it('rejects a duplicate code with CONFLICT', async () => {
    const create = vi.fn().mockRejectedValue({ code: 'P2002' });
    const controller = await createController({ create });
    const { id: _id, ...input } = supplier;

    await expect(call(controller.create(), input)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('updates a supplier', async () => {
    const update = vi.fn().mockResolvedValue({ ...supplier, name: 'ชื่อใหม่' });
    const controller = await createController({ update });

    await expect(call(controller.update(), { id: 's1', name: 'ชื่อใหม่' })).resolves.toMatchObject({
      name: 'ชื่อใหม่',
    });
    expect(update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { name: 'ชื่อใหม่' } });
  });

  it('returns NOT_FOUND when updating a missing supplier', async () => {
    const update = vi.fn().mockRejectedValue({ code: 'P2025' });
    const controller = await createController({ update });

    await expect(call(controller.update(), { id: 'nope', name: 'x' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
