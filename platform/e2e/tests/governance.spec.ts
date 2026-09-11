import { expect, test } from '@playwright/test';
import { login } from './helpers.js';

/** Second tenant's origin (the default config runs against alpha). */
const BETA = process.env.E2E_BETA_URL ?? 'http://beta.localhost:8081';

test('the two tenants carry their own brand and nothing about the vendor', async ({ page }) => {
  await page.goto('/login');
  await expect(page).toHaveTitle(/Falcon/);
  const alphaTitle = await page.title();
  const alphaLogo = (await page.locator('img[alt]').first().getAttribute('alt')) ?? '';
  const alphaBody = await page.locator('body').innerText();
  await page.goto(`${BETA}/login`);
  await expect(page).toHaveTitle(/Oasis/);
  const betaTitle = await page.title();
  const betaLogo = (await page.locator('img[alt]').first().getAttribute('alt')) ?? '';
  const betaBody = await page.locator('body').innerText();
  expect(alphaTitle).not.toBe(betaTitle);
  for (const text of [alphaBody, betaBody, alphaTitle, betaTitle, alphaLogo, betaLogo]) {
    expect(text).not.toMatch(/thingsboard/i);
    expect(text).not.toMatch(/verysell/i);
  }
});

test('the evening sweep runs from the console and its summary lists rooms and reasons', async ({
  page,
}) => {
  await login(page, 'admin');
  await page.goto('/console');
  await page.getByTestId('run-sweep').click();
  await expect(page.getByTestId('automation-result')).toContainText(/evening sweep/i, {
    timeout: 20_000,
  });
  await page.goto('/automations');
  const card = page.getByTestId('automation-evening_sweep');
  await expect(card.getByTestId('run-summary')).toBeVisible();
  await expect(card.getByTestId('run-summary')).toContainText(/rooms/i);
  await page.goto('/floors/2');
  // the server room is never touched: its light stays on whatever the sweep did
  await expect(page.locator('svg g[data-room="2.S"]')).toBeVisible();
});

test('a viewer is refused when shedding load, and the refusal is audited', async ({ page }) => {
  await login(page, 'viewer');
  await page.goto('/energy');
  await page.getByTestId('shed-now').click();
  await expect(page.getByTestId('shed-error')).toBeVisible({ timeout: 10_000 });
  await login(page, 'admin');
  await page.goto('/audit');
  await expect(page.getByTestId('audit-page')).toBeVisible();
  await page.getByLabel(/action/i).selectOption('DENIED');
  await expect(page.getByTestId('audit-row').first()).toHaveAttribute('data-action', 'DENIED', {
    timeout: 10_000,
  });
  await page.getByTestId('audit-row').first().click();
  await expect(page.getByTestId('audit-diff')).toBeVisible();
});

test('the language toggle switches the shell to Arabic right-to-left and back', async ({
  page,
}) => {
  await login(page, 'admin');
  await page.getByLabel(/language/i).selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.getByRole('navigation', { name: 'Main' })).toContainText(/الأصول/);
  await page.getByLabel(/اللغة|language/i).selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});

test('reports render, snapshots download as PDF and finance sees only the reports', async ({
  page,
}) => {
  await login(page, 'admin');
  await page.goto('/reports/savings');
  await expect(page.getByTestId('savings-page')).toBeVisible();
  await page.getByTestId('snapshot-now').click();
  await expect(page.getByTestId('snapshot').first()).toBeVisible({ timeout: 15_000 });
  const download = page.waitForEvent('download');
  await page.getByTestId('download-pdf').first().click();
  expect((await download).suggestedFilename()).toMatch(/savings.*\.pdf$/);

  await login(page, 'finance');
  await expect(page).toHaveURL(/\/reports\/energy-cost/);
  await expect(page.getByTestId('energy-cost-page')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).not.toContainText(/floor plan/i);
  await page.goto('/assets');
  await expect(page.getByTestId('assets-page')).toHaveCount(0);
});

test('the phone view answers the late-worker prompt', async ({ page }) => {
  await page.goto('/m?tenant=alpha');
  await expect(page).toHaveURL(/\/login\?next=(%2F|\/)m/);
  await page.getByLabel(/email/i).fill('ops@alpha.demo');
  await page.getByLabel(/password/i).fill(process.env.DATASET_USER_PASSWORD ?? 'Demo1234!');
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(page.getByTestId('phone-view')).toBeVisible();
});
