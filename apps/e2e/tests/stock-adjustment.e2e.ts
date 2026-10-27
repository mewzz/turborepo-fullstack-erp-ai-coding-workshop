import { expect, test } from '@playwright/test';
import { storageState } from './accounts.js';

test.describe('stock adjustment', () => {
  test.use({ storageState: storageState('manager') });

  test('a manager opens a product’s stock in a store, decreases the balance by N with a reason, sees the new balance and a movement row; then tries to decrease below zero and sees it rejected', async ({
    page,
  }) => {
    await page.goto('/stock');
    const stock = page.getByRole('table', { name: 'สต็อกคงเหลือ' });
    const row = stock.getByRole('row', { name: /SKU001.*B01/ });
    const balance = row.getByRole('cell').nth(3);
    const adjust = async (direction: 'INCREASE' | 'DECREASE', quantity: number, reason: string) => {
      await row.getByRole('button', { name: 'ปรับสต็อก SKU001 B01' }).click();
      await page.getByLabel('ประเภทการปรับ').selectOption(direction);
      await page.getByLabel('จำนวน').fill(String(quantity));
      await page.getByLabel('เหตุผล').fill(reason);
      await page.getByRole('button', { name: 'บันทึกการปรับสต็อก' }).click();
    };

    // Top up first so the decrease below has units to remove, however often the suite has run.
    await expect(balance).toHaveText(/^\d+$/);
    const start = Number(await balance.innerText());
    await adjust('INCREASE', 5, 'เติมสต็อกสำหรับการทดสอบ');
    await expect(balance).toHaveText(String(start + 5));
    const before = start + 5;

    // Decrease by 2 with a reason: the new balance and a movement row (before, change, after).
    await adjust('DECREASE', 2, 'นับสต็อกใหม่');

    await expect(balance).toHaveText(String(before - 2));
    const movements = page.getByRole('table', { name: 'รายการเคลื่อนไหวล่าสุด' });
    await expect(
      movements.getByRole('row', { name: new RegExp(`SKU001 B01 ${before} -2 ${before - 2}$`) }),
    ).toBeVisible();

    // Decrease by more than is on hand: rejected, and the balance is unchanged.
    await adjust('DECREASE', before - 2 + 1, 'ลดเกินยอดคงเหลือ');

    await expect(page.getByRole('alert')).toContainText('สต็อกคงเหลือติดลบไม่ได้');
    await expect(balance).toHaveText(String(before - 2));
  });
});
