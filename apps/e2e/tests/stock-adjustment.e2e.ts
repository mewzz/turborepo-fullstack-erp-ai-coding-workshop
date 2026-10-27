import { expect, test } from '@playwright/test';
import { storageState } from './accounts.js';

test.describe('stock adjustment', () => {
  test.use({ storageState: storageState('manager') });

  test('a manager opens a product’s stock in a store, decreases the balance by N with a reason, sees the new balance and a movement row; then tries to decrease below zero and sees it rejected', async ({
    page,
    request,
  }) => {
    // Top up through the API so the decrease below has units to remove on a re-run of the suite.
    const stock = await request.get('/api/inventory/stock', { params: { query: 'SKU001' } });
    expect(stock.ok()).toBeTruthy();
    const rows = (await stock.json()) as {
      productId: string;
      storeId: string;
      storeCode: string;
    }[];
    const central = rows.find((row) => row.storeCode === 'B01');
    expect(central, 'seeded SKU001 balance at B01').toBeDefined();
    const topUp = await request.post('/api/inventory/adjustments', {
      data: {
        productId: central!.productId,
        storeId: central!.storeId,
        direction: 'INCREASE',
        quantity: 5,
        reason: `e2e top-up ${test.info().testId}`,
      },
    });
    expect(topUp.ok(), `top-up returned ${topUp.status()}`).toBeTruthy();

    await page.goto('/stock');
    const row = page.getByRole('row', { name: /SKU001.*B01/ });
    const balance = row.getByRole('cell').nth(3);
    await expect(balance).toHaveText(/^\d+$/);
    const before = Number(await balance.innerText());

    // Decrease by 2 with a reason: the new balance and the movement (before → after) show up.
    await row.getByRole('button', { name: 'ปรับสต็อก SKU001 B01' }).click();
    await page.getByLabel('ประเภทการปรับ').selectOption('DECREASE');
    await page.getByLabel('จำนวน').fill('2');
    await page.getByLabel('เหตุผล').fill('นับสต็อกใหม่');
    await page.getByRole('button', { name: 'บันทึกการปรับสต็อก' }).click();

    await expect(page.getByRole('status')).toContainText(`${before} → ${before - 2}`);
    await expect(balance).toHaveText(String(before - 2));

    // Decrease by more than is on hand: rejected, and the balance is unchanged.
    await row.getByRole('button', { name: 'ปรับสต็อก SKU001 B01' }).click();
    await page.getByLabel('ประเภทการปรับ').selectOption('DECREASE');
    await page.getByLabel('จำนวน').fill(String(before - 2 + 1));
    await page.getByLabel('เหตุผล').fill('ลดเกินยอดคงเหลือ');
    await page.getByRole('button', { name: 'บันทึกการปรับสต็อก' }).click();

    await expect(page.getByRole('alert')).toContainText('สต็อกคงเหลือติดลบไม่ได้');
    await expect(balance).toHaveText(String(before - 2));
  });
});
