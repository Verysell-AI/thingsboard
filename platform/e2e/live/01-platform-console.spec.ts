import { expect, test } from '@playwright/test';
import {
  adminLogin,
  adminOrigin,
  gotoTenant,
  platformHost,
  shot,
  tenant,
  tenantLogin,
} from './helpers.js';

test.describe.configure({ mode: 'serial' });

const tenantName = `${tenant.charAt(0).toUpperCase()}${tenant.slice(1)} Workspaces`;

test('the platform operator signs in to the console', async ({ page }) => {
  await adminLogin(page);
  await shot(page, '01-admin-tenants');
});

test('the shipped tenants are served on the platform host', async ({ page }) => {
  await adminLogin(page);
  for (const key of ['alpha', 'beta']) {
    await page.goto(`${adminOrigin}/admin/tenants/${key}`);
    const hostname = page.locator('#hostname');
    await expect(hostname).toBeVisible();
    const wanted = `${key}.${platformHost}`;
    if ((await hostname.inputValue()) !== wanted) {
      await hostname.fill(wanted);
      await page.getByRole('button', { name: /^save$/i }).click();
      await expect(page.getByText(/^saved$/i)).toBeVisible();
    }
    await expect(hostname).toHaveValue(wanted);
  }
  await gotoTenant(page, 'alpha', '/login');
  await expect(page).toHaveTitle(/Falcon/);
  await gotoTenant(page, 'beta', '/login');
  await expect(page).toHaveTitle(/Oasis/);
});

test('a new tenant is created from the console with the office-demo dataset', async ({ page }) => {
  await adminLogin(page);

  // The tenant may already exist from an earlier run (and carry backfilled history): keep it.
  // Set LIVE_DELETE_TENANT=1 to remove it in the last test of this file and start afresh.
  // (The console redirects an unknown /admin/tenants/<key> back to the list, so check the list.)
  await expect(page.getByRole('cell', { name: 'alpha', exact: true })).toBeVisible();
  if ((await page.getByRole('cell', { name: tenant, exact: true }).count()) > 0) {
    await page.goto(`${adminOrigin}/admin/tenants/${tenant}`);
    await expect(page.locator('#hostname')).toHaveValue(`${tenant}.${platformHost}`);
    test.info().annotations.push({ type: 'note', description: `tenant ${tenant} already existed` });
    return;
  }

  await page.getByRole('link', { name: /new tenant/i }).click();
  await page.waitForURL(/\/admin\/tenants\/new/);
  await page.locator('#key').fill(tenant);
  await page.locator('#name').fill(tenantName);
  await page.locator('#hostname').fill(`${tenant}.${platformHost}`);
  const dataset = page.locator('#dataset');
  await expect(dataset.locator('option', { hasText: 'office-demo' })).toHaveCount(1);
  await dataset.selectOption('office-demo');
  const demo = page.locator('#demo-mode');
  if ((await demo.getAttribute('aria-checked')) !== 'true') await demo.click();
  await expect(demo).toHaveAttribute('aria-checked', 'true');
  // simulated devices default to on, so the tenant gets live telemetry without any server change
  await expect(page.locator('#simulated')).toHaveAttribute('aria-checked', 'true');
  await shot(page, '02-new-tenant-form');
  await page.getByRole('button', { name: /create tenant/i }).click();

  await expect(
    page.getByRole('heading', { name: new RegExp(`provisioning ${tenantName}`, 'i') }),
  ).toBeVisible();
  await shot(page, '03-provisioning-running');
  // On success the console navigates to the tenant page as soon as the job finishes; on failure
  // it stays and shows the job log. Provisioning creates the IoT core tenant, its assets and
  // devices, so allow several minutes.
  const tenantPage = new RegExp(`/admin/tenants/${tenant}$`);
  const failed = page.getByText(/^failed$/i);
  await expect
    .poll(async () => tenantPage.test(page.url()) || (await failed.isVisible()), {
      timeout: 600_000,
      intervals: [2_000],
    })
    .toBe(true);
  if (!tenantPage.test(page.url())) {
    const log = await page.locator('pre').innerText();
    throw new Error(`provisioning failed:\n${log}`);
  }
  await expect(page.locator('#hostname')).toHaveValue(`${tenant}.${platformHost}`);
  await page.goto(`${adminOrigin}/admin`);
  const row = page.getByRole('row').filter({ hasText: tenantName });
  await expect(row).toBeVisible();
  await expect(row).toContainText(`${tenant}.${platformHost}`);
  await shot(page, '04-tenant-list');
});

test('the new tenant serves its own login page and its dataset users sign in', async ({ page }) => {
  await gotoTenant(page, tenant, '/login');
  await expect(page.getByRole('button', { name: /sign in|log in/i })).toBeVisible();
  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/thingsboard/i);
  await shot(page, '05-tenant-login');

  await tenantLogin(page, 'admin');
  await expect(page).toHaveURL(/\/floors\/1/);
  await expect(page.locator('svg g[data-room]')).toHaveCount(7);
  await shot(page, '06-tenant-floor-1');
});

test('the tenant can be removed from the console', async ({ page }) => {
  test.skip(
    process.env.LIVE_DELETE_TENANT !== '1',
    'set LIVE_DELETE_TENANT=1 to exercise deletion',
  );
  await adminLogin(page);
  await page.goto(`${adminOrigin}/admin/tenants/${tenant}`);
  await page.getByRole('tab', { name: /maintenance/i }).click();
  await page.locator('#confirm-key').fill(tenant);
  await page.getByRole('button', { name: /delete tenant/i }).click();
  await expect
    .poll(
      async () => {
        await page.goto(`${adminOrigin}/admin`);
        return page
          .getByRole('row')
          .filter({ hasText: new RegExp(`\\b${tenant}\\b`) })
          .count();
      },
      { timeout: 300_000, intervals: [5_000] },
    )
    .toBe(0);
  await gotoTenant(page, tenant, '/login');
  await expect(page.locator('body')).toContainText(/unknown tenant|not found|sign in/i);
});
