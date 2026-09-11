import { expect, test } from '@playwright/test';
import { password, tenant } from './helpers.js';

const shots = process.env.E2E_SHOTS_DIR;

test('admin can log in and see the live floor plan and the console', async ({ page }) => {
  await page.goto('/login');
  if (shots) await page.screenshot({ path: `${shots}/${tenant}-login.png`, fullPage: true });
  await page.getByLabel(/email/i).fill(`admin@${tenant}.demo`);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();

  await page.waitForURL(/\/floors\/1/);
  const rooms = page.locator('svg g[data-room]');
  await expect(rooms).toHaveCount(7);
  // live state arrives over the WebSocket: at least one laptop dot turns green within 15 s
  await expect(page.locator('[data-device-type="laptop"][data-online="true"]').first()).toBeVisible(
    {
      timeout: 15_000,
    },
  );
  if (shots) await page.screenshot({ path: `${shots}/${tenant}-floor-1.png`, fullPage: true });

  await page.goto('/console');
  await expect(page.getByText(/first boot of a laptop/i)).toBeVisible();
  await expect(page.getByText(/everyone leaves/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /^run$/i })).toHaveCount(5);
  // time machine: the header clock and the console card show the business time in the tenant zone
  await expect(page.getByTestId('time-machine')).toBeVisible();
  await expect(page.getByTestId('clock-time')).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
  if (shots) await page.screenshot({ path: `${shots}/${tenant}-console.png`, fullPage: true });
});
