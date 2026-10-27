import { Test } from '@nestjs/testing';
import type { User } from '@erp/contracts';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../database/prisma.service.js';
import { StockMovementService } from '../inventory/stock-movement.service.js';
import { SaleService } from './sale.service.js';

const employee: User = {
  id: 'u1',
  email: 'staff_b01@erp.local',
  name: 'Staff B01',
  role: 'STORE_EMPLOYEE',
  storeId: 'st1',
};
const otherStoreEmployee: User = { ...employee, id: 'u2', storeId: 'st2' };
const manager: User = {
  id: 'm1',
  email: 'manager01@erp.local',
  name: 'Manager One',
  role: 'MANAGER',
};

function saleRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sale1',
    number: null,
    storeId: 'st1',
    status: 'DRAFT',
    createdById: 'u1',
    confirmedAt: null,
    lines: [
      { id: 'l1', productId: 'p1', productName: 'สินค้า 001', unitPrice: '45.00', quantity: 3 },
    ],
    ...over,
  };
}

const createInput = { storeId: 'st1', lines: [{ productId: 'p1', quantity: 3 }] };

/**
 * A fake PrismaService. Each test provides only the models and behaviour the path under test needs.
 * `$transaction(fn)` runs the callback with the same object, so the service's confirm transaction
 * executes inline against these mocks.
 */
function fakePrisma(partial: Record<string, unknown>) {
  const prisma: Record<string, unknown> = {
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    $queryRaw: vi.fn().mockResolvedValue([{ n: 1n }]),
    ...partial,
  };
  return prisma;
}

async function createService(
  prisma: Record<string, unknown>,
  movements?: Partial<StockMovementService>,
) {
  const moduleRef = await Test.createTestingModule({
    providers: [
      SaleService,
      { provide: PrismaService, useValue: prisma },
      {
        provide: StockMovementService,
        useValue: movements ?? { postMovement: vi.fn().mockResolvedValue({}) },
      },
    ],
  }).compile();
  return moduleRef.get(SaleService);
}

describe('SaleService.create', () => {
  it('snapshots the current selling price, starts DRAFT with no number, and posts no stock (SAL-01/02)', async () => {
    const create = vi.fn().mockResolvedValue(saleRow());
    const postMovement = vi.fn();
    const prisma = fakePrisma({
      product: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: 'p1', name: 'สินค้า 001', sellingPrice: '45.00', active: true },
          ]),
      },
      sale: { create },
    });
    const service = await createService(prisma, { postMovement });

    await service.create(createInput, employee);

    const data = create.mock.calls[0]?.[0]?.data;
    expect(data.status).toBe('DRAFT');
    expect(data.number).toBeUndefined();
    expect(data.createdById).toBe('u1');
    expect(data.lines.create[0]).toMatchObject({ productName: 'สินค้า 001', unitPrice: 45 });
    expect(postMovement).not.toHaveBeenCalled();
  });

  it('forbids a store employee creating a sale for another store (SAL-01)', async () => {
    const prisma = fakePrisma({ product: { findMany: vi.fn() }, sale: { create: vi.fn() } });
    const service = await createService(prisma);

    await expect(service.create(createInput, otherStoreEmployee)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('rejects an unknown or inactive product (SAL-01)', async () => {
    const prisma = fakePrisma({
      product: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: 'p1', name: 'สินค้า 001', sellingPrice: '45.00', active: false },
          ]),
      },
      sale: { create: vi.fn() },
    });
    const service = await createService(prisma);

    await expect(service.create(createInput, employee)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
});

describe('SaleService.confirm', () => {
  const confirmInput = { id: 'sale1', idempotencyKey: 'key-1' };

  it('rejects the whole sale and names every short product when any line is short (AC-05)', async () => {
    const postMovement = vi.fn();
    const prisma = fakePrisma({
      idempotencyKey: { findUnique: vi.fn().mockResolvedValue(null) },
      sale: {
        findUnique: vi.fn().mockResolvedValue(
          saleRow({
            lines: [
              {
                id: 'l1',
                productId: 'p1',
                productName: 'สินค้า 001',
                unitPrice: '45.00',
                quantity: 3,
              },
              {
                id: 'l2',
                productId: 'p2',
                productName: 'สินค้า 002',
                unitPrice: '30.00',
                quantity: 5,
              },
            ],
          }),
        ),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          { productId: 'p1', storeId: 'st1', quantity: 2 },
          { productId: 'p2', storeId: 'st1', quantity: 0 },
        ]),
      },
    });
    const service = await createService(prisma, { postMovement });

    const error = await service.confirm(confirmInput, employee).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'CONFLICT' });
    const message = (error as { message: string }).message;
    expect(message).toContain('สินค้า 001');
    expect(message).toContain('สินค้า 002');
    expect(postMovement).not.toHaveBeenCalled();
  });

  it('confirms: sets number and status, and posts one SALE movement per line in the same transaction (AC-06)', async () => {
    const postMovement = vi.fn().mockResolvedValue({});
    const update = vi
      .fn()
      .mockResolvedValue(
        saleRow({ status: 'CONFIRMED', number: 'SALE-0001', confirmedAt: new Date() }),
      );
    const idempotencyCreate = vi.fn();
    const prisma = fakePrisma({
      idempotencyKey: { findUnique: vi.fn().mockResolvedValue(null), create: idempotencyCreate },
      sale: { findUnique: vi.fn().mockResolvedValue(saleRow()), update },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([{ productId: 'p1', storeId: 'st1', quantity: 10 }]),
      },
    });
    const service = await createService(prisma, { postMovement });

    const result = await service.confirm(confirmInput, employee);

    expect(result.status).toBe('CONFIRMED');
    expect(result.number).toBe('SALE-0001');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'CONFIRMED', number: 'SALE-0001' }),
      }),
    );
    expect(idempotencyCreate).toHaveBeenCalled();
    expect(postMovement).toHaveBeenCalledTimes(1);
    const [movementInput, tx] = postMovement.mock.calls[0]!;
    expect(movementInput).toMatchObject({
      productId: 'p1',
      storeId: 'st1',
      delta: -3,
      type: 'SALE',
    });
    expect(tx).toBe(prisma); // posted inside the sale's transaction
  });

  it('returns the original sale on a duplicate confirm, with no second sale or deduction (AC-06)', async () => {
    const postMovement = vi.fn();
    const confirmed = saleRow({ status: 'CONFIRMED', number: 'SALE-0001' });
    const update = vi.fn();
    const prisma = fakePrisma({
      idempotencyKey: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ key: 'key-1', documentType: 'SALE', documentId: 'sale1' }),
      },
      sale: { findUnique: vi.fn().mockResolvedValue(confirmed), update },
      stockBalance: { findMany: vi.fn() },
    });
    const service = await createService(prisma, { postMovement });

    const result = await service.confirm(confirmInput, employee);

    expect(result.number).toBe('SALE-0001');
    expect(update).not.toHaveBeenCalled();
    expect(postMovement).not.toHaveBeenCalled();
  });

  it('loses the race when the stock primitive reports a conflict (INV-04, AC-07)', async () => {
    const conflict = { code: 'CONFLICT', message: 'สต็อกถูกแก้ไขโดยรายการอื่น กรุณาลองใหม่' };
    const postMovement = vi.fn().mockRejectedValue(conflict);
    const prisma = fakePrisma({
      idempotencyKey: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
      sale: { findUnique: vi.fn().mockResolvedValue(saleRow()), update: vi.fn() },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([{ productId: 'p1', storeId: 'st1', quantity: 10 }]),
      },
    });
    const service = await createService(prisma, { postMovement });

    await expect(service.confirm(confirmInput, employee)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('refuses to confirm an already-confirmed sale: terminal, never re-sold (SAL-04)', async () => {
    const postMovement = vi.fn();
    const prisma = fakePrisma({
      idempotencyKey: { findUnique: vi.fn().mockResolvedValue(null) },
      sale: {
        findUnique: vi
          .fn()
          .mockResolvedValue(saleRow({ status: 'CONFIRMED', number: 'SALE-0001' })),
      },
      stockBalance: { findMany: vi.fn() },
    });
    const service = await createService(prisma, { postMovement });

    await expect(service.confirm(confirmInput, employee)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(postMovement).not.toHaveBeenCalled();
  });

  it('forbids confirming a sale for another store (SAL-01)', async () => {
    const prisma = fakePrisma({
      idempotencyKey: { findUnique: vi.fn().mockResolvedValue(null) },
      sale: { findUnique: vi.fn().mockResolvedValue(saleRow()) },
      stockBalance: { findMany: vi.fn() },
    });
    const service = await createService(prisma);

    await expect(service.confirm(confirmInput, otherStoreEmployee)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('returns NOT_FOUND for a missing sale', async () => {
    const prisma = fakePrisma({
      idempotencyKey: { findUnique: vi.fn().mockResolvedValue(null) },
      sale: { findUnique: vi.fn().mockResolvedValue(null) },
      stockBalance: { findMany: vi.fn() },
    });
    const service = await createService(prisma);

    await expect(service.confirm(confirmInput, employee)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('SaleService.get', () => {
  it('lets a manager view a sale for any store (consistent with list)', async () => {
    const prisma = fakePrisma({
      sale: { findUnique: vi.fn().mockResolvedValue(saleRow({ storeId: 'st9' })) },
    });
    const service = await createService(prisma);

    const result = await service.get('sale1', manager);

    expect(result.id).toBe('sale1');
  });

  it('forbids a store employee viewing another store`s sale', async () => {
    const prisma = fakePrisma({
      sale: { findUnique: vi.fn().mockResolvedValue(saleRow({ storeId: 'st1' })) },
    });
    const service = await createService(prisma);

    await expect(service.get('sale1', otherStoreEmployee)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('returns NOT_FOUND for a missing sale', async () => {
    const prisma = fakePrisma({ sale: { findUnique: vi.fn().mockResolvedValue(null) } });
    const service = await createService(prisma);

    await expect(service.get('nope', employee)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('SaleService.list', () => {
  it('scopes a store employee to their own store', async () => {
    const findMany = vi.fn().mockResolvedValue([saleRow()]);
    const prisma = fakePrisma({ sale: { findMany } });
    const service = await createService(prisma);

    await service.list(employee);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { storeId: 'st1' } }));
  });

  it('shows a manager every store`s sales', async () => {
    const findMany = vi.fn().mockResolvedValue([saleRow()]);
    const prisma = fakePrisma({ sale: { findMany } });
    const service = await createService(prisma);

    await service.list(manager);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
});
