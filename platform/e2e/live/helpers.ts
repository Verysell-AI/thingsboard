import { expect, type Page } from '@playwright/test';

export const platformHost = process.env.LIVE_PLATFORM_HOST ?? 'dcs.verysell.ai';
export const tenant = process.env.LIVE_TENANT ?? 'gamma';
export const adminOrigin = `https://${platformHost}`;
export const tenantOrigin = (key: string) => `https://${key}.${platformHost}`;
export const datasetPassword = process.env.DATASET_USER_PASSWORD ?? 'Demo1234!';
export const shots = process.env.E2E_SHOTS_DIR;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required for the live checks`);
  return v;
}

/** Signs in to the platform console as the operator. */
export async function adminLogin(page: Page): Promise<void> {
  await page.goto(`${adminOrigin}/admin/login`);
  await page.locator('#admin-email').fill(requireEnv('PLATFORM_ADMIN_EMAIL'));
  await page.locator('#admin-password').fill(requireEnv('PLATFORM_ADMIN_PASSWORD'));
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: /tenants/i })).toBeVisible();
}

/**
 * Opens a tenant page. The first request to a fresh tenant hostname makes Caddy issue its
 * certificate on demand, which can take a few seconds and fail the very first handshake.
 */
export async function gotoTenant(page: Page, key: string, path: string): Promise<void> {
  const url = `${tenantOrigin(key)}${path}`;
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await page.goto(url, { timeout: 30_000 });
      return;
    } catch (e) {
      lastError = e;
      await page.waitForTimeout(5_000);
    }
  }
  throw lastError;
}

/** Signs in to a tenant as one of its dataset users. */
export async function tenantLogin(page: Page, local: string, key = tenant): Promise<void> {
  await gotoTenant(page, key, '/login');
  await page.evaluate(() => sessionStorage.clear());
  await gotoTenant(page, key, '/login');
  await page.getByLabel(/email/i).fill(`${local}@${key}.demo`);
  await page.getByLabel(/password/i).fill(datasetPassword);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL(/\/(floors\/1|reports|m)/);
}

export async function shot(page: Page, name: string): Promise<void> {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
}
