import type { AdjustmentDirection, AdjustStockResult, StockSearchResult } from '@erp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCurrentUser } from '@/lib/auth';
import { orpc } from '@/lib/orpc';

/** A select styled to match the shadcn `Input` so the two line up in a form row. */
const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * The stock screen (INV-01) with the manager correction (INV-05). Everyone signed in sees stock;
 * only a manager is offered the adjustment, mirroring the API's `@Roles('MANAGER')` — the server
 * stays the authority.
 */
export function StockList() {
  const user = useCurrentUser();
  const isManager = user?.role === 'MANAGER';
  const stock = useQuery(orpc.inventory.search.queryOptions({ input: {} }));
  const [adjusting, setAdjusting] = useState<StockSearchResult | null>(null);
  const [lastResult, setLastResult] = useState<AdjustStockResult | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">สต็อกสินค้า</h1>
        <p className="text-muted-foreground">ตรวจสอบและปรับปรุงจำนวนสินค้าคงเหลือในแต่ละสาขา</p>
      </div>

      {isManager && adjusting && (
        <AdjustmentForm
          key={`${adjusting.productId}:${adjusting.storeId}`}
          row={adjusting}
          onDone={(result) => {
            setLastResult(result);
            setAdjusting(null);
          }}
          onCancel={() => setAdjusting(null)}
        />
      )}

      {lastResult && (
        <p role="status" className="rounded-lg border p-3 text-sm">
          บันทึกการปรับสต็อกแล้ว (รายการเคลื่อนไหว {lastResult.movementId}): ยอดคงเหลือ{' '}
          {lastResult.balanceBefore} → {lastResult.balanceAfter}
        </p>
      )}

      {stock.isPending ? (
        <p className="text-muted-foreground">กำลังโหลด…</p>
      ) : stock.isError ? (
        <p role="alert" className="text-sm text-destructive">
          ไม่สามารถโหลดข้อมูลสต็อกได้
        </p>
      ) : stock.data.length === 0 ? (
        <p className="text-muted-foreground">ยังไม่มีข้อมูลสต็อก</p>
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
                  สาขา
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  คงเหลือ
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  หน่วย
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  สถานะ
                </th>
                {isManager && (
                  <th scope="col" className="px-4 py-2 font-medium">
                    การจัดการ
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {stock.data.map((row) => (
                <tr key={`${row.productId}:${row.storeId}`} className="border-b last:border-0">
                  <td className="px-4 py-2 font-mono">{row.sku}</td>
                  <td className="px-4 py-2">{row.name}</td>
                  <td className="px-4 py-2">{row.storeCode}</td>
                  <td className="px-4 py-2 text-right">{row.quantity}</td>
                  <td className="px-4 py-2">{row.unit}</td>
                  <td className="px-4 py-2">
                    <Badge variant={row.lowStock ? 'destructive' : 'secondary'}>
                      {row.lowStock ? 'สต็อกต่ำ' : 'ปกติ'}
                    </Badge>
                  </td>
                  {isManager && (
                    <td className="px-4 py-2 whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`ปรับสต็อก ${row.sku} ${row.storeCode}`}
                        onClick={() => {
                          setLastResult(null);
                          setAdjusting(row);
                        }}
                      >
                        ปรับสต็อก
                      </Button>
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

/** Read a number input, treating a cleared field as 0 rather than NaN. */
function numberValue(event: React.ChangeEvent<HTMLInputElement>): number {
  return Number.isNaN(event.target.valueAsNumber) ? 0 : event.target.valueAsNumber;
}

function AdjustmentForm({
  row,
  onDone,
  onCancel,
}: {
  row: StockSearchResult;
  onDone: (result: AdjustStockResult) => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const adjust = useMutation(
    orpc.inventory.adjust.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.inventory.key() }),
    }),
  );
  const [direction, setDirection] = useState<AdjustmentDirection>('INCREASE');
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState('');

  return (
    <form
      className="space-y-4 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        adjust.mutate(
          { productId: row.productId, storeId: row.storeId, direction, quantity, reason },
          { onSuccess: onDone },
        );
      }}
    >
      <h2 className="text-lg font-semibold">
        ปรับสต็อก {row.sku} สาขา {row.storeCode} (คงเหลือ {row.quantity} {row.unit})
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="direction">ประเภทการปรับ</Label>
          <select
            id="direction"
            value={direction}
            onChange={(event) => setDirection(event.target.value as AdjustmentDirection)}
            className={SELECT_CLASS}
          >
            <option value="INCREASE">เพิ่มสต็อก</option>
            <option value="DECREASE">ลดสต็อก</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="quantity">จำนวน</Label>
          <Input
            id="quantity"
            type="number"
            min="1"
            step="1"
            required
            value={quantity}
            onChange={(event) => setQuantity(numberValue(event))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="reason">เหตุผล</Label>
          <Input
            id="reason"
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      </div>
      <div className="flex items-center gap-4">
        <Button type="submit" disabled={adjust.isPending}>
          {adjust.isPending ? 'กำลังบันทึก…' : 'บันทึกการปรับสต็อก'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          ยกเลิก
        </Button>
        {adjust.error && (
          <span role="alert" className="text-sm text-destructive">
            {errorMessage(adjust.error, 'ไม่สามารถปรับสต็อกได้')}
          </span>
        )}
      </div>
    </form>
  );
}
