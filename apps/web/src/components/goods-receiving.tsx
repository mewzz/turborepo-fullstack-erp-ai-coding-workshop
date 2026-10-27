import type { ReceivingLine } from '@erp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCurrentUser } from '@/lib/auth';
import { orpc } from '@/lib/orpc';
import { cn } from '@/lib/utils';

const TH_CLASS = 'px-4 py-2 font-medium';

const RECEIVABLE = ['APPROVED', 'PARTIALLY_RECEIVED'];

const MESSAGES = {
  notWhole: 'จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป',
  tooMany: 'เกินจำนวนที่ค้างรับ',
  none: 'กรอกจำนวนที่รับอย่างน้อย 1 รายการ',
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Check the typed quantities the way the API will (GR-02) so obvious mistakes never leave the
 * browser. Returns the parsed lines, or the first problem as a Thai message. The server remains
 * the authority and re-checks everything, including totals across other deliveries.
 */
function validate(
  lines: ReceivingLine[],
  typed: Record<string, string>,
): { lines: { productId: string; quantity: number }[] } | { error: string } {
  const parsed: { productId: string; quantity: number }[] = [];
  for (const line of lines) {
    const raw = (typed[line.productId] ?? '').trim();
    const quantity = raw === '' ? 0 : Number(raw);
    if (!Number.isInteger(quantity) || quantity < 0) {
      return { error: `${line.productName}: ${MESSAGES.notWhole}` };
    }
    if (quantity > line.outstanding) {
      return { error: `${line.productName}: ${MESSAGES.tooMany}` };
    }
    parsed.push({ productId: line.productId, quantity });
  }
  if (!parsed.some((line) => line.quantity > 0)) return { error: MESSAGES.none };
  return { lines: parsed };
}

/**
 * The goods-receiving screen (T6). Shows ordered, previously received and outstanding per line
 * (GR-01); a store employee can confirm a partial receipt, and everyone can see the confirmed
 * receipts, which are terminal (GR-05). The idempotency key is made once per attempt and reused on
 * a retry or double click, then replaced as soon as the quantities change or a receipt succeeds
 * (GR-04), so only a deliberate new receipt gets a new key.
 */
export function GoodsReceiving({ purchaseOrderId }: { purchaseOrderId: string }) {
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const input = { purchaseOrderId };
  const summary = useQuery(orpc.goodsReceipts.summary.queryOptions({ input }));
  const receipts = useQuery(orpc.goodsReceipts.listForOrder.queryOptions({ input }));

  const [typed, setTyped] = useState<Record<string, string>>({});
  const [clientError, setClientError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<string | null>(null);
  // One key per attempt: reused on retry or double click, dropped when the quantities change.
  const [idempotencyKey, setIdempotencyKey] = useState<string | undefined>(undefined);

  const receive = useMutation(
    orpc.goodsReceipts.receive.mutationOptions({
      onSuccess: (receipt) => {
        setIdempotencyKey(undefined);
        setTyped({});
        setConfirmed(receipt.number);
        void queryClient.invalidateQueries({
          queryKey: orpc.goodsReceipts.summary.queryKey({ input }),
        });
        void queryClient.invalidateQueries({
          queryKey: orpc.goodsReceipts.listForOrder.queryKey({ input }),
        });
        void queryClient.invalidateQueries({ queryKey: orpc.purchaseOrders.list.queryKey() });
        void queryClient.invalidateQueries({ queryKey: orpc.inventory.key() });
      },
    }),
  );

  if (summary.isPending) return <p className="text-muted-foreground">กำลังโหลด…</p>;
  if (summary.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        ไม่สามารถโหลดข้อมูลการรับสินค้าได้
      </p>
    );
  }

  const order = summary.data;
  const isEmployee = user?.role === 'STORE_EMPLOYEE';
  const canReceive =
    isEmployee &&
    RECEIVABLE.includes(order.status) &&
    order.lines.some((line) => line.outstanding > 0);

  const change = (productId: string, value: string) => {
    // New quantities are a different request: never replay the old key for them.
    setIdempotencyKey(undefined);
    setClientError(null);
    setTyped((previous) => ({ ...previous, [productId]: value }));
  };

  const submit = () => {
    const result = validate(order.lines, typed);
    if ('error' in result) {
      setClientError(result.error);
      return;
    }
    setClientError(null);
    setConfirmed(null);
    const key = idempotencyKey ?? crypto.randomUUID();
    setIdempotencyKey(key);
    receive.mutate({
      purchaseOrderId,
      idempotencyKey: key,
      lines: result.lines,
    });
  };

  const problem =
    clientError ??
    (receive.isError ? errorMessage(receive.error, 'ไม่สามารถบันทึกการรับสินค้าได้') : null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">รับสินค้า {order.purchaseOrderNumber}</h1>
        <p className="text-muted-foreground">ตรวจนับและบันทึกสินค้าที่ได้รับตามใบสั่งซื้อ</p>
      </div>

      {order.status === 'COMPLETED' && <p className="text-sm">รับสินค้าครบแล้ว</p>}
      {!canReceive && order.status !== 'COMPLETED' && !RECEIVABLE.includes(order.status) && (
        <p className="text-sm text-muted-foreground">ใบสั่งซื้อนี้ยังรับสินค้าไม่ได้</p>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table aria-label="รายการสินค้าที่สั่งซื้อ" className="w-full text-left text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th scope="col" className={TH_CLASS}>
                สินค้า
              </th>
              <th scope="col" className={cn(TH_CLASS, 'text-right')}>
                สั่งซื้อ
              </th>
              <th scope="col" className={cn(TH_CLASS, 'text-right')}>
                รับแล้ว
              </th>
              <th scope="col" className={cn(TH_CLASS, 'text-right')}>
                ค้างรับ
              </th>
              {canReceive && (
                <th scope="col" className={cn(TH_CLASS, 'text-right')}>
                  รับครั้งนี้
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line) => (
              <tr key={line.productId} className="border-b last:border-0">
                <td className="px-4 py-2">{line.productName}</td>
                <td className="px-4 py-2 text-right">{line.ordered}</td>
                <td className="px-4 py-2 text-right">{line.received}</td>
                <td className="px-4 py-2 text-right">{line.outstanding}</td>
                {canReceive && (
                  <td className="px-4 py-2 text-right">
                    <Label htmlFor={`qty-${line.productId}`} className="sr-only">
                      รับครั้งนี้: {line.productName}
                    </Label>
                    <Input
                      id={`qty-${line.productId}`}
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      className="ml-auto w-24 text-right"
                      value={typed[line.productId] ?? ''}
                      placeholder="0"
                      onChange={(event) => change(line.productId, event.target.value)}
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canReceive && (
        <div className="space-y-2">
          <Button type="button" disabled={receive.isPending} onClick={submit}>
            ยืนยันการรับสินค้า
          </Button>
          {problem && (
            <p role="alert" className="text-sm text-destructive">
              {problem}
            </p>
          )}
        </div>
      )}

      {confirmed && (
        <p role="status" className="text-sm">
          บันทึกการรับสินค้าแล้ว เลขที่ {confirmed}
        </p>
      )}

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">ใบรับสินค้า</h2>
        {receipts.isPending ? (
          <p className="text-muted-foreground">กำลังโหลด…</p>
        ) : receipts.isError ? (
          <p role="alert" className="text-sm text-destructive">
            ไม่สามารถโหลดรายการใบรับสินค้าได้
          </p>
        ) : receipts.data.length === 0 ? (
          <p className="text-muted-foreground">ยังไม่มีใบรับสินค้า</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table aria-label="ใบรับสินค้าที่ยืนยันแล้ว" className="w-full text-left text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th scope="col" className={TH_CLASS}>
                    เลขที่
                  </th>
                  <th scope="col" className={TH_CLASS}>
                    วันที่รับ
                  </th>
                  <th scope="col" className={TH_CLASS}>
                    รายการ
                  </th>
                </tr>
              </thead>
              <tbody>
                {receipts.data.map((receipt) => (
                  <tr key={receipt.id} className="border-b align-top last:border-0">
                    <td className="px-4 py-2 font-mono">{receipt.number}</td>
                    <td className="px-4 py-2">
                      {new Date(receipt.receivedAt).toLocaleString('th-TH')}
                    </td>
                    <td className="px-4 py-2">
                      <ul>
                        {receipt.lines.map((line) => (
                          <li key={line.productId}>
                            {line.productName} × {line.quantity}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
