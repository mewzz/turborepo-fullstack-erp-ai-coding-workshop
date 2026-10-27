import type { CreatePurchaseOrder, PurchaseOrder, PurchaseOrderStatus } from '@erp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCurrentUser } from '@/lib/auth';
import { orpc } from '@/lib/orpc';

const baht = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Thai labels for each lifecycle status (PO-02/03/04). */
const STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'แบบร่าง',
  PENDING_APPROVAL: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  PARTIALLY_RECEIVED: 'รับบางส่วน',
  COMPLETED: 'รับครบแล้ว',
  REJECTED: 'ถูกปฏิเสธ',
  CANCELLED: 'ยกเลิกแล้ว',
};

const STATUS_VARIANT: Record<PurchaseOrderStatus, 'default' | 'secondary' | 'destructive'> = {
  DRAFT: 'secondary',
  PENDING_APPROVAL: 'default',
  APPROVED: 'default',
  PARTIALLY_RECEIVED: 'default',
  COMPLETED: 'default',
  REJECTED: 'destructive',
  CANCELLED: 'destructive',
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * The purchase-order lifecycle screen (T5). A purchasing officer drafts and submits orders; a
 * manager approves, rejects or cancels. Actions are offered by role and authorship, mirroring the
 * API guards — the server is still the authority.
 */
export function PurchaseOrderList() {
  const user = useCurrentUser();
  const isOfficer = user?.role === 'PURCHASING_OFFICER';
  const orders = useQuery(orpc.purchaseOrders.list.queryOptions());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">ใบสั่งซื้อ</h1>
        <p className="text-muted-foreground">สร้างและติดตามสถานะใบสั่งซื้อ</p>
      </div>

      {isOfficer && <CreateOrderForm />}

      {orders.isPending ? (
        <p className="text-muted-foreground">กำลังโหลด…</p>
      ) : orders.isError ? (
        <p role="alert" className="text-sm text-destructive">
          ไม่สามารถโหลดรายการใบสั่งซื้อได้
        </p>
      ) : orders.data.length === 0 ? (
        <p className="text-muted-foreground">ยังไม่มีใบสั่งซื้อ</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  เลขที่
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  วันที่คาดว่าจะได้รับ
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  จำนวนรายการ
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  สถานะ
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  การจัดการ
                </th>
              </tr>
            </thead>
            <tbody>
              {orders.data.map((order) => (
                <OrderRow key={order.id} order={order} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OrderRow({ order }: { order: PurchaseOrder }) {
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: orpc.purchaseOrders.list.queryKey() });

  const submit = useMutation(orpc.purchaseOrders.submit.mutationOptions({ onSuccess: invalidate }));
  const approve = useMutation(
    orpc.purchaseOrders.approve.mutationOptions({ onSuccess: invalidate }),
  );
  const reject = useMutation(orpc.purchaseOrders.reject.mutationOptions({ onSuccess: invalidate }));
  const cancel = useMutation(orpc.purchaseOrders.cancel.mutationOptions({ onSuccess: invalidate }));

  const isCreator = user?.id === order.createdById;
  const isOfficer = user?.role === 'PURCHASING_OFFICER';
  const isManager = user?.role === 'MANAGER';
  const canCancel =
    (order.status === 'DRAFT' || order.status === 'PENDING_APPROVAL') && (isCreator || isManager);

  const pending = submit.isPending || approve.isPending || reject.isPending || cancel.isPending;
  const error = submit.error ?? approve.error ?? reject.error ?? cancel.error;

  /** Ask for a mandatory reason; cancel the action if the user dismisses or leaves it blank. */
  const withReason = (label: string, run: (reason: string) => void) => () => {
    const reason = window.prompt(label)?.trim();
    if (reason) run(reason);
  };

  return (
    <tr className="border-b align-top last:border-0">
      <td className="px-4 py-2 font-mono">{order.number}</td>
      <td className="px-4 py-2">{order.expectedReceiptDate}</td>
      <td className="px-4 py-2 text-right">{order.lines.length}</td>
      <td className="px-4 py-2">
        <Badge variant={STATUS_VARIANT[order.status]}>{STATUS_LABEL[order.status]}</Badge>
        {order.reason && (
          <p className="mt-1 text-xs text-muted-foreground">เหตุผล: {order.reason}</p>
        )}
      </td>
      <td className="space-x-2 px-4 py-2 whitespace-nowrap">
        {isOfficer && isCreator && order.status === 'DRAFT' && (
          <Button size="sm" disabled={pending} onClick={() => submit.mutate({ id: order.id })}>
            ส่งอนุมัติ
          </Button>
        )}
        {isManager && order.status === 'PENDING_APPROVAL' && (
          <>
            <Button size="sm" disabled={pending} onClick={() => approve.mutate({ id: order.id })}>
              อนุมัติ
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={pending}
              onClick={withReason('เหตุผลในการปฏิเสธ', (reason) =>
                reject.mutate({ id: order.id, reason }),
              )}
            >
              ปฏิเสธ
            </Button>
          </>
        )}
        {canCancel && (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={withReason('เหตุผลในการยกเลิก', (reason) =>
              cancel.mutate({ id: order.id, reason }),
            )}
          >
            ยกเลิก
          </Button>
        )}
        {error && (
          <span role="alert" className="text-sm text-destructive">
            {errorMessage(error, 'ไม่สามารถดำเนินการได้')}
          </span>
        )}
      </td>
    </tr>
  );
}

type LineForm = { productId: string; quantity: number; purchasePrice: number };
const EMPTY_LINE: LineForm = { productId: '', quantity: 1, purchasePrice: 0 };

/** Build the create payload, dropping lines with no product chosen. */
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
    lines: lines
      .filter((line) => line.productId)
      .map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        purchasePrice: line.purchasePrice,
      })),
  };
}

function CreateOrderForm() {
  const queryClient = useQueryClient();
  const suppliers = useQuery(orpc.suppliers.list.queryOptions());
  const stores = useQuery(orpc.stores.list.queryOptions());
  const products = useQuery(orpc.products.list.queryOptions());
  const create = useMutation(
    orpc.purchaseOrders.create.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: orpc.purchaseOrders.list.queryKey() }),
    }),
  );

  const [supplierId, setSupplierId] = useState('');
  const [storeId, setStoreId] = useState('');
  const [date, setDate] = useState('');
  const [lines, setLines] = useState<LineForm[]>([{ ...EMPTY_LINE }]);

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

  return (
    <form
      className="space-y-4 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate(toCreate(supplierId, storeId, date, lines), { onSuccess: reset });
      }}
    >
      <h2 className="text-lg font-semibold">สร้างใบสั่งซื้อใหม่</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="supplier">ผู้จัดจำหน่าย</Label>
          <select
            id="supplier"
            required
            value={supplierId}
            onChange={(event) => setSupplierId(event.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
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
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
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
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
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
              onChange={(event) =>
                setLine(index, {
                  quantity: Number.isNaN(event.target.valueAsNumber)
                    ? 0
                    : event.target.valueAsNumber,
                })
              }
            />
            <Input
              aria-label={`ราคาซื้อ แถวที่ ${index + 1}`}
              type="number"
              min="0"
              step="0.01"
              required
              value={line.purchasePrice}
              onChange={(event) =>
                setLine(index, {
                  purchasePrice: Number.isNaN(event.target.valueAsNumber)
                    ? 0
                    : event.target.valueAsNumber,
                })
              }
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
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'กำลังบันทึก…' : 'บันทึกแบบร่าง'}
        </Button>
        {create.error && (
          <span role="alert" className="text-sm text-destructive">
            {errorMessage(create.error, 'ไม่สามารถบันทึกใบสั่งซื้อได้')}
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
