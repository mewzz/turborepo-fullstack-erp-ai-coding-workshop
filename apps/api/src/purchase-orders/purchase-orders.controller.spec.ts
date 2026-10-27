import { Test } from '@nestjs/testing';
import type { PurchaseOrder, User } from '@erp/contracts';
import { call } from '@orpc/server';
import { describe, expect, it, vi } from 'vitest';
import { PurchaseOrderService } from './purchase-order.service.js';
import { PurchaseOrdersController } from './purchase-orders.controller.js';

const officer: User = {
  id: 'u1',
  email: 'buyer01@erp.local',
  name: 'Buyer One',
  role: 'PURCHASING_OFFICER',
};
const manager: User = {
  id: 'm1',
  email: 'manager01@erp.local',
  name: 'Manager One',
  role: 'MANAGER',
};

const order: PurchaseOrder = {
  id: 'po1',
  number: 'PO-0001',
  supplierId: 's1',
  destinationStoreId: 'st1',
  expectedReceiptDate: '2026-01-15',
  status: 'DRAFT',
  createdById: 'u1',
  reason: null,
  lines: [
    { id: 'l1', productId: 'p1', productName: 'สินค้า 001', purchasePrice: 25.5, quantity: 10 },
  ],
};

const createInput = {
  supplierId: 's1',
  destinationStoreId: 'st1',
  expectedReceiptDate: '2026-01-15',
  lines: [{ productId: 'p1', quantity: 10, purchasePrice: 25.5 }],
};

async function createController(service: Partial<PurchaseOrderService>) {
  const moduleRef = await Test.createTestingModule({
    controllers: [PurchaseOrdersController],
    providers: [{ provide: PurchaseOrderService, useValue: service }],
  }).compile();
  return moduleRef.get(PurchaseOrdersController);
}

describe('PurchaseOrdersController', () => {
  it('lists orders', async () => {
    const controller = await createController({ list: vi.fn().mockResolvedValue([order]) });

    await expect(call(controller.list(), undefined)).resolves.toEqual([order]);
  });

  it('gets one order', async () => {
    const controller = await createController({ get: vi.fn().mockResolvedValue(order) });

    await expect(call(controller.get(), { id: 'po1' })).resolves.toEqual(order);
  });

  it('creates an order, passing the current user through', async () => {
    const create = vi.fn().mockResolvedValue(order);
    const controller = await createController({ create });

    await expect(call(controller.create(officer), createInput)).resolves.toEqual(order);
    expect(create).toHaveBeenCalledWith(createInput, officer);
  });

  it('updates a draft, passing the current user through', async () => {
    const update = vi.fn().mockResolvedValue(order);
    const controller = await createController({ update });

    await call(controller.update(officer), { id: 'po1', ...createInput });
    expect(update).toHaveBeenCalledWith({ id: 'po1', ...createInput }, officer);
  });

  it('submits via the transition service', async () => {
    const transition = vi.fn().mockResolvedValue({ ...order, status: 'PENDING_APPROVAL' });
    const controller = await createController({ transition });

    await call(controller.submit(officer), { id: 'po1' });
    expect(transition).toHaveBeenCalledWith('submit', { id: 'po1' }, officer);
  });

  it('approves via the transition service', async () => {
    const transition = vi.fn().mockResolvedValue({ ...order, status: 'APPROVED' });
    const controller = await createController({ transition });

    await call(controller.approve(manager), { id: 'po1' });
    expect(transition).toHaveBeenCalledWith('approve', { id: 'po1' }, manager);
  });

  it('rejects with a reason via the transition service', async () => {
    const transition = vi
      .fn()
      .mockResolvedValue({ ...order, status: 'REJECTED', reason: 'ราคาสูงไป' });
    const controller = await createController({ transition });

    await call(controller.reject(manager), { id: 'po1', reason: 'ราคาสูงไป' });
    expect(transition).toHaveBeenCalledWith('reject', { id: 'po1', reason: 'ราคาสูงไป' }, manager);
  });

  it('cancels with a reason via the transition service', async () => {
    const transition = vi
      .fn()
      .mockResolvedValue({ ...order, status: 'CANCELLED', reason: 'ยกเลิก' });
    const controller = await createController({ transition });

    await call(controller.cancel(officer), { id: 'po1', reason: 'ยกเลิก' });
    expect(transition).toHaveBeenCalledWith('cancel', { id: 'po1', reason: 'ยกเลิก' }, officer);
  });
});
