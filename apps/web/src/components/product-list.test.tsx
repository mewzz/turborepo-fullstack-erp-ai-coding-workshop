import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/lib/query-client';
import { mockApi } from '@/test/mock-api';
import { ProductList } from './product-list';

const admin = { id: '1', email: 'admin@erp.local', name: 'Admin', role: 'ADMINISTRATOR' };
const staff = { id: '2', email: 'staff@erp.local', name: 'Staff', role: 'STORE_EMPLOYEE' };

const product = {
  id: 'p1',
  sku: 'SKU001',
  name: 'สินค้า 001',
  category: 'ทั่วไป',
  unit: 'ชิ้น',
  sellingPrice: 45,
  active: true,
};

function renderList() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <ProductList />
    </QueryClientProvider>,
  );
}

describe('ProductList', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows a loading state, then the products from the API', async () => {
    mockApi({ 'GET /auth/me': { user: admin }, 'GET /products': [product] });

    renderList();

    expect(screen.getByText('กำลังโหลด…')).toBeInTheDocument();
    expect(await screen.findByText('SKU001')).toBeInTheDocument();
    expect(screen.getByText('สินค้า 001')).toBeInTheDocument();
  });

  it('shows an empty state when there are no products', async () => {
    mockApi({ 'GET /auth/me': { user: admin }, 'GET /products': [] });

    renderList();

    expect(await screen.findByText('ยังไม่มีสินค้า')).toBeInTheDocument();
  });

  it('shows an error state when the API fails', async () => {
    mockApi({
      'GET /auth/me': { user: admin },
      'GET /products': new Response('boom', { status: 500 }),
    });

    renderList();

    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(
      'ไม่สามารถโหลดรายการสินค้าได้',
    );
  });

  it('marks a deactivated product as inactive', async () => {
    mockApi({
      'GET /auth/me': { user: admin },
      'GET /products': [{ ...product, active: false }],
    });

    renderList();

    const row = (await screen.findByText('SKU001')).closest('tr')!;
    expect(within(row).getByText('ปิดการใช้งาน')).toBeInTheDocument();
  });

  it('lets an administrator create a product with labeled fields', async () => {
    // Stateful stub: the product list is empty until the POST, then the refetch returns it.
    let products: unknown[] = [];
    const fetch = vi.fn(async (request: Request) => {
      const key = `${request.method} ${new URL(request.url).pathname.replace(/^\/api/, '')}`;
      if (key === 'GET /auth/me') return Response.json({ user: admin });
      if (key === 'GET /products') return Response.json(products);
      if (key === 'POST /products') {
        products = [product];
        return Response.json(product);
      }
      return Response.json({ message: `No mock for ${key}` }, { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);

    renderList();
    await screen.findByText('ยังไม่มีสินค้า');

    fireEvent.change(screen.getByLabelText('รหัสสินค้า (SKU)'), { target: { value: 'SKU001' } });
    fireEvent.change(screen.getByLabelText('ชื่อสินค้า'), { target: { value: 'สินค้า 001' } });
    fireEvent.change(screen.getByLabelText('หมวดหมู่'), { target: { value: 'ทั่วไป' } });
    fireEvent.change(screen.getByLabelText('หน่วย'), { target: { value: 'ชิ้น' } });
    fireEvent.change(screen.getByLabelText('ราคาขาย (บาท)'), { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มสินค้า' }));

    expect(await screen.findByText('SKU001')).toBeInTheDocument();
    const create = fetch.mock.calls.find(([request]) => request.method === 'POST')![0];
    await expect(create.json()).resolves.toEqual({
      sku: 'SKU001',
      name: 'สินค้า 001',
      category: 'ทั่วไป',
      unit: 'ชิ้น',
      sellingPrice: 45,
    });
  });

  it('hides the create form from non-administrators', async () => {
    mockApi({ 'GET /auth/me': { user: staff }, 'GET /products': [product] });

    renderList();
    await screen.findByText('SKU001');

    expect(screen.queryByLabelText('รหัสสินค้า (SKU)')).not.toBeInTheDocument();
  });
});
