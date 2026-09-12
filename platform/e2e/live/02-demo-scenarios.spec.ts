import { expect, test, type Page } from '@playwright/test';
import { shot, tenantLogin } from './helpers.js';

test.describe.configure({ mode: 'serial' });

async function expectAccepted(page: Page, scenario: RegExp): Promise<void> {
  const result = page.getByTestId('scenario-result');
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(result).toContainText(scenario);
  await expect(result).toContainText(/accepted/i);
}

test('the time machine moves the business clock and speeds it up', async ({ page }) => {
  await tenantLogin(page, 'admin');
  await page.goto('/console');
  const card = page.getByTestId('time-machine');
  await expect(card).toBeVisible();
  await expect(card.getByTestId('tm-time')).toHaveText(/\d{2}:\d{2}/);

  await card.locator('#tm-jump-time').fill('08:45');
  await card.getByRole('button', { name: /^jump$/i }).click();
  await expect(card.getByTestId('tm-time')).toHaveText(/08:4\d/, { timeout: 15_000 });
  await expect(page.getByTestId('clock-time')).toHaveText(/^08:4\d:\d{2}$/);

  // Nobody comes to the office at the weekend: step the business date forward to a weekday.
  const headerDate = page.getByTestId('clock-time').locator('xpath=..');
  for (let i = 0; i < 2; i++) {
    if (!/\b(Sat|Sun),/.test(await headerDate.innerText())) break;
    await card.getByRole('button', { name: /\+1 day/i }).click();
    await page.waitForTimeout(1_500);
  }
  await expect(headerDate).not.toContainText(/\b(Sat|Sun),/, { timeout: 15_000 });

  await card.getByRole('button', { name: /10\s*×|10x/i }).click();
  await shot(page, '11-time-machine-0845-10x');

  await page.goto('/floors/1');
  await expect(page.locator('svg g[data-room]')).toHaveCount(7);
  await shot(page, '12-floor-1-morning');
});

test('with the office open, the floor plan shows people and laptops arriving', async ({ page }) => {
  await tenantLogin(page, 'admin');
  await page.goto('/floors/1');
  await expect(page.locator('svg g[data-room]')).toHaveCount(7);
  await expect(page.getByTestId('floor-summary')).toBeVisible();
  await expect(page.getByTestId('live-status')).toBeVisible();
  // Personas follow the business clock, which the previous test set to 08:45 at 10x: laptops
  // come online as people arrive. Also needs the simulator to list this tenant.
  await expect(page.locator('[data-device-type="laptop"][data-online="true"]').first()).toBeVisible(
    {
      timeout: 120_000,
    },
  );
  await shot(page, '10-floor-1-live');
});

test('the console scenarios are accepted by the simulator', async ({ page }) => {
  await tenantLogin(page, 'admin');
  await page.goto('/console');
  await expect(page.getByText(/scenario console/i)).toBeVisible();

  // ghost meeting in the first meeting room
  await expect(page.locator('#ghost-room option')).not.toHaveCount(0, { timeout: 15_000 });
  await page.getByTestId('ghost-meeting').click();
  await expectAccepted(page, /ghost-meeting/);

  // lunch peak
  const lunch = page
    .locator('.rounded-xl')
    .filter({ hasText: /lunch peak/i })
    .first();
  await lunch.getByRole('button', { name: /^run$/i }).click();
  await expectAccepted(page, /lunch-peak/);

  // heater left on in the selected room
  await page.getByTestId('heater-left-on').click();
  await expectAccepted(page, /heater-left-on/);

  // late worker stays: first employee in the list
  const late = page.locator('#late-employee');
  await expect(late.locator('option')).not.toHaveCount(0, { timeout: 15_000 });
  const first = await late.locator('option').first().getAttribute('value');
  await late.selectOption(first!);
  await page.getByTestId('late-worker').click();
  await expectAccepted(page, /late-worker-stays/);
  await shot(page, '13-console-scenarios');

  // automations on demand
  await page.getByTestId('run-sweep').click();
  await expect(page.getByTestId('automation-result')).toContainText(/evening sweep/i, {
    timeout: 30_000,
  });
  await page.getByTestId('run-morning-report').click();
  await expect(page.getByTestId('report-result')).toContainText(/morning report/i, {
    timeout: 60_000,
  });
  await shot(page, '14-console-automations');
});

test('the sweep summary and the morning report are visible where the demo shows them', async ({
  page,
}) => {
  await tenantLogin(page, 'admin');
  await page.goto('/automations');
  const sweep = page.getByTestId('automation-evening_sweep');
  await expect(sweep.getByTestId('run-summary')).toBeVisible({ timeout: 15_000 });
  await expect(sweep.getByTestId('run-summary')).toContainText(/rooms/i);
  await shot(page, '15-automations');

  await page.goto('/automations/runs');
  await expect(page.getByTestId('automation-runs-page')).toBeVisible();

  await page.goto('/reports/mornings');
  await expect(page.getByTestId('reports-page')).toBeVisible();
  await expect(page.getByTestId('morning-report').first()).toBeVisible({ timeout: 15_000 });
  await shot(page, '16-morning-report');
});

test('automations can be tuned from the UI and take effect without a restart', async ({ page }) => {
  await tenantLogin(page, 'admin');
  await page.goto('/automations');
  const sweep = page.getByTestId('automation-evening_sweep');
  const time = sweep.locator('input[type="time"]').first();
  await expect(time).toBeVisible();
  const original = await time.inputValue();
  await time.fill('19:00');
  await sweep.getByRole('button', { name: /^save$/i }).click();
  await expect(sweep.getByRole('button', { name: /^save$/i })).toBeDisabled({ timeout: 15_000 });
  await page.reload();
  await expect(
    page.getByTestId('automation-evening_sweep').locator('input[type="time"]').first(),
  ).toHaveValue('19:00');
  // put it back so the demo world stays as loaded
  const again = page.getByTestId('automation-evening_sweep').locator('input[type="time"]').first();
  await again.fill(original);
  await page
    .getByTestId('automation-evening_sweep')
    .getByRole('button', { name: /^save$/i })
    .click();
  await expect(
    page.getByTestId('automation-evening_sweep').getByRole('button', { name: /^save$/i }),
  ).toBeDisabled({ timeout: 15_000 });
});

test('the insight pages render for the tenant', async ({ page }) => {
  await tenantLogin(page, 'admin');
  const pages: Array<[string, string]> = [
    ['/reports/energy-cost', 'energy-cost-page'],
    ['/reports/savings', 'savings-page'],
    ['/reports/asset-financials', 'financials-page'],
    ['/energy', 'energy-page'],
    ['/energy/standby', 'standby-page'],
    ['/energy/ac-health', 'ac-health-page'],
    ['/rooms', 'rooms-page'],
    ['/rooms/utilisation', 'utilisation-page'],
    ['/assets', 'assets-page'],
    ['/assets/fleet', 'fleet-page'],
    ['/maintenance', 'maintenance-page'],
    ['/calendar', 'calendar-page'],
    ['/notifications', 'notifications-page'],
    ['/audit', 'audit-page'],
  ];
  for (const [path, testId] of pages) {
    await page.goto(path);
    await expect(page.getByTestId(testId)).toBeVisible({ timeout: 20_000 });
    await shot(page, `20-${testId}`);
  }
});

test('the business clock goes back to real time', async ({ page }) => {
  await tenantLogin(page, 'admin');
  await page.goto('/console');
  const card = page.getByTestId('time-machine');
  const back = card.getByRole('button', { name: /back to real time/i });
  await expect(card.getByTestId('tm-time')).toHaveText(/\d{2}:\d{2}/);
  // the button is disabled while the clock already follows real time
  if (await back.isEnabled()) await back.click();
  await expect(back).toBeDisabled({ timeout: 15_000 });
  const hour = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', timeZone: 'Asia/Dubai' }).format(
    new Date(),
  );
  await expect(card.getByTestId('tm-time')).toHaveText(new RegExp(`^${hour}:`), {
    timeout: 15_000,
  });
});
