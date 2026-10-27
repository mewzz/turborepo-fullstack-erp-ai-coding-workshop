import type { CreateSupplier, Supplier, UpdateSupplier } from '@erp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCurrentUser } from '@/lib/auth';
import { orpc } from '@/lib/orpc';

type SupplierFields = {
  name: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
};

function fieldsOf(supplier: Supplier): SupplierFields {
  return {
    name: supplier.name,
    contactName: supplier.contactName ?? '',
    contactEmail: supplier.contactEmail ?? '',
    contactPhone: supplier.contactPhone ?? '',
  };
}

/** Drop empty optional contact fields so an unset field stays unset rather than becoming "". */
function toUpdate(fields: SupplierFields): UpdateSupplier {
  return {
    name: fields.name,
    contactName: fields.contactName || null,
    contactEmail: fields.contactEmail || null,
    contactPhone: fields.contactPhone || null,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Master-data screen for suppliers. Mutations are admin-only; the API enforces this too. */
export function SupplierList() {
  const user = useCurrentUser();
  const isAdmin = user?.role === 'ADMINISTRATOR';
  const suppliers = useQuery(orpc.suppliers.list.queryOptions());
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">ผู้จัดจำหน่าย</h1>
        <p className="text-muted-foreground">จัดการข้อมูลผู้จัดจำหน่าย</p>
      </div>

      {isAdmin && <CreateSupplierForm />}

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
                {isAdmin && (
                  <th scope="col" className="px-4 py-2 font-medium">
                    การจัดการ
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {suppliers.data.map((supplier) =>
                editingId === supplier.id ? (
                  <EditSupplierRow
                    key={supplier.id}
                    supplier={supplier}
                    onDone={() => setEditingId(null)}
                  />
                ) : (
                  <SupplierRow
                    key={supplier.id}
                    supplier={supplier}
                    isAdmin={isAdmin}
                    onEdit={() => setEditingId(supplier.id)}
                  />
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SupplierRow({
  supplier,
  isAdmin,
  onEdit,
}: {
  supplier: Supplier;
  isAdmin: boolean;
  onEdit: () => void;
}) {
  return (
    <tr className="border-b last:border-0">
      <td className="px-4 py-2 font-mono">{supplier.code}</td>
      <td className="px-4 py-2">{supplier.name}</td>
      <td className="px-4 py-2">{supplier.contactName ?? '—'}</td>
      <td className="px-4 py-2">{supplier.contactEmail ?? '—'}</td>
      <td className="px-4 py-2">{supplier.contactPhone ?? '—'}</td>
      {isAdmin && (
        <td className="px-4 py-2">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            แก้ไข
          </Button>
        </td>
      )}
    </tr>
  );
}

function EditSupplierRow({ supplier, onDone }: { supplier: Supplier; onDone: () => void }) {
  const queryClient = useQueryClient();
  const update = useMutation(
    orpc.suppliers.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.suppliers.list.queryKey() });
        onDone();
      },
    }),
  );
  const [fields, setFields] = useState<SupplierFields>(fieldsOf(supplier));
  const field = (key: keyof SupplierFields) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setFields({ ...fields, [key]: event.target.value });

  return (
    <tr className="border-b bg-muted/30 last:border-0">
      <td className="px-4 py-2 font-mono">{supplier.code}</td>
      <td className="px-4 py-2">
        <Input aria-label="ชื่อผู้จัดจำหน่าย" value={fields.name} onChange={field('name')} />
      </td>
      <td className="px-4 py-2">
        <Input aria-label="ผู้ติดต่อ" value={fields.contactName} onChange={field('contactName')} />
      </td>
      <td className="px-4 py-2">
        <Input
          aria-label="อีเมล"
          type="email"
          value={fields.contactEmail}
          onChange={field('contactEmail')}
        />
      </td>
      <td className="px-4 py-2">
        <Input aria-label="โทรศัพท์" value={fields.contactPhone} onChange={field('contactPhone')} />
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={update.isPending}
            onClick={() => update.mutate({ id: supplier.id, ...toUpdate(fields) })}
          >
            บันทึก
          </Button>
          <Button variant="ghost" size="sm" onClick={onDone}>
            ยกเลิก
          </Button>
          {update.error && (
            <span role="alert" className="text-sm text-destructive">
              {errorMessage(update.error, 'ไม่สามารถบันทึกผู้จัดจำหน่ายได้')}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

type CreateForm = SupplierFields & { code: string };
const EMPTY_FORM: CreateForm = {
  code: '',
  name: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
};

/** Trim the form and drop empty optional contact fields before sending. */
function toCreate(form: CreateForm): CreateSupplier {
  return {
    code: form.code,
    name: form.name,
    ...(form.contactName ? { contactName: form.contactName } : {}),
    ...(form.contactEmail ? { contactEmail: form.contactEmail } : {}),
    ...(form.contactPhone ? { contactPhone: form.contactPhone } : {}),
  };
}

function CreateSupplierForm() {
  const queryClient = useQueryClient();
  const create = useMutation(
    orpc.suppliers.create.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.suppliers.list.queryKey() }),
    }),
  );
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const field = (key: keyof CreateForm) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: event.target.value });

  return (
    <form
      className="grid grid-cols-1 gap-4 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-3"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate(toCreate(form), { onSuccess: () => setForm(EMPTY_FORM) });
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
            {errorMessage(create.error, 'ไม่สามารถบันทึกผู้จัดจำหน่ายได้')}
          </p>
        )}
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'กำลังบันทึก…' : 'เพิ่มผู้จัดจำหน่าย'}
        </Button>
      </div>
    </form>
  );
}
