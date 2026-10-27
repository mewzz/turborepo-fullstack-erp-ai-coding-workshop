import { Test } from '@nestjs/testing';
import type { PurchaseOrderStatus, User } from '@erp/contracts';
import { ORPCError } from '@orpc/nest';
import { describe, expect, it } from 'vitest';
import { PrismaService } from '../database/prisma.service.js';
import { StockMovementService } from '../inventory/stock-movement.service.js';
import { GoodsReceiptService } from './goods-receipt.service.js';

const employee: User = {
  id: 'e1',
  email: 'staff01@erp.local',
  name: 'Staff One',
  role: 'STORE_EMPLOYEE',
  storeId: 'st1',
};
const otherStoreEmployee: User = { ...employee, id: 'e2', storeId: 'st2' };
const manager: User = {
  id: 'm1',
  email: 'manager01@erp.local',
  name: 'Manager',
  role: 'MANAGER',
  storeId: null,
};

interface OrderState {
  id: string;
  number: string;
  destinationStoreId: string;
  status: PurchaseOrderStatus;
  lines: { productId: string; productName: string; quantity: number }[];
}
interface ReceiptState {
  id: string;
  number: string;
  purchaseOrderId: string;
  storeId: string;
  receivedById: string;
  receivedAt: Date;
  lines: { productId: string; productName: string; quantity: number }[];
}
interface State {
  orders: OrderState[];
  receipts: ReceiptState[];
  keys: { key: string; documentType: string; documentId: string }[];
  stock: Record<string, number>;
  movements: { productId: string; storeId: string; delta: number; sourceDocument: string }[];
  seq: number;
}

const freshOrder = (over: Partial<OrderState> = {}): OrderState => ({
  id: 'po1',
  number: 'PO-0001',
  destinationStoreId: 'st1',
  status: 'APPROVED',
  lines: [
    { productId: 'p1', productName: 'สินค้า 1', quantity: 10 },
    { productId: 'p2', productName: 'สินค้า 2', quantity: 5 },
  ],
  ...over,
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * An in-memory stand-in for the slice of Prisma the service uses. It is the independent source of
 * truth the assertions read back from. `$transaction` snapshots the state and restores it if the
 * callback throws (rollback), and `SELECT … FOR UPDATE` holds a mutex until the transaction ends,
 * so two racing receipts serialize exactly as the row lock makes them in Postgres. Every access
 * yields to the event loop so concurrent calls genuinely interleave.
 */
class FakePrisma {
  state: State;
  /** Makes the n-th (1-based) stock movement of the next transaction throw, to test rollback. */
  failMovementAt: number | null = null;
  private lockChain: Promise<void> = Promise.resolve();

  constructor(orders: OrderState[]) {
    this.state = { orders, receipts: [], keys: [], stock: {}, movements: [], seq: 0 };
  }

  private lockOrder = async (tx: { release?: () => void; snapshot?: State }) => {
    const previous = this.lockChain;
    let release!: () => void;
    this.lockChain = new Promise<void>((resolve) => (release = resolve));
    await previous;
    tx.release = release;
    // Nothing has been written before the lock, so rollback restores from here.
    tx.snapshot = structuredClone(this.state);
  };

  $transaction = async <T>(run: (tx: this) => Promise<T>): Promise<T> => {
    const scope = Object.create(this) as this & { release?: () => void; snapshot?: State };
    try {
      return await run(scope);
    } catch (error) {
      if (scope.snapshot) this.state = scope.snapshot;
      throw error;
    } finally {
      scope.release?.();
    }
  };

  /** A method, not an arrow: `this` is the transaction scope so the lock is released with it. */
  async $queryRaw(strings: TemplateStringsArray) {
    await tick();
    const sql = strings.join('?');
    if (sql.includes('FOR UPDATE')) {
      await this.lockOrder(this as unknown as { release?: () => void; snapshot?: State });
      return [];
    }
    if (sql.includes('nextval')) return [{ n: BigInt(++this.state.seq) }];
    throw new Error(`unexpected raw query: ${sql}`);
  }

  purchaseOrder = {
    findUnique: async ({ where }: { where: { id: string } }) => {
      await tick();
      const order = this.state.orders.find((o) => o.id === where.id);
      return order ? structuredClone(order) : null;
    },
    update: async ({ where, data }: { where: { id: string }; data: { status: string } }) => {
      await tick();
      const order = this.state.orders.find((o) => o.id === where.id)!;
      order.status = data.status as PurchaseOrderStatus;
      return structuredClone(order);
    },
  };

  idempotencyKey = {
    findUnique: async ({ where }: { where: { key: string } }) => {
      await tick();
      return this.state.keys.find((k) => k.key === where.key) ?? null;
    },
    create: async ({ data }: { data: State['keys'][number] }) => {
      await tick();
      if (this.state.keys.some((k) => k.key === data.key)) throw { code: 'P2002' };
      this.state.keys.push({ ...data });
      return data;
    },
  };

  goodsReceipt = {
    create: async ({
      data,
    }: {
      data: Omit<ReceiptState, 'id' | 'receivedAt' | 'lines'> & {
        lines: { create: ReceiptState['lines'] };
      };
    }) => {
      await tick();
      const receipt: ReceiptState = {
        id: `gr-${this.state.receipts.length + 1}`,
        receivedAt: new Date('2026-01-15T10:00:00.000Z'),
        number: data.number,
        purchaseOrderId: data.purchaseOrderId,
        storeId: data.storeId,
        receivedById: data.receivedById,
        lines: data.lines.create,
      };
      this.state.receipts.push(receipt);
      return structuredClone(receipt);
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      await tick();
      const receipt = this.state.receipts.find((r) => r.id === where.id);
      return receipt ? structuredClone(receipt) : null;
    },
    findMany: async ({ where }: { where: { purchaseOrderId: string } }) => {
      await tick();
      return structuredClone(
        this.state.receipts.filter((r) => r.purchaseOrderId === where.purchaseOrderId),
      );
    },
  };

  /** The ledger primitive, recording into the same transactional state as the rest. */
  movements = {
    calls: 0,
    postMovement: async (
      input: { productId: string; storeId: string; delta: number; sourceDocument: string },
      tx: unknown,
    ) => {
      expect(tx, 'receiving must post inside its own transaction').toBeDefined();
      await tick();
      if (this.failMovementAt !== null && ++this.movements.calls === this.failMovementAt) {
        throw new Error('ledger failure');
      }
      const key = `${input.productId}@${input.storeId}`;
      const before = this.state.stock[key] ?? 0;
      this.state.stock[key] = before + input.delta;
      this.state.movements.push({
        productId: input.productId,
        storeId: input.storeId,
        delta: input.delta,
        sourceDocument: input.sourceDocument,
      });
      return {
        movementId: `mv-${this.state.movements.length}`,
        balanceBefore: before,
        balanceAfter: before + input.delta,
      };
    },
  };
}

async function setup(orders: OrderState[] = [freshOrder()]) {
  const fake = new FakePrisma(orders);
  const moduleRef = await Test.createTestingModule({
    providers: [
      GoodsReceiptService,
      { provide: PrismaService, useValue: fake },
      { provide: StockMovementService, useValue: fake.movements },
    ],
  }).compile();
  return { service: moduleRef.get(GoodsReceiptService), fake };
}

const receive = (
  service: GoodsReceiptService,
  user: User,
  lines: { productId: string; quantity: number }[],
  idempotencyKey = 'key-1',
  purchaseOrderId = 'po1',
) => service.receive({ purchaseOrderId, idempotencyKey, lines }, user);

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ORPCError);
  expect((error as ORPCError<string, unknown>).code).toBe(code);
}

describe('GoodsReceiptService.receive: confirmation (AC-01, GR-03)', () => {
  it('creates a numbered receipt, posts a ledger movement per received line, and sets Partially Received', async () => {
    const { service, fake } = await setup();

    const receipt = await receive(service, employee, [
      { productId: 'p1', quantity: 4 },
      { productId: 'p2', quantity: 0 },
    ]);

    expect(receipt.number).toBe('GR-0001');
    expect(receipt.purchaseOrderId).toBe('po1');
    expect(receipt.storeId).toBe('st1');
    expect(receipt.receivedById).toBe('e1');
    // Zero-quantity lines are not part of the receipt.
    expect(receipt.lines).toEqual([{ productId: 'p1', productName: 'สินค้า 1', quantity: 4 }]);
    expect(fake.state.movements).toEqual([
      { productId: 'p1', storeId: 'st1', delta: 4, sourceDocument: 'GR-0001' },
    ]);
    expect(fake.state.stock['p1@st1']).toBe(4);
    expect(fake.state.orders[0]?.status).toBe('PARTIALLY_RECEIVED');
  });

  it('sets Completed when every line is fully received across deliveries', async () => {
    const { service, fake } = await setup();

    await receive(service, employee, [{ productId: 'p1', quantity: 10 }], 'k1');
    expect(fake.state.orders[0]?.status).toBe('PARTIALLY_RECEIVED');
    await receive(service, employee, [{ productId: 'p2', quantity: 5 }], 'k2');

    expect(fake.state.orders[0]?.status).toBe('COMPLETED');
    expect(fake.state.stock).toEqual({ 'p1@st1': 10, 'p2@st1': 5 });
  });

  it('rolls back the receipt, stock, key and status if any movement fails', async () => {
    const { service, fake } = await setup();
    fake.failMovementAt = 2;

    await expect(
      receive(service, employee, [
        { productId: 'p1', quantity: 3 },
        { productId: 'p2', quantity: 2 },
      ]),
    ).rejects.toThrow('ledger failure');

    expect(fake.state.receipts).toEqual([]);
    expect(fake.state.keys).toEqual([]);
    expect(fake.state.movements).toEqual([]);
    expect(fake.state.stock).toEqual({});
    expect(fake.state.orders[0]?.status).toBe('APPROVED');
  });
});

describe('GoodsReceiptService.receive: idempotency (AC-02, GR-04)', () => {
  it('returns the original receipt on a replay and does not double stock', async () => {
    const { service, fake } = await setup();
    const lines = [{ productId: 'p1', quantity: 4 }];

    const first = await receive(service, employee, lines, 'same-key');
    const replay = await receive(service, employee, lines, 'same-key');

    expect(replay).toEqual(first);
    expect(fake.state.receipts).toHaveLength(1);
    expect(fake.state.stock['p1@st1']).toBe(4);
    expect(fake.state.movements).toHaveLength(1);
  });

  it('still returns the original receipt when the replay arrives after the order completed', async () => {
    const { service } = await setup();
    const all = [
      { productId: 'p1', quantity: 10 },
      { productId: 'p2', quantity: 5 },
    ];

    const first = await receive(service, employee, all, 'final');
    const replay = await receive(service, employee, all, 'final');

    expect(replay.id).toBe(first.id);
  });

  it('treats a new key as a genuinely new receipt', async () => {
    const { service, fake } = await setup();
    const lines = [{ productId: 'p1', quantity: 4 }];

    const first = await receive(service, employee, lines, 'key-a');
    const second = await receive(service, employee, lines, 'key-b');

    expect(second.id).not.toBe(first.id);
    expect(second.number).toBe('GR-0002');
    expect(fake.state.stock['p1@st1']).toBe(8);
  });

  it('collapses two simultaneous requests with the same key into one receipt', async () => {
    const { service, fake } = await setup();
    const lines = [{ productId: 'p1', quantity: 4 }];

    const [a, b] = await Promise.all([
      receive(service, employee, lines, 'double-click'),
      receive(service, employee, lines, 'double-click'),
    ]);

    expect(a.id).toBe(b.id);
    expect(fake.state.receipts).toHaveLength(1);
    expect(fake.state.stock['p1@st1']).toBe(4);
  });

  it('rejects a key that already belongs to a receipt for a different order', async () => {
    const { service } = await setup([freshOrder(), freshOrder({ id: 'po2', number: 'PO-0002' })]);
    await receive(service, employee, [{ productId: 'p1', quantity: 1 }], 'shared');

    await expectCode(
      receive(service, employee, [{ productId: 'p1', quantity: 1 }], 'shared', 'po2'),
      'CONFLICT',
    );
  });
});

describe('GoodsReceiptService.receive: quantities (AC-03, GR-02)', () => {
  it('rejects a receipt that would take the cumulative total above the ordered quantity', async () => {
    const { service, fake } = await setup();
    await receive(service, employee, [{ productId: 'p1', quantity: 6 }], 'k1');

    await expectCode(
      receive(service, employee, [{ productId: 'p1', quantity: 5 }], 'k2'),
      'BAD_REQUEST',
    );

    expect(fake.state.stock['p1@st1']).toBe(6);
    expect(fake.state.receipts).toHaveLength(1);
  });

  it('accepts exactly the outstanding quantity', async () => {
    const { service } = await setup();
    await receive(service, employee, [{ productId: 'p1', quantity: 6 }], 'k1');

    const receipt = await receive(service, employee, [{ productId: 'p1', quantity: 4 }], 'k2');

    expect(receipt.lines[0]?.quantity).toBe(4);
  });

  it('rejects a product that is not on the order', async () => {
    const { service, fake } = await setup();

    await expectCode(receive(service, employee, [{ productId: 'p9', quantity: 1 }]), 'BAD_REQUEST');

    expect(fake.state.receipts).toEqual([]);
  });
});

describe('GoodsReceiptService.receive: eligibility (AC-04, GR-01)', () => {
  it.each(['APPROVED', 'PARTIALLY_RECEIVED'] as const)(
    'allows receiving a %s order',
    async (status) => {
      const { service } = await setup([freshOrder({ status })]);

      await expect(
        receive(service, employee, [{ productId: 'p1', quantity: 1 }]),
      ).resolves.toBeDefined();
    },
  );

  it.each(['DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'CANCELLED', 'COMPLETED'] as const)(
    'rejects receiving a %s order',
    async (status) => {
      const { service, fake } = await setup([freshOrder({ status })]);

      await expectCode(
        receive(service, employee, [{ productId: 'p1', quantity: 1 }]),
        'BAD_REQUEST',
      );

      expect(fake.state.stock).toEqual({});
    },
  );

  it('rejects an employee from another store, even with a valid order and key (NFR-01)', async () => {
    const { service, fake } = await setup();

    await expectCode(
      receive(service, otherStoreEmployee, [{ productId: 'p1', quantity: 1 }]),
      'FORBIDDEN',
    );

    expect(fake.state.receipts).toEqual([]);
    expect(fake.state.stock).toEqual({});
  });

  it('does not let another store replay (and so read) a receipt through its key', async () => {
    const { service } = await setup();
    await receive(service, employee, [{ productId: 'p1', quantity: 1 }], 'k1');

    await expectCode(
      receive(service, otherStoreEmployee, [{ productId: 'p1', quantity: 1 }], 'k1'),
      'FORBIDDEN',
    );
  });

  it('rejects a non store-employee even if the route guard were bypassed', async () => {
    const { service } = await setup();

    await expectCode(receive(service, manager, [{ productId: 'p1', quantity: 1 }]), 'FORBIDDEN');
  });

  it('reports an unknown order as not found', async () => {
    const { service } = await setup();

    await expectCode(
      receive(service, employee, [{ productId: 'p1', quantity: 1 }], 'k', 'nope'),
      'NOT_FOUND',
    );
  });
});

describe('GoodsReceiptService.receive: concurrency (GR-05, INV-04)', () => {
  it('lets only one of two racing requests take the quantity that cannot be received twice', async () => {
    const { service, fake } = await setup();

    const results = await Promise.allSettled([
      receive(service, employee, [{ productId: 'p1', quantity: 8 }], 'race-a'),
      receive(service, employee, [{ productId: 'p1', quantity: 8 }], 'race-b'),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(fake.state.stock['p1@st1']).toBe(8);
    expect(fake.state.receipts).toHaveLength(1);
  });

  it('never exceeds the ordered total when many requests race', async () => {
    const { service, fake } = await setup();

    await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) =>
        receive(service, employee, [{ productId: 'p1', quantity: 3 }], `race-${i}`),
      ),
    );

    expect(fake.state.stock['p1@st1']).toBe(9);
    expect(fake.state.receipts).toHaveLength(3);
  });
});

describe('GoodsReceiptService.summary (GR-01)', () => {
  it('shows ordered, previously received and outstanding per line', async () => {
    const { service } = await setup();
    await receive(service, employee, [{ productId: 'p1', quantity: 4 }], 'k1');
    await receive(service, employee, [{ productId: 'p1', quantity: 2 }], 'k2');

    const summary = await service.summary('po1', employee);

    expect(summary.purchaseOrderNumber).toBe('PO-0001');
    expect(summary.status).toBe('PARTIALLY_RECEIVED');
    expect(summary.lines).toEqual([
      { productId: 'p1', productName: 'สินค้า 1', ordered: 10, received: 6, outstanding: 4 },
      { productId: 'p2', productName: 'สินค้า 2', ordered: 5, received: 0, outstanding: 5 },
    ]);
  });

  it("hides another store's order from a store employee", async () => {
    const { service } = await setup();

    await expectCode(service.summary('po1', otherStoreEmployee), 'FORBIDDEN');
  });

  it('is open to a manager', async () => {
    const { service } = await setup();

    await expect(service.summary('po1', manager)).resolves.toBeDefined();
  });
});

describe('GoodsReceiptService reads: confirmed receipts are viewable and terminal (GR-05)', () => {
  it('lists the receipts for an order and fetches one by id', async () => {
    const { service } = await setup();
    const first = await receive(service, employee, [{ productId: 'p1', quantity: 1 }], 'k1');
    await receive(service, employee, [{ productId: 'p2', quantity: 1 }], 'k2');

    const list = await service.listForOrder('po1', employee);
    const one = await service.get(first.id, employee);

    expect(list.map((r) => r.number)).toEqual(['GR-0001', 'GR-0002']);
    expect(one).toEqual(first);
  });

  it("hides another store's receipt from a store employee", async () => {
    const { service } = await setup();
    const first = await receive(service, employee, [{ productId: 'p1', quantity: 1 }], 'k1');

    await expectCode(service.get(first.id, otherStoreEmployee), 'FORBIDDEN');
    await expectCode(service.listForOrder('po1', otherStoreEmployee), 'FORBIDDEN');
  });

  it('exposes no way to edit or cancel a receipt', () => {
    const methods = Object.getOwnPropertyNames(GoodsReceiptService.prototype);

    expect(methods.filter((m) => /update|edit|cancel|delete|void/i.test(m))).toEqual([]);
  });
});
