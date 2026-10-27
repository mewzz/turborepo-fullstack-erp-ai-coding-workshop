import { Test } from '@nestjs/testing';
import type { Sale, User } from '@erp/contracts';
import { call } from '@orpc/server';
import { describe, expect, it, vi } from 'vitest';
import { SaleService } from './sale.service.js';
import { SalesController } from './sales.controller.js';

const employee: User = {
  id: 'u1',
  email: 'staff_b01@erp.local',
  name: 'Staff B01',
  role: 'STORE_EMPLOYEE',
  storeId: 'st1',
};

const sale: Sale = {
  id: 'sale1',
  number: null,
  storeId: 'st1',
  status: 'DRAFT',
  createdById: 'u1',
  confirmedAt: null,
  lines: [{ id: 'l1', productId: 'p1', productName: 'สินค้า 001', unitPrice: 45, quantity: 3 }],
};

const createInput = { storeId: 'st1', lines: [{ productId: 'p1', quantity: 3 }] };

async function createController(service: Partial<SaleService>) {
  const moduleRef = await Test.createTestingModule({
    controllers: [SalesController],
    providers: [{ provide: SaleService, useValue: service }],
  }).compile();
  return moduleRef.get(SalesController);
}

describe('SalesController', () => {
  it('lists sales for the current user', async () => {
    const list = vi.fn().mockResolvedValue([sale]);
    const controller = await createController({ list });

    await expect(call(controller.list(employee), undefined)).resolves.toEqual([sale]);
    expect(list).toHaveBeenCalledWith(employee);
  });

  it('gets one sale for the current user', async () => {
    const get = vi.fn().mockResolvedValue(sale);
    const controller = await createController({ get });

    await expect(call(controller.get(employee), { id: 'sale1' })).resolves.toEqual(sale);
    expect(get).toHaveBeenCalledWith('sale1', employee);
  });

  it('creates a draft, passing the current user through', async () => {
    const create = vi.fn().mockResolvedValue(sale);
    const controller = await createController({ create });

    await expect(call(controller.create(employee), createInput)).resolves.toEqual(sale);
    expect(create).toHaveBeenCalledWith(createInput, employee);
  });

  it('confirms a sale, passing the current user through', async () => {
    const confirmed = { ...sale, status: 'CONFIRMED' as const, number: 'SALE-0001' };
    const confirm = vi.fn().mockResolvedValue(confirmed);
    const controller = await createController({ confirm });

    await expect(
      call(controller.confirm(employee), { id: 'sale1', idempotencyKey: 'key-1' }),
    ).resolves.toEqual(confirmed);
    expect(confirm).toHaveBeenCalledWith({ id: 'sale1', idempotencyKey: 'key-1' }, employee);
  });
});
