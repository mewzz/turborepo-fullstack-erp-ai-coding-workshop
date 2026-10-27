import type { Sale, SaleStatus } from '@erp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SaleForm } from '@/components/sale-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCurrentUser } from '@/lib/auth';
import { orpc } from '@/lib/orpc';

const baht = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Thai labels for each lifecycle status (SAL-01..04). */
const STATUS_LABEL: Record<SaleStatus, string> = {
  DRAFT: 'แบบร่าง',
  CONFIRMED: 'ยืนยันแล้ว',
};

const STATUS_VARIANT: Record<SaleStatus, 'default' | 'secondary'> = {
  DRAFT: 'secondary',
  CONFIRMED: 'default',
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** A sale's total from its snapshotted line prices (SAL-01). */
function saleTotal(sale: Sale): number {
  return sale.lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
}

/**
 * The sales screen (T7). A store employee records draft sales for their assigned store and confirms
 * them, which decreases stock. A confirmed sale is terminal: it stays viewable but offers no edit,
 * cancel or return (SAL-04). Actions are offered by role, mirroring the API guards — the server is
 * still the authority.
 */
export function SaleList() {
  const user = useCurrentUser();
  const isEmployee = user?.role === 'STORE_EMPLOYEE';
  const sales = useQuery(orpc.sales.list.queryOptions());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">การขาย</h1>
        <p className="text-muted-foreground">บันทึกและยืนยันรายการขายของร้าน</p>
      </div>

      {isEmployee && <SaleForm />}

      {sales.isPending ? (
        <p className="text-muted-foreground">กำลังโหลด…</p>
      ) : sales.isError ? (
        <p role="alert" className="text-sm text-destructive">
          ไม่สามารถโหลดรายการขายได้
        </p>
      ) : sales.data.length === 0 ? (
        <p className="text-muted-foreground">ยังไม่มีรายการขาย</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  เลขที่
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  สินค้า
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  ยอดรวม
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
              {sales.data.map((sale) => (
                <SaleRow key={sale.id} sale={sale} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SaleRow({ sale }: { sale: Sale }) {
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const confirm = useMutation(
    orpc.sales.confirm.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.sales.list.queryKey() }),
    }),
  );

  const isEmployee = user?.role === 'STORE_EMPLOYEE';
  const canConfirm = isEmployee && sale.status === 'DRAFT';

  return (
    <tr className="border-b align-top last:border-0">
      <td className="px-4 py-2 font-mono">{sale.number ?? '—'}</td>
      <td className="px-4 py-2">
        <ul className="space-y-0.5">
          {sale.lines.map((line) => (
            <li key={line.id}>
              {line.productName} × {line.quantity}
            </li>
          ))}
        </ul>
      </td>
      <td className="px-4 py-2 text-right">{baht.format(saleTotal(sale))}</td>
      <td className="px-4 py-2">
        <Badge variant={STATUS_VARIANT[sale.status]}>{STATUS_LABEL[sale.status]}</Badge>
      </td>
      <td className="space-x-2 px-4 py-2 whitespace-nowrap">
        {canConfirm && (
          <Button
            size="sm"
            disabled={confirm.isPending}
            aria-label="ยืนยันการขาย"
            onClick={() => confirm.mutate({ id: sale.id, idempotencyKey: crypto.randomUUID() })}
          >
            ยืนยันการขาย
          </Button>
        )}
        {confirm.error && (
          <span role="alert" className="text-sm text-destructive">
            {errorMessage(confirm.error, 'ไม่สามารถยืนยันการขายได้')}
          </span>
        )}
      </td>
    </tr>
  );
}
