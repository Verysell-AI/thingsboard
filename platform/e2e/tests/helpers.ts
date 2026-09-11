import type { Page } from '@playwright/test';

export const password = process.env.DATASET_USER_PASSWORD ?? 'Demo1234!';
export const tenant = process.env.E2E_TENANT ?? 'alpha';

/** Signs in through the login page as one of the dataset users of the tenant under test. */
export async function login(page: Page, local: string, key = tenant, base?: string): Promise<void> {
  // an earlier sign-in in the same page would bounce /login to the app: drop the session first
  await page.goto(`${base ?? ''}/login`);
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(`${base ?? ''}/login`);
  await page.getByLabel(/email/i).fill(`${local}@${key}.demo`);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL(/\/(floors\/1|reports|m)/);
}
