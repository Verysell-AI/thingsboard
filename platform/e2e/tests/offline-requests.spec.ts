import { expect, test } from '@playwright/test';
import { login } from './helpers.js';

/**
 * The demo runs with the network unplugged: every request the browser makes must stay on the demo
 * box (tenant hostnames, the bare host and the IoT core). Fonts, icons and scripts are bundled.
 */
test('the app contacts only local origins', async ({ page }) => {
  const hosts = new Set<string>();
  page.on('request', (r) => hosts.add(new URL(r.url()).hostname));
  await login(page, 'admin');
  for (const path of [
    '/floors/1',
    '/assets',
    '/rooms',
    '/energy',
    '/automations',
    '/reports/mornings',
    '/notifications',
  ]) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  const foreign = [...hosts].filter((h) => !/(^|\.)localhost$/.test(h) && h !== '127.0.0.1');
  expect(foreign).toEqual([]);
});
