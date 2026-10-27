import type { CreateSale } from '@erp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCurrentUser } from '@/lib/auth';
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

type LineForm = { productId: string; quantity: number };
const EMPTY_LINE: LineForm = { productId: '', quantity: 1 };

/** Build the create payload, dropping lines with no product chosen (a sale needs >=1). */
function toCreate(storeId: string, lines: LineForm[]): CreateSale {
  return { storeId, lines: lines.filter((line) => line.productId) };
}

/**
 * The draft sale form (SAL-01). A store employee records a sale for their assigned store at the
 * current selling price — there is no price field, the server snapshots it (SAL-01). The running
 * total shown here is an estimate from the current catalogue price for the operator's convenience.
 */
export function SaleForm() {
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const products = useQuery(orpc.products.list.queryOptions());

  const invalidate = () => queryClient.invalidateQueries({ queryKey: orpc.sales.list.queryKey() });
  const create = useMutation(orpc.sales.create.mutationOptions({ onSuccess: invalidate }));

  const [lines, setLines] = useState<LineForm[]>([{ ...EMPTY_LINE }]);

  const setLine = (index: number, patch: Partial<LineForm>) =>
    setLines(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  const addLine = () => setLines([...lines, { ...EMPTY_LINE }]);
  const removeLine = (index: number) =>
    setLines(lines.length > 1 ? lines.filter((_, i) => i !== index) : lines);
  const reset = () => setLines([{ ...EMPTY_LINE }]);

  const activeProducts = (products.data ?? []).filter((product) => product.active);
  const priceOf = (productId: string) =>
    activeProducts.find((product) => product.id === productId)?.sellingPrice ?? 0;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!user?.storeId) return;
    create.mutate(toCreate(user.storeId, lines), { onSuccess: reset });
  };

  const estimate = lines.reduce((sum, line) => sum + line.quantity * priceOf(line.productId), 0);

  return (
    <form className="space-y-4 rounded-lg border p-4" onSubmit={submit}>
      <h2 className="text-lg font-semibold">บันทึกการขายใหม่</h2>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">รายการสินค้า</legend>
        {lines.map((line, index) => (
          <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_auto]">
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
                  {product.sku} — {product.name} ({baht.format(product.sellingPrice)} บาท)
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
            {errorMessage(create.error, 'ไม่สามารถบันทึกการขายได้')}
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          ราคารวมโดยประมาณ: {baht.format(estimate)} บาท
        </span>
      </div>
    </form>
  );
}
