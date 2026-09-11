import { defineConfig, devices } from '@playwright/test';

/** Runs against the compose stack (make up + provision + dataset). */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://alpha.localhost:8081',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  reporter: [['list'], ['html', { open: 'never' }]],
});
