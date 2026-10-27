import { isReceivable, type PurchaseOrder, type PurchaseOrderStatus } from '@erp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { PurchaseOrderForm } from '@/components/purchase-order-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCurrentUser } from '@/lib/auth';
import { orpc } from '@/lib/orpc';

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
 * The purchase-order lifecycle screen (T5). A purchasing officer drafts, edits and submits orders;
 * a manager approves, rejects or cancels. Actions are offered by role and authorship, mirroring the
 * API guards — the server is still the authority.
 */
export function PurchaseOrderList() {
  const user = useCurrentUser();
  const isOfficer = user?.role === 'PURCHASING_OFFICER';
  const orders = useQuery(orpc.purchaseOrders.list.queryOptions());
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">ใบสั่งซื้อ</h1>
        <p className="text-muted-foreground">สร้างและติดตามสถานะใบสั่งซื้อ</p>
      </div>

      {isOfficer && !editingId && <PurchaseOrderForm />}

      {orders.isPending ? (
        <p className="text-muted-foreground">กำลังโหลด…</p>
      ) : orders.isError ? (
        <p role="alert" className="text-sm text-destructive">
          ไม่สามารถโหลดรายการใบสั่งซื้อได้
        </p>
      ) : orders.data.length === 0 ? (
        <p className="text-muted-foreground">ยังไม่มีใบสั่งซื้อ</p>
      ) : (
        <div className="space-y-4">
          {editingId &&
            (() => {
              const order = orders.data.find((candidate) => candidate.id === editingId);
              return order ? (
                <PurchaseOrderForm order={order} onDone={() => setEditingId(null)} />
              ) : null;
            })()}
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
                  <OrderRow key={order.id} order={order} onEdit={() => setEditingId(order.id)} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function OrderRow({ order, onEdit }: { order: PurchaseOrder; onEdit: () => void }) {
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
  const canEdit = isOfficer && isCreator && order.status === 'DRAFT';
  const canCancel =
    (order.status === 'DRAFT' || order.status === 'PENDING_APPROVAL') && (isCreator || isManager);

  const isEmployee = user?.role === 'STORE_EMPLOYEE';
  const receivable = isReceivable(order.status);
  const canView = receivable || order.status === 'COMPLETED';
  /** A store employee receives; everyone else, and finished orders, just view (GR-01). */
  const receiveLabel = isEmployee && receivable ? 'รับสินค้า' : 'ดูการรับสินค้า';

  const pending = submit.isPending || approve.isPending || reject.isPending || cancel.isPending;
  const error = submit.error ?? approve.error ?? reject.error ?? cancel.error;

  /** Ask for a mandatory reason; abandon the action if the user dismisses or leaves it blank. */
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
        {canEdit && (
          <>
            <Button size="sm" variant="ghost" aria-label={`แก้ไข ${order.number}`} onClick={onEdit}>
              แก้ไข
            </Button>
            <Button
              size="sm"
              disabled={pending}
              aria-label={`ส่งอนุมัติ ${order.number}`}
              onClick={() => submit.mutate({ id: order.id })}
            >
              ส่งอนุมัติ
            </Button>
          </>
        )}
        {isManager && order.status === 'PENDING_APPROVAL' && (
          <>
            <Button
              size="sm"
              disabled={pending}
              aria-label={`อนุมัติ ${order.number}`}
              onClick={() => approve.mutate({ id: order.id })}
            >
              อนุมัติ
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={pending}
              aria-label={`ปฏิเสธ ${order.number}`}
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
            aria-label={`ยกเลิก ${order.number}`}
            onClick={withReason('เหตุผลในการยกเลิก', (reason) =>
              cancel.mutate({ id: order.id, reason }),
            )}
          >
            ยกเลิก
          </Button>
        )}
        {canView && (
          <Link
            className="text-sm underline underline-offset-4"
            to={`/purchase-orders/${order.id}/receive`}
            aria-label={`${receiveLabel} ${order.number}`}
          >
            {receiveLabel}
          </Link>
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
