import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/lib/query-client';
import { mockApi } from '@/test/mock-api';
import { PurchaseOrderList } from './purchase-order-list';

const officer = {
  id: 'u1',
  email: 'buyer01@erp.local',
  name: 'Buyer One',
  role: 'PURCHASING_OFFICER',
};
const manager = { id: 'm1', email: 'manager01@erp.local', name: 'Manager One', role: 'MANAGER' };

const supplier = { id: 's1', code: 'SUP01', name: 'ซัพพลายเออร์ 1' };
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

function draftOrder(over: Record<string, unknown> = {}) {
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
      { id: 'l1', productId: 'p1', productName: 'สินค้า 001', purchasePrice: 25.5, quantity: 10 },
    ],
    ...over,
  };
}

const reference = {
  'GET /suppliers': [supplier],
  'GET /stores': [store],
  'GET /products': [product],
};

function renderList() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <PurchaseOrderList />
    </QueryClientProvider>,
  );
}

describe('PurchaseOrderList', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows a loading state, then the orders with their status', async () => {
    mockApi({
      'GET /auth/me': { user: officer },
      'GET /purchase-orders': [draftOrder()],
      ...reference,
    });

    renderList();

    expect(screen.getByText('กำลังโหลด…')).toBeInTheDocument();
    expect(await screen.findByText('PO-0001')).toBeInTheDocument();
    const row = screen.getByText('PO-0001').closest('tr')!;
    expect(within(row).getByText('แบบร่าง')).toBeInTheDocument();
  });

  it('shows an empty state when there are no orders', async () => {
    mockApi({ 'GET /auth/me': { user: officer }, 'GET /purchase-orders': [], ...reference });

    renderList();

    expect(await screen.findByText('ยังไม่มีใบสั่งซื้อ')).toBeInTheDocument();
  });

  it('shows an error state when the list fails', async () => {
    mockApi({
      'GET /auth/me': { user: officer },
      'GET /purchase-orders': new Response('boom', { status: 500 }),
      ...reference,
    });

    renderList();

    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(
      'ไม่สามารถโหลดรายการใบสั่งซื้อได้',
    );
  });

  it('offers a purchasing officer the draft form with labeled fields', async () => {
    mockApi({ 'GET /auth/me': { user: officer }, 'GET /purchase-orders': [], ...reference });

    renderList();
    await screen.findByText('ยังไม่มีใบสั่งซื้อ');

    expect(screen.getByLabelText('ผู้จัดจำหน่าย')).toBeInTheDocument();
    expect(screen.getByLabelText('คลังปลายทาง')).toBeInTheDocument();
    expect(screen.getByLabelText('วันที่คาดว่าจะได้รับ')).toBeInTheDocument();
  });

  it('hides the draft form from a manager', async () => {
    mockApi({
      'GET /auth/me': { user: manager },
      'GET /purchase-orders': [draftOrder()],
      ...reference,
    });

    renderList();
    await screen.findByText('PO-0001');

    expect(screen.queryByLabelText('ผู้จัดจำหน่าย')).not.toBeInTheDocument();
  });

  it('lets the creating officer submit a draft', async () => {
    let orders = [draftOrder()];
    let submitted = false;
    const fetch = vi.fn(async (request: Request) => {
      const key = `${request.method} ${new URL(request.url).pathname.replace(/^\/api/, '')}`;
      if (key === 'GET /auth/me') return Response.json({ user: officer });
      if (key === 'GET /purchase-orders') return Response.json(orders);
      if (key === 'GET /suppliers') return Response.json([supplier]);
      if (key === 'GET /stores') return Response.json([store]);
      if (key === 'GET /products') return Response.json([product]);
      if (key === 'POST /purchase-orders/po1/submit') {
        submitted = true;
        orders = [draftOrder({ status: 'PENDING_APPROVAL' })];
        return Response.json(orders[0]);
      }
      return Response.json({ message: `No mock for ${key}` }, { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);

    renderList();
    const row = (await screen.findByText('PO-0001')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'ส่งอนุมัติ' }));

    expect(await screen.findByText('รออนุมัติ')).toBeInTheDocument();
    expect(submitted).toBe(true);
  });

  it('lets a manager approve a pending order', async () => {
    let orders = [draftOrder({ status: 'PENDING_APPROVAL' })];
    const fetch = vi.fn(async (request: Request) => {
      const key = `${request.method} ${new URL(request.url).pathname.replace(/^\/api/, '')}`;
      if (key === 'GET /auth/me') return Response.json({ user: manager });
      if (key === 'GET /purchase-orders') return Response.json(orders);
      if (key === 'GET /suppliers') return Response.json([supplier]);
      if (key === 'GET /stores') return Response.json([store]);
      if (key === 'GET /products') return Response.json([product]);
      if (key === 'POST /purchase-orders/po1/approve') {
        orders = [draftOrder({ status: 'APPROVED' })];
        return Response.json(orders[0]);
      }
      return Response.json({ message: `No mock for ${key}` }, { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);

    renderList();
    const row = (await screen.findByText('PO-0001')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'อนุมัติ' }));

    expect(await screen.findByText('อนุมัติแล้ว')).toBeInTheDocument();
  });

  it('does not offer approve to a purchasing officer', async () => {
    mockApi({
      'GET /auth/me': { user: officer },
      'GET /purchase-orders': [draftOrder({ status: 'PENDING_APPROVAL' })],
      ...reference,
    });

    renderList();
    await screen.findByText('PO-0001');

    expect(screen.queryByRole('button', { name: 'อนุมัติ' })).not.toBeInTheDocument();
  });

  it('sends the reason a manager gives when rejecting', async () => {
    let orders = [draftOrder({ status: 'PENDING_APPROVAL' })];
    let rejectBody: Record<string, unknown> | undefined;
    const fetch = vi.fn(async (request: Request) => {
      const key = `${request.method} ${new URL(request.url).pathname.replace(/^\/api/, '')}`;
      if (key === 'GET /auth/me') return Response.json({ user: manager });
      if (key === 'GET /purchase-orders') return Response.json(orders);
      if (key === 'GET /suppliers') return Response.json([supplier]);
      if (key === 'GET /stores') return Response.json([store]);
      if (key === 'GET /products') return Response.json([product]);
      if (key === 'POST /purchase-orders/po1/reject') {
        rejectBody = (await request.json()) as Record<string, unknown>;
        orders = [draftOrder({ status: 'REJECTED', reason: rejectBody.reason as string })];
        return Response.json(orders[0]);
      }
      return Response.json({ message: `No mock for ${key}` }, { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(window, 'prompt').mockReturnValue('ราคาสูงไป');

    renderList();
    const row = (await screen.findByText('PO-0001')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'ปฏิเสธ' }));

    expect(await screen.findByText('ถูกปฏิเสธ')).toBeInTheDocument();
    expect(rejectBody).toMatchObject({ reason: 'ราคาสูงไป' });
  });
});
