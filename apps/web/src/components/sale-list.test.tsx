import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/lib/query-client';
import { mockApi } from '@/test/mock-api';
import { SaleList } from './sale-list';

const employee = {
  id: 'u1',
  email: 'staff_b01@erp.local',
  name: 'Staff B01',
  role: 'STORE_EMPLOYEE',
  storeId: 'st1',
};
const manager = { id: 'm1', email: 'manager01@erp.local', name: 'Manager One', role: 'MANAGER' };

const store = { id: 'st1', code: 'B01', name: 'Central' };
const product = {
  id: 'p1',
  sku: 'SKU001',
  name: 'สินค้า 001',
  category: 'ทั่วไป',
  unit: 'ชิ้น',
  sellingPrice: 45,
  active: true,
};

function draftSale(over: Record<string, unknown> = {}) {
  return {
    id: 'sale1',
    number: null,
    storeId: 'st1',
    status: 'DRAFT',
    createdById: 'u1',
    confirmedAt: null,
    lines: [{ id: 'l1', productId: 'p1', productName: 'สินค้า 001', unitPrice: 45, quantity: 3 }],
    ...over,
  };
}

const reference = { 'GET /stores': [store], 'GET /products': [product] };

function renderList() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <SaleList />
    </QueryClientProvider>,
  );
}

describe('SaleList', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows a loading state, then the sales with their status', async () => {
    mockApi({ 'GET /auth/me': { user: employee }, 'GET /sales': [draftSale()], ...reference });

    renderList();

    expect(screen.getByText('กำลังโหลด…')).toBeInTheDocument();
    expect(await screen.findByText('แบบร่าง')).toBeInTheDocument();
    expect(screen.getByText('สินค้า 001 × 3')).toBeInTheDocument();
  });

  it('shows an empty state when there are no sales', async () => {
    mockApi({ 'GET /auth/me': { user: employee }, 'GET /sales': [], ...reference });

    renderList();

    expect(await screen.findByText('ยังไม่มีรายการขาย')).toBeInTheDocument();
  });

  it('shows an error state when the list fails', async () => {
    mockApi({
      'GET /auth/me': { user: employee },
      'GET /sales': new Response('boom', { status: 500 }),
      ...reference,
    });

    renderList();

    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(
      'ไม่สามารถโหลดรายการขายได้',
    );
  });

  it('offers a store employee the draft form with labeled fields', async () => {
    mockApi({ 'GET /auth/me': { user: employee }, 'GET /sales': [], ...reference });

    renderList();
    await screen.findByText('ยังไม่มีรายการขาย');

    expect(screen.getByRole('button', { name: 'บันทึกแบบร่าง' })).toBeInTheDocument();
    expect(screen.getByLabelText('สินค้า แถวที่ 1')).toBeInTheDocument();
    expect(screen.getByLabelText('จำนวน แถวที่ 1')).toBeInTheDocument();
  });

  it('hides the draft form from a non store-employee', async () => {
    mockApi({ 'GET /auth/me': { user: manager }, 'GET /sales': [draftSale()], ...reference });

    renderList();
    await screen.findByText('แบบร่าง');

    expect(screen.queryByRole('button', { name: 'บันทึกแบบร่าง' })).not.toBeInTheDocument();
  });

  it('confirms a draft, sending an idempotency key, and shows the confirmed number', async () => {
    let sales = [draftSale()];
    let confirmBody: Record<string, unknown> | undefined;
    const fetch = vi.fn(async (request: Request) => {
      const key = `${request.method} ${new URL(request.url).pathname.replace(/^\/api/, '')}`;
      if (key === 'GET /auth/me') return Response.json({ user: employee });
      if (key === 'GET /sales') return Response.json(sales);
      if (key === 'GET /stores') return Response.json([store]);
      if (key === 'GET /products') return Response.json([product]);
      if (key === 'POST /sales/sale1/confirm') {
        confirmBody = (await request.json()) as Record<string, unknown>;
        sales = [draftSale({ status: 'CONFIRMED', number: 'SALE-0001' })];
        return Response.json(sales[0]);
      }
      return Response.json({ message: `No mock for ${key}` }, { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);

    renderList();
    fireEvent.click(await screen.findByRole('button', { name: 'ยืนยันการขาย' }));

    expect(await screen.findByText('SALE-0001')).toBeInTheDocument();
    expect(confirmBody?.idempotencyKey).toEqual(expect.any(String));
    expect((confirmBody?.idempotencyKey as string).length).toBeGreaterThan(0);
  });

  it('does not offer confirm on an already-confirmed sale (terminal, SAL-04)', async () => {
    mockApi({
      'GET /auth/me': { user: employee },
      'GET /sales': [draftSale({ status: 'CONFIRMED', number: 'SALE-0001' })],
      ...reference,
    });

    renderList();
    await screen.findByText('SALE-0001');

    expect(screen.queryByRole('button', { name: 'ยืนยันการขาย' })).not.toBeInTheDocument();
  });
});
