import type { CreatePurchaseOrder, PurchaseOrder } from '@erp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { orpc } from '@/lib/orpc';

const baht = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A select styled to match the shadcn `Input` so the two line up in a form row. */
const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Read a number input, treating a cleared field as 0 rather than NaN. */
function numberValue(event: React.ChangeEvent<HTMLInputElement>): number {
  return Number.isNaN(event.target.valueAsNumber) ? 0 : event.target.valueAsNumber;
}

type LineForm = { productId: string; quantity: number; purchasePrice: number };
const EMPTY_LINE: LineForm = { productId: '', quantity: 1, purchasePrice: 0 };

/** The header and lines a draft starts from when editing an existing order. */
function fieldsOf(order: PurchaseOrder) {
  return {
    supplierId: order.supplierId,
    storeId: order.destinationStoreId,
    date: order.expectedReceiptDate,
    lines: order.lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      purchasePrice: line.purchasePrice,
    })),
  };
}

/** Build the create payload, dropping lines with no product chosen (PO-01 needs >=1). */
function toCreate(
  supplierId: string,
  destinationStoreId: string,
  expectedReceiptDate: string,
  lines: LineForm[],
): CreatePurchaseOrder {
  return {
    supplierId,
    destinationStoreId,
    expectedReceiptDate,
    lines: lines.filter((line) => line.productId),
  };
}

/**
 * The shared draft form for a purchase order (PO-01), used both to create a new order and to edit
 * an existing draft. `order` switches it to edit mode; omitting it is create mode. Supplier, store
 * and product option lists come from their own queries.
 */
export function PurchaseOrderForm({
  order,
  onDone,
}: {
  order?: PurchaseOrder;
  onDone?: () => void;
}) {
  const queryClient = useQueryClient();
  const suppliers = useQuery(orpc.suppliers.list.queryOptions());
  const stores = useQuery(orpc.stores.list.queryOptions());
  const products = useQuery(orpc.products.list.queryOptions());

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: orpc.purchaseOrders.list.queryKey() });
  const create = useMutation(orpc.purchaseOrders.create.mutationOptions({ onSuccess: invalidate }));
  const update = useMutation(orpc.purchaseOrders.update.mutationOptions({ onSuccess: invalidate }));
  const save = order ? update : create;

  const initial = order ? fieldsOf(order) : null;
  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? '');
  const [storeId, setStoreId] = useState(initial?.storeId ?? '');
  const [date, setDate] = useState(initial?.date ?? '');
  const [lines, setLines] = useState<LineForm[]>(initial?.lines ?? [{ ...EMPTY_LINE }]);

  const setLine = (index: number, patch: Partial<LineForm>) =>
    setLines(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  const addLine = () => setLines([...lines, { ...EMPTY_LINE }]);
  const removeLine = (index: number) =>
    setLines(lines.length > 1 ? lines.filter((_, i) => i !== index) : lines);

  const reset = () => {
    setSupplierId('');
    setStoreId('');
    setDate('');
    setLines([{ ...EMPTY_LINE }]);
  };

  const activeProducts = (products.data ?? []).filter((product) => product.active);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const payload = toCreate(supplierId, storeId, date, lines);
    if (order) {
      update.mutate({ id: order.id, ...payload }, { onSuccess: () => onDone?.() });
    } else {
      create.mutate(payload, { onSuccess: reset });
    }
  };

  return (
    <form className="space-y-4 rounded-lg border p-4" onSubmit={submit}>
      <h2 className="text-lg font-semibold">
        {order ? `แก้ไขใบสั่งซื้อ ${order.number}` : 'สร้างใบสั่งซื้อใหม่'}
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="supplier">ผู้จัดจำหน่าย</Label>
          <select
            id="supplier"
            required
            value={supplierId}
            onChange={(event) => setSupplierId(event.target.value)}
            className={SELECT_CLASS}
          >
            <option value="">เลือกผู้จัดจำหน่าย</option>
            {suppliers.data?.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.code} — {supplier.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="store">คลังปลายทาง</Label>
          <select
            id="store"
            required
            value={storeId}
            onChange={(event) => setStoreId(event.target.value)}
            className={SELECT_CLASS}
          >
            <option value="">เลือกคลัง</option>
            {stores.data?.map((store) => (
              <option key={store.id} value={store.id}>
                {store.code} — {store.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="date">วันที่คาดว่าจะได้รับ</Label>
          <Input
            id="date"
            type="date"
            required
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">รายการสินค้า</legend>
        {lines.map((line, index) => (
          <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
            <select
              aria-label={`สินค้า แถวที่ ${index + 1}`}
              required
              value={line.productId}
              onChange={(event) => setLine(index, { productId: event.target.value })}
              className={SELECT_CLASS}
            >
              <option value="">เลือกสินค้า</option>
              {activeProducts.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.sku} — {product.name}
                </option>
              ))}
            </select>
            <Input
              aria-label={`จำนวน แถวที่ ${index + 1}`}
              type="number"
              min="1"
              step="1"
              required
              value={line.quantity}
              onChange={(event) => setLine(index, { quantity: numberValue(event) })}
            />
            <Input
              aria-label={`ราคาซื้อ แถวที่ ${index + 1}`}
              type="number"
              min="0"
              step="0.01"
              required
              value={line.purchasePrice}
              onChange={(event) => setLine(index, { purchasePrice: numberValue(event) })}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`ลบ แถวที่ ${index + 1}`}
              onClick={() => removeLine(index)}
            >
              ลบ
            </Button>
          </div>
        ))}
        <Button type="button" variant="ghost" size="sm" onClick={addLine}>
          เพิ่มรายการ
        </Button>
      </fieldset>

      <div className="flex items-center gap-4">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'กำลังบันทึก…' : order ? 'บันทึกการแก้ไข' : 'บันทึกแบบร่าง'}
        </Button>
        {order && onDone && (
          <Button type="button" variant="ghost" onClick={onDone}>
            ยกเลิกการแก้ไข
          </Button>
        )}
        {save.error && (
          <span role="alert" className="text-sm text-destructive">
            {errorMessage(save.error, 'ไม่สามารถบันทึกใบสั่งซื้อได้')}
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          ราคารวมโดยประมาณ:{' '}
          {baht.format(lines.reduce((sum, line) => sum + line.quantity * line.purchasePrice, 0))}{' '}
          บาท
        </span>
      </div>
    </form>
  );
}
