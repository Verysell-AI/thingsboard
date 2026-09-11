import { expect, test, type Page } from '@playwright/test';

const password = process.env.DATASET_USER_PASSWORD ?? 'Demo1234!';
const tenant = process.env.E2E_TENANT ?? 'alpha';

async function login(page: Page, user: string) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(`${user}@${tenant}.demo`);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL(/\/floors\/1/);
}

test('asset register lists devices, opens the drawer and an admin can switch an AC unit', async ({
  page,
}) => {
  await login(page, 'admin');
  await page.goto('/assets?search=AC-1.3');
  const table = page.getByTestId('assets-page');
  await expect(table).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'AC-1.3' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('row').filter({ hasText: 'AC-1.3' }).click();
  const drawer = page.getByTestId('asset-drawer');
  await expect(drawer).toBeVisible();
  await expect(page).toHaveURL(/asset=/);
  await drawer.getByRole('tab', { name: /actions/i }).click();
  const actions = page.getByTestId('asset-actions');
  await expect(actions).toBeVisible();
  const toggle = actions.getByRole('switch').first();
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(page.getByTestId('command-result')).toBeVisible({ timeout: 15_000 });
  // put it back so the demo world stays as loaded
  await toggle.click();
  await expect(page.getByTestId('command-result')).toBeVisible({ timeout: 15_000 });
});

test('a viewer sees the switches disabled', async ({ page }) => {
  await login(page, 'viewer');
  await page.goto('/assets?search=LIGHT-1.1');
  await page.getByRole('row').filter({ hasText: 'LIGHT-1.1' }).click({ timeout: 15_000 });
  await page
    .getByTestId('asset-drawer')
    .getByRole('tab', { name: /actions/i })
    .click();
  await expect(page.getByTestId('asset-actions').getByRole('switch').first()).toBeDisabled();
});

test('rooms show their status and a room page has the booking timeline', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/rooms');
  await expect(page.getByTestId('rooms-page')).toBeVisible();
  const roomLink = page.locator('a[href^="/rooms/"]:not([href="/rooms/utilisation"])').first();
  await expect(roomLink).toBeVisible({ timeout: 15_000 });
  await roomLink.click();
  await expect(page.getByTestId('room-detail')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('booking-timeline')).toBeVisible();
});

test('energy overview renders tiles and a trend chart', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/energy');
  await expect(page.getByTestId('energy-page')).toBeVisible();
  await expect(page.getByTestId('energy-tiles')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('energy-trend')).toBeVisible({ timeout: 15_000 });
});

test('HR adds an employee and the laptop boots, goes offline and raises an unreachable alert', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await login(page, 'admin');
  await page.goto('/employees/new');
  const form = page.getByTestId('new-employee');
  await expect(form).toBeVisible();
  const name = `E2E Person ${Date.now().toString().slice(-5)}`;
  await form.locator('#emp-name').fill(name);
  const roomSelect = form.locator('#emp-room');
  await expect(roomSelect.locator('option')).not.toHaveCount(0, { timeout: 15_000 });
  const options = await roomSelect
    .locator('option')
    .evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value).filter((v) => v !== ''));
  await roomSelect.selectOption(options[0]!);
  await form.getByRole('button', { name: /create employee/i }).click();
  await expect(page.getByTestId('employee-created')).toBeVisible({ timeout: 30_000 });
  const firstBoot = page.getByTestId('first-boot');
  await expect(firstBoot).toBeVisible();
  await firstBoot.click();
  const status = page.getByTestId('laptop-status');
  // simulator connect → core activity event → platform live state → socket: allow a minute
  await expect(status).toContainText(/online/i, { timeout: 60_000 });
  // 60 s online, then the simulator disconnects it and ThingsBoard reports inactivity ~30 s later
  await expect(status).toContainText(/offline|unreachable|alarm/i, { timeout: 150_000 });
  await page.goto('/notifications');
  await expect(page.getByTestId('notifications-page')).toBeVisible();
  await expect(page.getByText(/unreachable/i).first()).toBeVisible({ timeout: 60_000 });
});
