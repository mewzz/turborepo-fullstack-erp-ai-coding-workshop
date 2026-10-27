import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/lib/query-client';
import { mockApi } from '@/test/mock-api';
import { GoodsReceiving } from './goods-receiving';

const employee = {
  id: 'e1',
  email: 'staff01@erp.local',
  name: 'Staff One',
  role: 'STORE_EMPLOYEE',
  storeId: 'st1',
};
const manager = { id: 'm1', email: 'manager01@erp.local', name: 'Manager One', role: 'MANAGER' };

function summary(over: Record<string, unknown> = {}) {
  return {
    purchaseOrderId: 'po1',
    purchaseOrderNumber: 'PO-0001',
    status: 'PARTIALLY_RECEIVED',
    destinationStoreId: 'st1',
    lines: [
      { productId: 'p1', productName: 'สินค้า 001', ordered: 10, received: 4, outstanding: 6 },
      { productId: 'p2', productName: 'สินค้า 002', ordered: 5, received: 0, outstanding: 5 },
    ],
    ...over,
  };
}

const receipt = {
  id: 'gr1',
  number: 'GR-0001',
  purchaseOrderId: 'po1',
  storeId: 'st1',
  receivedById: 'e1',
  receivedAt: '2026-01-15T10:00:00.000Z',
  lines: [{ productId: 'p1', productName: 'สินค้า 001', quantity: 4 }],
};

const created = { ...receipt, id: 'gr2', number: 'GR-0002' };

function routes(over: Record<string, unknown> = {}) {
  return {
    'GET /auth/me': { user: employee },
    'GET /purchase-orders/po1/receiving': summary(),
    'GET /purchase-orders/po1/receipts': [receipt],
    'POST /purchase-orders/po1/receipts': created,
    ...over,
  };
}

function renderReceiving() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <GoodsReceiving purchaseOrderId="po1" />
    </QueryClientProvider>,
  );
}

/** The JSON bodies of every confirm request sent so far. */
async function sentBodies(fetch: ReturnType<typeof mockApi>) {
  const posts = fetch.mock.calls
    .map(([request]) => request as Request)
    .filter((request) => request.method === 'POST');
  return Promise.all(posts.map((request) => request.clone().json()));
}

const quantityField = (name: string) => screen.getByLabelText(`รับครั้งนี้: ${name}`);
const confirm = () => fireEvent.click(screen.getByRole('button', { name: 'ยืนยันการรับสินค้า' }));

describe('GoodsReceiving', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows ordered, previously received and outstanding for every line (GR-01)', async () => {
    mockApi(routes());

    renderReceiving();

    expect(await screen.findByRole('heading', { name: /PO-0001/ })).toBeInTheDocument();
    const row = screen.getByText('สินค้า 001').closest('tr')!;
    const cells = within(row)
      .getAllByRole('cell')
      .map((cell) => cell.textContent);
    expect(cells.slice(0, 4)).toEqual(['สินค้า 001', '10', '4', '6']);
    const other = screen.getByText('สินค้า 002').closest('tr')!;
    expect(
      within(other)
        .getAllByRole('cell')
        .slice(0, 4)
        .map((cell) => cell.textContent),
    ).toEqual(['สินค้า 002', '5', '0', '5']);
  });

  it('confirms a receipt with the typed quantities and shows the new receipt number', async () => {
    const fetch = mockApi(routes());
    renderReceiving();
    await screen.findByText('สินค้า 001');

    fireEvent.change(quantityField('สินค้า 001'), { target: { value: '3' } });
    confirm();

    expect(await screen.findByRole('status')).toHaveTextContent('GR-0002');
    const [body] = await sentBodies(fetch);
    expect(body.lines).toEqual([
      { productId: 'p1', quantity: 3 },
      { productId: 'p2', quantity: 0 },
    ]);
    expect(typeof body.idempotencyKey).toBe('string');
    expect(body.idempotencyKey.length).toBeGreaterThan(8);
  });

  it('reuses the idempotency key on a retry, and uses a new one once the quantities change (GR-04)', async () => {
    const fetch = mockApi(
      routes({ 'POST /purchase-orders/po1/receipts': new Response('boom', { status: 500 }) }),
    );
    renderReceiving();
    await screen.findByText('สินค้า 001');
    fireEvent.change(quantityField('สินค้า 001'), { target: { value: '3' } });

    confirm();
    await screen.findByRole('alert', {}, { timeout: 5000 });
    confirm();
    await waitFor(async () => expect(await sentBodies(fetch)).toHaveLength(2), { timeout: 5000 });
    fireEvent.change(quantityField('สินค้า 001'), { target: { value: '2' } });
    confirm();
    await waitFor(async () => expect(await sentBodies(fetch)).toHaveLength(3), { timeout: 5000 });

    const [first, retry, edited] = await sentBodies(fetch);
    expect(retry.idempotencyKey).toBe(first.idempotencyKey);
    expect(edited.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it('starts a fresh key for the next receipt after a successful one', async () => {
    const fetch = mockApi(routes());
    renderReceiving();
    await screen.findByText('สินค้า 001');

    fireEvent.change(quantityField('สินค้า 001'), { target: { value: '1' } });
    confirm();
    await screen.findByRole('status');
    fireEvent.change(quantityField('สินค้า 001'), { target: { value: '1' } });
    confirm();
    await waitFor(async () => expect(await sentBodies(fetch)).toHaveLength(2));

    const [first, second] = await sentBodies(fetch);
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it('rejects an all-zero receipt before sending anything (GR-02)', async () => {
    const fetch = mockApi(routes());
    renderReceiving();
    await screen.findByText('สินค้า 001');

    confirm();

    expect(await screen.findByRole('alert')).toHaveTextContent('กรอกจำนวนที่รับอย่างน้อย 1 รายการ');
    expect(await sentBodies(fetch)).toEqual([]);
  });

  it.each([
    ['more than outstanding', '7', 'เกินจำนวนที่ค้างรับ'],
    ['negative', '-1', 'จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป'],
    ['fractional', '1.5', 'จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป'],
  ])('rejects a quantity that is %s before sending anything', async (_label, value, message) => {
    const fetch = mockApi(routes());
    renderReceiving();
    await screen.findByText('สินค้า 001');

    fireEvent.change(quantityField('สินค้า 001'), { target: { value } });
    confirm();

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(await sentBodies(fetch)).toEqual([]);
  });

  it("shows the server's reason when the receipt is refused", async () => {
    mockApi(
      routes({
        'POST /purchase-orders/po1/receipts': Response.json(
          {
            defined: false,
            code: 'BAD_REQUEST',
            status: 400,
            message: 'จำนวนที่รับรวมแล้วเกินจำนวนที่สั่งซื้อ',
          },
          { status: 400 },
        ),
      }),
    );
    renderReceiving();
    await screen.findByText('สินค้า 001');

    fireEvent.change(quantityField('สินค้า 001'), { target: { value: '1' } });
    confirm();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'จำนวนที่รับรวมแล้วเกินจำนวนที่สั่งซื้อ',
    );
  });

  it('lists the confirmed receipts', async () => {
    mockApi(routes());

    renderReceiving();

    const table = await screen.findByRole('table', { name: 'ใบรับสินค้าที่ยืนยันแล้ว' });
    expect(within(table).getByText('GR-0001')).toBeInTheDocument();
    expect(within(table).getByText(/สินค้า 001/)).toBeInTheDocument();
    // Terminal: nothing to edit or cancel (GR-05).
    expect(screen.queryByRole('button', { name: /แก้ไข|ยกเลิก/ })).not.toBeInTheDocument();
  });

  it('is read-only for someone who is not a store employee', async () => {
    mockApi(routes({ 'GET /auth/me': { user: manager } }));

    renderReceiving();

    await screen.findByText('สินค้า 001');
    expect(screen.queryByRole('button', { name: 'ยืนยันการรับสินค้า' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('รับครั้งนี้: สินค้า 001')).not.toBeInTheDocument();
    expect(screen.getByText('GR-0001')).toBeInTheDocument();
  });

  it('is read-only once the order is completed', async () => {
    mockApi(
      routes({
        'GET /purchase-orders/po1/receiving': summary({
          status: 'COMPLETED',
          lines: [
            {
              productId: 'p1',
              productName: 'สินค้า 001',
              ordered: 10,
              received: 10,
              outstanding: 0,
            },
          ],
        }),
      }),
    );

    renderReceiving();

    expect(await screen.findByText('รับสินค้าครบแล้ว')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ยืนยันการรับสินค้า' })).not.toBeInTheDocument();
  });

  it('shows an error when the summary cannot be loaded', async () => {
    mockApi(
      routes({ 'GET /purchase-orders/po1/receiving': new Response('boom', { status: 500 }) }),
    );

    renderReceiving();

    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(
      'ไม่สามารถโหลดข้อมูลการรับสินค้าได้',
    );
  });
});
