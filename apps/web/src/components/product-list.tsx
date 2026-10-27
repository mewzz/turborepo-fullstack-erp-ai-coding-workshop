import type { CreateProduct, Product, UpdateProduct } from '@erp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCurrentUser } from '@/lib/auth';
import { orpc } from '@/lib/orpc';

const baht = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The editable fields shared by create and edit. SKU is immutable, so edit omits it. */
type ProductFields = { name: string; category: string; unit: string; sellingPrice: number };

function fieldsOf(product: Product): ProductFields {
  return {
    name: product.name,
    category: product.category,
    unit: product.unit,
    sellingPrice: product.sellingPrice,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Master-data screen for products. Mutations are admin-only; the API enforces this too. */
export function ProductList() {
  const user = useCurrentUser();
  const isAdmin = user?.role === 'ADMINISTRATOR';
  const products = useQuery(orpc.products.list.queryOptions());
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">สินค้า</h1>
        <p className="text-muted-foreground">จัดการรายการสินค้าในระบบ</p>
      </div>

      {isAdmin && <CreateProductForm />}

      {products.isPending ? (
        <p className="text-muted-foreground">กำลังโหลด…</p>
      ) : products.isError ? (
        <p role="alert" className="text-sm text-destructive">
          ไม่สามารถโหลดรายการสินค้าได้
        </p>
      ) : products.data.length === 0 ? (
        <p className="text-muted-foreground">ยังไม่มีสินค้า</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  SKU
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  ชื่อสินค้า
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  หมวดหมู่
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  หน่วย
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  ราคาขาย
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  สถานะ
                </th>
                {isAdmin && (
                  <th scope="col" className="px-4 py-2 font-medium">
                    การจัดการ
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {products.data.map((product) =>
                editingId === product.id ? (
                  <EditProductRow
                    key={product.id}
                    product={product}
                    onDone={() => setEditingId(null)}
                  />
                ) : (
                  <ProductRow
                    key={product.id}
                    product={product}
                    isAdmin={isAdmin}
                    onEdit={() => setEditingId(product.id)}
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

function ProductRow({
  product,
  isAdmin,
  onEdit,
}: {
  product: Product;
  isAdmin: boolean;
  onEdit: () => void;
}) {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: orpc.products.list.queryKey() });
  const deactivate = useMutation(
    orpc.products.deactivate.mutationOptions({ onSuccess: invalidate }),
  );
  const reactivate = useMutation(
    orpc.products.reactivate.mutationOptions({ onSuccess: invalidate }),
  );
  const toggle = product.active ? deactivate : reactivate;

  return (
    <tr className="border-b last:border-0">
      <td className="px-4 py-2 font-mono">{product.sku}</td>
      <td className="px-4 py-2">{product.name}</td>
      <td className="px-4 py-2">{product.category}</td>
      <td className="px-4 py-2">{product.unit}</td>
      <td className="px-4 py-2 text-right">{baht.format(product.sellingPrice)}</td>
      <td className="px-4 py-2">
        <Badge variant={product.active ? 'default' : 'secondary'}>
          {product.active ? 'ใช้งาน' : 'ปิดการใช้งาน'}
        </Badge>
      </td>
      {isAdmin && (
        <td className="space-x-2 px-4 py-2 whitespace-nowrap">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            แก้ไข
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={toggle.isPending}
            onClick={() => toggle.mutate({ id: product.id })}
          >
            {product.active ? 'ปิดการใช้งาน' : 'เปิดการใช้งาน'}
          </Button>
        </td>
      )}
    </tr>
  );
}

function EditProductRow({ product, onDone }: { product: Product; onDone: () => void }) {
  const queryClient = useQueryClient();
  const update = useMutation(
    orpc.products.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.products.list.queryKey() });
        onDone();
      },
    }),
  );
  const [fields, setFields] = useState<ProductFields>(fieldsOf(product));

  return (
    <tr className="border-b bg-muted/30 last:border-0">
      <td className="px-4 py-2 font-mono">{product.sku}</td>
      <td className="px-4 py-2">
        <Input
          aria-label="ชื่อสินค้า"
          value={fields.name}
          onChange={(event) => setFields({ ...fields, name: event.target.value })}
        />
      </td>
      <td className="px-4 py-2">
        <Input
          aria-label="หมวดหมู่"
          value={fields.category}
          onChange={(event) => setFields({ ...fields, category: event.target.value })}
        />
      </td>
      <td className="px-4 py-2">
        <Input
          aria-label="หน่วย"
          value={fields.unit}
          onChange={(event) => setFields({ ...fields, unit: event.target.value })}
        />
      </td>
      <td className="px-4 py-2">
        <Input
          aria-label="ราคาขาย"
          type="number"
          min="0"
          step="0.01"
          value={fields.sellingPrice}
          onChange={(event) => setFields({ ...fields, sellingPrice: event.target.valueAsNumber })}
        />
      </td>
      <td className="px-4 py-2" colSpan={2}>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={update.isPending}
            onClick={() =>
              update.mutate({ id: product.id, ...fields } satisfies UpdateProduct & { id: string })
            }
          >
            บันทึก
          </Button>
          <Button variant="ghost" size="sm" onClick={onDone}>
            ยกเลิก
          </Button>
          {update.error && (
            <span role="alert" className="text-sm text-destructive">
              {errorMessage(update.error, 'ไม่สามารถบันทึกสินค้าได้')}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

const EMPTY_FORM: CreateProduct = { sku: '', name: '', category: '', unit: '', sellingPrice: 0 };

function CreateProductForm() {
  const queryClient = useQueryClient();
  const create = useMutation(
    orpc.products.create.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.products.list.queryKey() }),
    }),
  );
  const [form, setForm] = useState<CreateProduct>(EMPTY_FORM);

  return (
    <form
      className="grid grid-cols-1 gap-4 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-5"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate(form, { onSuccess: () => setForm(EMPTY_FORM) });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="sku">รหัสสินค้า (SKU)</Label>
        <Input
          id="sku"
          required
          value={form.sku}
          onChange={(event) => setForm({ ...form, sku: event.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="name">ชื่อสินค้า</Label>
        <Input
          id="name"
          required
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="category">หมวดหมู่</Label>
        <Input
          id="category"
          required
          value={form.category}
          onChange={(event) => setForm({ ...form, category: event.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="unit">หน่วย</Label>
        <Input
          id="unit"
          required
          value={form.unit}
          onChange={(event) => setForm({ ...form, unit: event.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="sellingPrice">ราคาขาย (บาท)</Label>
        <Input
          id="sellingPrice"
          type="number"
          min="0"
          step="0.01"
          required
          value={form.sellingPrice}
          onChange={(event) =>
            setForm({
              ...form,
              sellingPrice: Number.isNaN(event.target.valueAsNumber)
                ? 0
                : event.target.valueAsNumber,
            })
          }
        />
      </div>
      <div className="flex items-end lg:col-span-5">
        {create.error && (
          <p role="alert" className="mr-4 text-sm text-destructive">
            {errorMessage(create.error, 'ไม่สามารถบันทึกสินค้าได้')}
          </p>
        )}
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'กำลังบันทึก…' : 'เพิ่มสินค้า'}
        </Button>
      </div>
    </form>
  );
}
