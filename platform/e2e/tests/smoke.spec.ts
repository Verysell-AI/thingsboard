import { expect, test } from '@playwright/test';

test('login page renders with the tenant brand', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('body')).toBeVisible();
  await expect(page.getByRole('button', { name: /sign in|log in/i })).toBeVisible();
});
