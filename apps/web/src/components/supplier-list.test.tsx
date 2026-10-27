import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/lib/query-client';
import { mockApi } from '@/test/mock-api';
import { SupplierList } from './supplier-list';

const admin = { id: '1', email: 'admin@erp.local', name: 'Admin', role: 'ADMINISTRATOR' };

const supplier = {
  id: 's1',
  code: 'SUP01',
  name: 'บริษัท ตัวอย่าง จำกัด',
  contactName: 'ฝ่ายขาย',
  contactEmail: 'sales@sup01.local',
  contactPhone: '021112222',
};

function renderList() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <SupplierList />
    </QueryClientProvider>,
  );
}

describe('SupplierList', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows a loading state, then the suppliers from the API', async () => {
    mockApi({ 'GET /auth/me': { user: admin }, 'GET /suppliers': [supplier] });

    renderList();

    expect(screen.getByText('กำลังโหลด…')).toBeInTheDocument();
    expect(await screen.findByText('SUP01')).toBeInTheDocument();
    expect(screen.getByText('บริษัท ตัวอย่าง จำกัด')).toBeInTheDocument();
  });

  it('shows an empty state when there are no suppliers', async () => {
    mockApi({ 'GET /auth/me': { user: admin }, 'GET /suppliers': [] });

    renderList();

    expect(await screen.findByText('ยังไม่มีผู้จัดจำหน่าย')).toBeInTheDocument();
  });

  it('shows an error state when the API fails', async () => {
    mockApi({
      'GET /auth/me': { user: admin },
      'GET /suppliers': new Response('boom', { status: 500 }),
    });

    renderList();

    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(
      'ไม่สามารถโหลดรายการผู้จัดจำหน่ายได้',
    );
  });

  it('lets an administrator create a supplier with labeled fields', async () => {
    let suppliers: unknown[] = [];
    const fetch = vi.fn(async (request: Request) => {
      const key = `${request.method} ${new URL(request.url).pathname.replace(/^\/api/, '')}`;
      if (key === 'GET /auth/me') return Response.json({ user: admin });
      if (key === 'GET /suppliers') return Response.json(suppliers);
      if (key === 'POST /suppliers') {
        suppliers = [supplier];
        return Response.json(supplier);
      }
      return Response.json({ message: `No mock for ${key}` }, { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);

    renderList();
    await screen.findByText('ยังไม่มีผู้จัดจำหน่าย');

    fireEvent.change(screen.getByLabelText('รหัสผู้จัดจำหน่าย'), { target: { value: 'SUP01' } });
    fireEvent.change(screen.getByLabelText('ชื่อผู้จัดจำหน่าย'), {
      target: { value: 'บริษัท ตัวอย่าง จำกัด' },
    });
    fireEvent.change(screen.getByLabelText('ผู้ติดต่อ'), { target: { value: 'ฝ่ายขาย' } });
    fireEvent.change(screen.getByLabelText('อีเมล'), { target: { value: 'sales@sup01.local' } });
    fireEvent.change(screen.getByLabelText('โทรศัพท์'), { target: { value: '021112222' } });
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มผู้จัดจำหน่าย' }));

    expect(await screen.findByText('SUP01')).toBeInTheDocument();
    const create = fetch.mock.calls.find(([request]) => request.method === 'POST')![0];
    await expect(create.json()).resolves.toEqual({
      code: 'SUP01',
      name: 'บริษัท ตัวอย่าง จำกัด',
      contactName: 'ฝ่ายขาย',
      contactEmail: 'sales@sup01.local',
      contactPhone: '021112222',
    });
  });
});
