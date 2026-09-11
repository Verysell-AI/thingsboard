import { defineConfig, devices } from '@playwright/test';

/**
 * Runs the live checks in ./live against a deployed platform (TLS front door, real hostnames).
 *
 *   LIVE_PLATFORM_HOST        bare platform host, e.g. dcs.verysell.ai
 *   LIVE_TENANT               tenant key the demo checks run against (default gamma)
 *   PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD   platform console operator
 *   DATASET_USER_PASSWORD     password of the dataset users (admin@, ops@, viewer@ ...)
 *   E2E_SHOTS_DIR             optional folder for screenshots
 */
const host = process.env.LIVE_PLATFORM_HOST ?? 'dcs.verysell.ai';
const tenant = process.env.LIVE_TENANT ?? 'gamma';

export default defineConfig({
  testDir: './live',
  timeout: 180_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: `https://${tenant}.${host}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'live-report' }]],
});
