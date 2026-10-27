import type { CreateSupplier } from '@erp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCurrentUser } from '@/lib/auth';
import { orpc } from '@/lib/orpc';

type SupplierForm = {
  code: string;
  name: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
};

const EMPTY_FORM: SupplierForm = {
  code: '',
  name: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
};

/** Trim the form and drop empty optional contact fields before sending. */
function toInput(form: SupplierForm): CreateSupplier {
  return {
    code: form.code,
    name: form.name,
    ...(form.contactName ? { contactName: form.contactName } : {}),
    ...(form.contactEmail ? { contactEmail: form.contactEmail } : {}),
    ...(form.contactPhone ? { contactPhone: form.contactPhone } : {}),
  };
}

/** Master-data screen for suppliers. Mutations are admin-only; the API enforces this too. */
export function SupplierList() {
  const user = useCurrentUser();
  const isAdmin = user?.role === 'ADMINISTRATOR';
  const queryClient = useQueryClient();
  const suppliers = useQuery(orpc.suppliers.list.queryOptions());

  const create = useMutation(
    orpc.suppliers.create.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.suppliers.list.queryKey() }),
    }),
  );

  const [form, setForm] = useState<SupplierForm>(EMPTY_FORM);
  const field = (key: keyof SupplierForm) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: event.target.value });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">ผู้จัดจำหน่าย</h1>
        <p className="text-muted-foreground">จัดการข้อมูลผู้จัดจำหน่าย</p>
      </div>

      {isAdmin && (
        <form
          className="grid grid-cols-1 gap-4 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate(toInput(form), { onSuccess: () => setForm(EMPTY_FORM) });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="code">รหัสผู้จัดจำหน่าย</Label>
            <Input id="code" required value={form.code} onChange={field('code')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">ชื่อผู้จัดจำหน่าย</Label>
            <Input id="name" required value={form.name} onChange={field('name')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contactName">ผู้ติดต่อ</Label>
            <Input id="contactName" value={form.contactName} onChange={field('contactName')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contactEmail">อีเมล</Label>
            <Input
              id="contactEmail"
              type="email"
              value={form.contactEmail}
              onChange={field('contactEmail')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contactPhone">โทรศัพท์</Label>
            <Input id="contactPhone" value={form.contactPhone} onChange={field('contactPhone')} />
          </div>
          <div className="flex items-end lg:col-span-3">
            {create.error && (
              <p role="alert" className="mr-4 text-sm text-destructive">
                ไม่สามารถบันทึกผู้จัดจำหน่ายได้ รหัสอาจซ้ำกับที่มีอยู่แล้ว
              </p>
            )}
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'กำลังบันทึก…' : 'เพิ่มผู้จัดจำหน่าย'}
            </Button>
          </div>
        </form>
      )}

      {suppliers.isPending ? (
        <p className="text-muted-foreground">กำลังโหลด…</p>
      ) : suppliers.isError ? (
        <p role="alert" className="text-sm text-destructive">
          ไม่สามารถโหลดรายการผู้จัดจำหน่ายได้
        </p>
      ) : suppliers.data.length === 0 ? (
        <p className="text-muted-foreground">ยังไม่มีผู้จัดจำหน่าย</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  รหัส
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  ชื่อ
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  ผู้ติดต่อ
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  อีเมล
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  โทรศัพท์
                </th>
              </tr>
            </thead>
            <tbody>
              {suppliers.data.map((supplier) => (
                <tr key={supplier.id} className="border-b last:border-0">
                  <td className="px-4 py-2 font-mono">{supplier.code}</td>
                  <td className="px-4 py-2">{supplier.name}</td>
                  <td className="px-4 py-2">{supplier.contactName ?? '—'}</td>
                  <td className="px-4 py-2">{supplier.contactEmail ?? '—'}</td>
                  <td className="px-4 py-2">{supplier.contactPhone ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
