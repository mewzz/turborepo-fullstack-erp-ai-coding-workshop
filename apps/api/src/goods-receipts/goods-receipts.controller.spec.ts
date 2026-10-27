import { Test } from '@nestjs/testing';
import type { GoodsReceipt, User } from '@erp/contracts';
import { call } from '@orpc/server';
import { describe, expect, it, vi } from 'vitest';
import { ROLES_KEY } from '../auth/auth.decorators.js';
import { GoodsReceiptService } from './goods-receipt.service.js';
import { GoodsReceiptsController } from './goods-receipts.controller.js';

const employee: User = {
  id: 'e1',
  email: 'staff01@erp.local',
  name: 'Staff One',
  role: 'STORE_EMPLOYEE',
  storeId: 'st1',
};

const receipt: GoodsReceipt = {
  id: 'gr1',
  number: 'GR-0001',
  purchaseOrderId: 'po1',
  storeId: 'st1',
  receivedById: 'e1',
  receivedAt: '2026-01-15T10:00:00.000Z',
  lines: [{ productId: 'p1', productName: 'สินค้า 1', quantity: 4 }],
};

async function createController(service: Partial<GoodsReceiptService>) {
  const moduleRef = await Test.createTestingModule({
    controllers: [GoodsReceiptsController],
    providers: [{ provide: GoodsReceiptService, useValue: service }],
  }).compile();
  return moduleRef.get(GoodsReceiptsController);
}

describe('GoodsReceiptsController', () => {
  it('confirms a receipt, passing the input and current user through', async () => {
    const receive = vi.fn().mockResolvedValue(receipt);
    const controller = await createController({ receive });
    const input = {
      purchaseOrderId: 'po1',
      idempotencyKey: 'key-1',
      lines: [{ productId: 'p1', quantity: 4 }],
    };

    await expect(call(controller.receive(employee), input)).resolves.toEqual(receipt);
    expect(receive).toHaveBeenCalledWith(input, employee);
  });

  it('rejects an all-zero receipt at the contract edge, before the service', async () => {
    const receive = vi.fn();
    const controller = await createController({ receive });

    await expect(
      call(controller.receive(employee), {
        purchaseOrderId: 'po1',
        idempotencyKey: 'key-1',
        lines: [{ productId: 'p1', quantity: 0 }],
      }),
    ).rejects.toThrow();
    expect(receive).not.toHaveBeenCalled();
  });

  it('returns the receiving summary for an order', async () => {
    const summary = vi.fn().mockResolvedValue({
      purchaseOrderId: 'po1',
      purchaseOrderNumber: 'PO-0001',
      status: 'APPROVED',
      destinationStoreId: 'st1',
      lines: [],
    });
    const controller = await createController({ summary });

    await call(controller.summary(employee), { purchaseOrderId: 'po1' });
    expect(summary).toHaveBeenCalledWith('po1', employee);
  });

  it('lists the receipts of an order and fetches one', async () => {
    const listForOrder = vi.fn().mockResolvedValue([receipt]);
    const get = vi.fn().mockResolvedValue(receipt);
    const controller = await createController({ listForOrder, get });

    await expect(call(controller.listForOrder(employee), { purchaseOrderId: 'po1' })).resolves.toEqual([
      receipt,
    ]);
    await expect(call(controller.get(employee), { id: 'gr1' })).resolves.toEqual(receipt);
    expect(listForOrder).toHaveBeenCalledWith('po1', employee);
    expect(get).toHaveBeenCalledWith('gr1', employee);
  });

  it('allows only a store employee to confirm a receipt', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, GoodsReceiptsController.prototype.receive);

    expect(roles).toEqual(['STORE_EMPLOYEE']);
  });
});
