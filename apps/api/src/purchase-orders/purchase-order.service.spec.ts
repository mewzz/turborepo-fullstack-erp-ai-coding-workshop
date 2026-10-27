import { Test } from '@nestjs/testing';
import type { User } from '@erp/contracts';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../database/prisma.service.js';
import { PurchaseOrderService } from './purchase-order.service.js';

const officer: User = {
  id: 'u1',
  email: 'buyer01@erp.local',
  name: 'Buyer One',
  role: 'PURCHASING_OFFICER',
};
const otherOfficer: User = { ...officer, id: 'u2', email: 'buyer02@erp.local' };
const manager: User = {
  id: 'm1',
  email: 'manager01@erp.local',
  name: 'Manager One',
  role: 'MANAGER',
};

function orderRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'po1',
    number: 'PO-0001',
    supplierId: 's1',
    destinationStoreId: 'st1',
    expectedReceiptDate: '2026-01-15',
    status: 'DRAFT',
    createdById: 'u1',
    reason: null,
    lines: [
      { id: 'l1', productId: 'p1', productName: 'สินค้า 001', purchasePrice: '25.50', quantity: 10 },
    ],
    ...over,
  };
}

/**
 * The PrismaService mock exposes only the models the lifecycle is allowed to touch. It deliberately
 * omits `stockBalance` and `stockMovement`, so any attempt to post stock would throw here and fail
 * the test. That is how these specs enforce the no-stock-effect rule (PO-02).
 */
async function createService(prismaModel: Record<string, unknown>) {
  const moduleRef = await Test.createTestingModule({
    providers: [PurchaseOrderService, { provide: PrismaService, useValue: prismaModel }],
  }).compile();
  return { service: moduleRef.get(PurchaseOrderService) };
}

const createInput = {
  supplierId: 's1',
  destinationStoreId: 'st1',
  expectedReceiptDate: '2026-01-15',
  lines: [{ productId: 'p1', quantity: 10, purchasePrice: 25.5 }],
};

describe('PurchaseOrderService.create', () => {
  it('snapshots the product name and price at creation and never touches stock', async () => {
    const create = vi.fn().mockResolvedValue(orderRow());
    const { service } = await createService({
      product: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'p1', name: 'สินค้า 001', active: true }]),
      },
      purchaseOrder: { create, count: vi.fn().mockResolvedValue(0) },
    });

    await service.create(createInput, officer);

    const data = create.mock.calls[0]?.[0]?.data;
    expect(data.createdById).toBe('u1');
    expect(data.status).toBe('DRAFT');
    expect(data.lines.create[0]).toMatchObject({ productName: 'สินค้า 001', purchasePrice: 25.5 });
  });

  it('generates a sequential, padded document number', async () => {
    const create = vi.fn().mockResolvedValue(orderRow({ number: 'PO-0043' }));
    const { service } = await createService({
      product: {
        findMany: vi.fn().mockResolvedValue([{ id: 'p1', name: 'สินค้า 001', active: true }]),
      },
      purchaseOrder: { create, count: vi.fn().mockResolvedValue(42) },
    });

    await service.create(createInput, officer);

    expect(create.mock.calls[0]?.[0]?.data.number).toBe('PO-0043');
  });

  it('rejects a line whose product does not exist', async () => {
    const { service } = await createService({
      product: { findMany: vi.fn().mockResolvedValue([]) },
      purchaseOrder: { create: vi.fn(), count: vi.fn().mockResolvedValue(0) },
    });

    await expect(service.create(createInput, officer)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('rejects a line whose product is deactivated', async () => {
    const { service } = await createService({
      product: {
        findMany: vi.fn().mockResolvedValue([{ id: 'p1', name: 'สินค้า 001', active: false }]),
      },
      purchaseOrder: { create: vi.fn(), count: vi.fn().mockResolvedValue(0) },
    });

    await expect(service.create(createInput, officer)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
});

describe('PurchaseOrderService.update', () => {
  it('edits a draft, re-snapshotting the lines', async () => {
    const update = vi.fn().mockResolvedValue(orderRow());
    const deleteMany = vi.fn();
    const tx = {
      purchaseOrderLine: { deleteMany },
      purchaseOrder: { update },
    };
    const { service } = await createService({
      product: {
        findMany: vi.fn().mockResolvedValue([{ id: 'p1', name: 'สินค้า 001', active: true }]),
      },
      purchaseOrder: {
        findUnique: vi.fn().mockResolvedValue(orderRow({ status: 'DRAFT' })),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx)),
    });

    await service.update({ id: 'po1', ...createInput }, officer);

    expect(deleteMany).toHaveBeenCalledWith({ where: { purchaseOrderId: 'po1' } });
    expect(update).toHaveBeenCalled();
  });

  it('refuses to edit a non-draft order (frozen once approved, PO-03)', async () => {
    const { service } = await createService({
      product: {
        findMany: vi.fn().mockResolvedValue([{ id: 'p1', name: 'สินค้า 001', active: true }]),
      },
      purchaseOrder: { findUnique: vi.fn().mockResolvedValue(orderRow({ status: 'APPROVED' })) },
    });

    await expect(service.update({ id: 'po1', ...createInput }, officer)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('refuses to edit an order the caller did not create', async () => {
    const { service } = await createService({
      product: {
        findMany: vi.fn().mockResolvedValue([{ id: 'p1', name: 'สินค้า 001', active: true }]),
      },
      purchaseOrder: { findUnique: vi.fn().mockResolvedValue(orderRow({ status: 'DRAFT' })) },
    });

    await expect(service.update({ id: 'po1', ...createInput }, otherOfficer)).rejects.toMatchObject(
      { code: 'FORBIDDEN' },
    );
  });

  it('returns NOT_FOUND for a missing order', async () => {
    const { service } = await createService({
      purchaseOrder: { findUnique: vi.fn().mockResolvedValue(null) },
    });

    await expect(service.update({ id: 'nope', ...createInput }, officer)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('PurchaseOrderService.transition', () => {
  it('submits a draft for its creator and never touches stock', async () => {
    const update = vi.fn().mockResolvedValue(orderRow({ status: 'PENDING_APPROVAL' }));
    const { service } = await createService({
      purchaseOrder: { findUnique: vi.fn().mockResolvedValue(orderRow()), update },
    });

    const result = await service.transition('submit', { id: 'po1' }, officer);

    expect(result.status).toBe('PENDING_APPROVAL');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING_APPROVAL' }) }),
    );
  });

  it('approves a pending order for a manager without touching stock (PO-02)', async () => {
    const update = vi.fn().mockResolvedValue(orderRow({ status: 'APPROVED' }));
    const { service } = await createService({
      purchaseOrder: {
        findUnique: vi.fn().mockResolvedValue(orderRow({ status: 'PENDING_APPROVAL' })),
        update,
      },
    });

    const result = await service.transition('approve', { id: 'po1' }, manager);

    expect(result.status).toBe('APPROVED');
  });

  it('stores the reason on reject', async () => {
    const update = vi.fn().mockResolvedValue(orderRow({ status: 'REJECTED', reason: 'ราคาสูงไป' }));
    const { service } = await createService({
      purchaseOrder: {
        findUnique: vi.fn().mockResolvedValue(orderRow({ status: 'PENDING_APPROVAL' })),
        update,
      },
    });

    await service.transition('reject', { id: 'po1', reason: 'ราคาสูงไป' }, manager);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'REJECTED', reason: 'ราคาสูงไป' }),
      }),
    );
  });

  it('forbids a non-creator from submitting', async () => {
    const { service } = await createService({
      purchaseOrder: { findUnique: vi.fn().mockResolvedValue(orderRow()) },
    });

    await expect(service.transition('submit', { id: 'po1' }, otherOfficer)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('rejects cancelling an approved order (PO-04)', async () => {
    const { service } = await createService({
      purchaseOrder: { findUnique: vi.fn().mockResolvedValue(orderRow({ status: 'APPROVED' })) },
    });

    await expect(
      service.transition('cancel', { id: 'po1', reason: 'ยกเลิก' }, manager),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('returns NOT_FOUND for a missing order', async () => {
    const { service } = await createService({
      purchaseOrder: { findUnique: vi.fn().mockResolvedValue(null) },
    });

    await expect(service.transition('submit', { id: 'nope' }, officer)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
