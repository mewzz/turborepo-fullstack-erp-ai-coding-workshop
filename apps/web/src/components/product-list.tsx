import type { CreateProduct } from '@erp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCurrentUser } from '@/lib/auth';
import { orpc } from '@/lib/orpc';

const EMPTY_FORM: CreateProduct = {
  sku: '',
  name: '',
  category: '',
  unit: '',
  sellingPrice: 0,
};

const baht = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Master-data screen for products. Mutations are admin-only; the API enforces this too. */
export function ProductList() {
  const user = useCurrentUser();
  const isAdmin = user?.role === 'ADMINISTRATOR';
  const queryClient = useQueryClient();
  const products = useQuery(orpc.products.list.queryOptions());

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: orpc.products.list.queryKey() });

  const create = useMutation(orpc.products.create.mutationOptions({ onSuccess: invalidate }));
  const deactivate = useMutation(
    orpc.products.deactivate.mutationOptions({ onSuccess: invalidate }),
  );
  const reactivate = useMutation(
    orpc.products.reactivate.mutationOptions({ onSuccess: invalidate }),
  );

  const [form, setForm] = useState<CreateProduct>(EMPTY_FORM);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">สินค้า</h1>
        <p className="text-muted-foreground">จัดการรายการสินค้าในระบบ</p>
      </div>

      {isAdmin && (
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
                setForm({ ...form, sellingPrice: event.target.valueAsNumber || 0 })
              }
            />
          </div>
          <div className="flex items-end lg:col-span-5">
            {create.error && (
              <p role="alert" className="mr-4 text-sm text-destructive">
                ไม่สามารถบันทึกสินค้าได้ รหัส SKU อาจซ้ำกับที่มีอยู่แล้ว
              </p>
            )}
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'กำลังบันทึก…' : 'เพิ่มสินค้า'}
            </Button>
          </div>
        </form>
      )}

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
              {products.data.map((product) => (
                <tr key={product.id} className="border-b last:border-0">
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
                    <td className="px-4 py-2">
                      {product.active ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={deactivate.isPending}
                          onClick={() => deactivate.mutate({ id: product.id })}
                        >
                          ปิดการใช้งาน
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={reactivate.isPending}
                          onClick={() => reactivate.mutate({ id: product.id })}
                        >
                          เปิดการใช้งาน
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
