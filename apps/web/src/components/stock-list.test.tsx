import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/lib/query-client';
import { mockApi } from '@/test/mock-api';
import { StockList } from './stock-list';

const manager = { id: 'u3', email: 'manager01@erp.local', name: 'Manager One', role: 'MANAGER' };
const staff = {
  id: 'u2',
  email: 'staff@erp.local',
  name: 'Staff',
  role: 'STORE_EMPLOYEE',
  storeId: 's1',
};

const stockRow = {
  productId: 'p1',
  sku: 'SKU001',
  name: 'สินค้า 001',
  unit: 'ชิ้น',
  storeId: 's1',
  storeCode: 'B01',
  quantity: 10,
  reorderThreshold: 3,
  lowStock: false,
};

function renderList() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <StockList />
    </QueryClientProvider>,
  );
}

/** Open the adjustment form for the SKU001 row as a manager. */
async function openAdjustment() {
  fireEvent.click(await screen.findByRole('button', { name: 'ปรับสต็อก SKU001 B01' }));
}

function fillAdjustment(direction: string, quantity: string, reason: string) {
  fireEvent.change(screen.getByLabelText('ประเภทการปรับ'), { target: { value: direction } });
  fireEvent.change(screen.getByLabelText('จำนวน'), { target: { value: quantity } });
  fireEvent.change(screen.getByLabelText('เหตุผล'), { target: { value: reason } });
  fireEvent.click(screen.getByRole('button', { name: 'บันทึกการปรับสต็อก' }));
}

describe('StockList', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows a loading state, then the stock rows from the API', async () => {
    mockApi({ 'GET /auth/me': { user: manager }, 'GET /inventory/stock': [stockRow] });

    renderList();

    expect(screen.getByText('กำลังโหลด…')).toBeInTheDocument();
    const row = (await screen.findByText('SKU001')).closest('tr')!;
    expect(within(row).getByText('10')).toBeInTheDocument();
  });

  it('shows an empty state when there is no stock', async () => {
    mockApi({ 'GET /auth/me': { user: manager }, 'GET /inventory/stock': [] });

    renderList();

    expect(await screen.findByText('ยังไม่มีข้อมูลสต็อก')).toBeInTheDocument();
  });

  it('shows an error state when the API fails', async () => {
    mockApi({
      'GET /auth/me': { user: manager },
      'GET /inventory/stock': new Response('boom', { status: 500 }),
    });

    renderList();

    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(
      'ไม่สามารถโหลดข้อมูลสต็อกได้',
    );
  });

  it('offers the adjustment action to a manager only', async () => {
    mockApi({ 'GET /auth/me': { user: staff }, 'GET /inventory/stock': [stockRow] });

    renderList();
    await screen.findByText('SKU001');

    expect(screen.queryByRole('button', { name: /ปรับสต็อก/ })).not.toBeInTheDocument();
  });

  it('lets a manager decrease stock with a reason and shows the new balance', async () => {
    let quantity = 10;
    let body: Record<string, unknown> | undefined;
    const fetch = vi.fn(async (request: Request) => {
      const key = `${request.method} ${new URL(request.url).pathname.replace(/^\/api/, '')}`;
      if (key === 'GET /auth/me') return Response.json({ user: manager });
      if (key === 'GET /inventory/stock') return Response.json([{ ...stockRow, quantity }]);
      if (key === 'POST /inventory/adjustments') {
        body = (await request.json()) as Record<string, unknown>;
        quantity = 6;
        return Response.json({
          movementId: 'm1',
          productId: 'p1',
          storeId: 's1',
          balanceBefore: 10,
          balanceAfter: 6,
        });
      }
      return Response.json({ message: `No mock for ${key}` }, { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);

    renderList();
    await openAdjustment();
    fillAdjustment('DECREASE', '4', 'นับสต็อกใหม่');

    expect(await screen.findByRole('status')).toHaveTextContent('บันทึกการปรับสต็อกแล้ว');
    const stockTable = screen.getByRole('table', { name: 'สต็อกคงเหลือ' });
    const row = within(stockTable).getByText('SKU001').closest('tr')!;
    expect(await within(row).findByText('6')).toBeInTheDocument();
    const movements = await screen.findByRole('table', { name: 'รายการเคลื่อนไหวล่าสุด' });
    const movement = within(movements).getByText('m1').closest('tr')!;
    expect(within(movement).getByText('SKU001')).toBeInTheDocument();
    expect(within(movement).getByText('-4')).toBeInTheDocument();
    expect(within(movement).getByText('10')).toBeInTheDocument();
    expect(within(movement).getByText('6')).toBeInTheDocument();
    expect(body).toEqual({
      productId: 'p1',
      storeId: 's1',
      direction: 'DECREASE',
      quantity: 4,
      reason: 'นับสต็อกใหม่',
    });
  });

  it('shows the API rejection when the reduction exceeds the balance', async () => {
    mockApi({
      'GET /auth/me': { user: manager },
      'GET /inventory/stock': [stockRow],
      'POST /inventory/adjustments': new Response(
        JSON.stringify({
          defined: false,
          code: 'CONFLICT',
          status: 409,
          message: 'สต็อกคงเหลือติดลบไม่ได้',
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      ),
    });

    renderList();
    await openAdjustment();
    fillAdjustment('DECREASE', '999', 'ทดสอบ');

    expect(await screen.findByRole('alert')).toHaveTextContent('สต็อกคงเหลือติดลบไม่ได้');
  });

  it('requires a reason before it will submit', async () => {
    const fetch = mockApi({
      'GET /auth/me': { user: manager },
      'GET /inventory/stock': [stockRow],
    });

    renderList();
    await openAdjustment();

    expect(screen.getByLabelText('เหตุผล')).toBeRequired();
    fireEvent.change(screen.getByLabelText('จำนวน'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกการปรับสต็อก' }));

    const posted = fetch.mock.calls.some(([request]) => request.method === 'POST');
    expect(posted).toBe(false);
  });
});
