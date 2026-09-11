#!/usr/bin/env node
/**
 * UI audit: logs in, visits every route at several viewport sizes and reports layout defects
 * (horizontal page overflow, elements spilling past the viewport, clipped content, squeezed
 * columns), browser console errors, page errors and failed requests. Screenshots go to OUT_DIR.
 *
 * Usage: node tools/ui-audit.mjs [--base http://alpha.localhost:8081] [--out ./audit] [--lang ar]
 *        [--only phone-390,laptop-1280]
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] ?? ''] : []))
    .filter((x) => x.length),
);
const BASE = args.base ?? process.env.E2E_BASE_URL ?? 'http://alpha.localhost:8081';
const OUT = args.out ?? process.env.AUDIT_OUT ?? './audit';
const LANG = args.lang ?? 'en';
const PASSWORD = process.env.DATASET_USER_PASSWORD ?? 'Demo1234!';
const tenant = new URL(BASE).hostname.split('.')[0];
const EMAIL = process.env.AUDIT_EMAIL ?? `admin@${tenant}.demo`;

const ONLY = args.only ? args.only.split(',') : null;
const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'laptop-1280', width: 1280, height: 800 },
  { name: 'tablet-1024', width: 1024, height: 768 },
  { name: 'phone-390', width: 390, height: 844 },
];
const ROUTES = [
  { path: '/floors/1', settle: 6000 },
  { path: '/floors/2', settle: 3000 },
  { path: '/assets' },
  { path: '/employees' },
  { path: '/employees/new' },
  { path: '/rooms' },
  { path: '/energy' },
  { path: '/notifications' },
  { path: '/audit' },
  { path: '/console', settle: 14000 },
];

mkdirSync(OUT, { recursive: true });

/** Runs inside the page: returns layout defects. */
function inspectLayout() {
  const vw = document.documentElement.clientWidth;
  const issues = [];
  const doc = document.documentElement;
  if (doc.scrollWidth > vw + 1) {
    issues.push({
      type: 'page-horizontal-overflow',
      detail: `scrollWidth ${doc.scrollWidth} > viewport ${vw}`,
    });
  }
  const label = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls =
      typeof el.className === 'string'
        ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
        : '';
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    return `${el.tagName.toLowerCase()}${id}${cls} "${text}"`;
  };
  const all = Array.from(document.body.querySelectorAll('*'));
  let spill = 0,
    clipped = 0,
    squeezed = 0;
  for (const el of all) {
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const inScroller = (node) => {
      for (let n = node; n && n !== document.body; n = n.parentElement) {
        const st = getComputedStyle(n);
        if (/(auto|scroll)/.test(st.overflowX) || /(auto|scroll)/.test(st.overflow)) return true;
      }
      return false;
    };
    // 1. element spills past the right edge of the viewport
    if (r.right > vw + 1 && r.left < vw && spill < 5 && !inScroller(el)) {
      issues.push({
        type: 'spills-past-viewport',
        detail: `${label(el)} right=${Math.round(r.right)} vw=${vw}`,
      });
      spill++;
    }
    // 2. content wider than its box without a scroll container (clipped or overflowing text)
    // a horizontally scrollable ancestor makes the overflow reachable, so it is not a defect
    const scrollable = inScroller(el);
    if (
      !scrollable &&
      el.scrollWidth > el.clientWidth + 2 &&
      el.clientWidth > 0 &&
      el.children.length === 0 &&
      (el.textContent || '').trim() &&
      clipped < 8
    ) {
      // truncate is intended when text-overflow is ellipsis
      if (cs.textOverflow !== 'ellipsis') {
        issues.push({
          type: 'content-overflows-box',
          detail: `${label(el)} scrollWidth=${el.scrollWidth} clientWidth=${el.clientWidth}`,
        });
        clipped++;
      }
    }
    // 3. squeezed text column: narrow box with text wrapped onto many lines
    if (el.children.length === 0 && (el.textContent || '').trim().split(/\s+/).length >= 3) {
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
      const lines = r.height / lh;
      if (r.width < 160 && lines >= 4 && vw >= 1024 && squeezed < 5) {
        issues.push({
          type: 'squeezed-text-column',
          detail: `${label(el)} width=${Math.round(r.width)} lines≈${Math.round(lines)}`,
        });
        squeezed++;
      }
    }
  }
  // 4. sibling overlap among cards/buttons (coarse): elements with the same parent whose boxes intersect
  // full-viewport overlays (drawer backdrops) legitimately cover everything and are skipped
  const isBackdrop = (el) => {
    const r = el.getBoundingClientRect();
    return r.width >= vw * 0.9 && r.height >= window.innerHeight * 0.9;
  };
  const cards = Array.from(
    document.querySelectorAll('[data-slot="card"], button, input, select'),
  ).filter((el) => !isBackdrop(el));
  let overlaps = 0;
  for (let i = 0; i < cards.length && overlaps < 5; i++) {
    const a = cards[i].getBoundingClientRect();
    for (let j = i + 1; j < cards.length; j++) {
      if (cards[i].contains(cards[j]) || cards[j].contains(cards[i])) continue;
      const b = cards[j].getBoundingClientRect();
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (x > 4 && y > 4) {
        issues.push({
          type: 'elements-overlap',
          detail: `${label(cards[i])} ∩ ${label(cards[j])}`,
        });
        overlaps++;
        break;
      }
    }
  }
  return issues;
}

const browser = await chromium.launch();
const report = { base: BASE, lang: LANG, startedAt: new Date().toISOString(), pages: [] };
let total = 0;

for (const vp of VIEWPORTS.filter((v) => !ONLY || ONLY.includes(v.name))) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  const runtime = [];
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type()))
      runtime.push({ type: `console-${m.type()}`, detail: m.text().slice(0, 300) });
  });
  page.on('pageerror', (e) =>
    runtime.push({ type: 'page-error', detail: String(e.message).slice(0, 300) }),
  );
  page.on('response', (r) => {
    if (r.status() >= 400)
      runtime.push({
        type: 'http-error',
        detail: `${r.status()} ${r.request().method()} ${r.url()}`,
      });
  });
  page.on('requestfailed', (r) =>
    runtime.push({ type: 'request-failed', detail: `${r.failure()?.errorText} ${r.url()}` }),
  );

  // login (once per viewport)
  await page.goto(`${BASE}/login?lang=${LANG}`);
  await page.waitForLoadState('networkidle');
  const loginIssues = await page.evaluate(inspectLayout);
  await page.screenshot({ path: `${OUT}/${vp.name}-login.png`, fullPage: true });
  report.pages.push({
    viewport: vp.name,
    path: '/login',
    issues: [...loginIssues, ...runtime.splice(0)],
  });
  total += loginIssues.length;

  await page.getByLabel(/email|البريد/i).fill(EMAIL);
  await page.getByLabel(/password|كلمة/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log in|تسجيل/i }).click();
  await page.waitForURL(/\/floors\//, { timeout: 15000 });

  // narrow screens: the navigation is a drawer behind the menu button; open it once and inspect
  if (vp.width < 768) {
    await page
      .getByRole('button', { name: /menu|القائمة/i })
      .first()
      .click();
    await page.waitForTimeout(300);
    const menuIssues = await page.evaluate(inspectLayout);
    await page.screenshot({ path: `${OUT}/${vp.name}-menu-open.png`, fullPage: true });
    const navVisible = await page.getByRole('navigation', { name: 'Main' }).isVisible();
    if (!navVisible) {
      menuIssues.push({
        type: 'drawer-not-visible',
        detail: 'menu button did not reveal the navigation',
      });
    }
    report.pages.push({
      viewport: vp.name,
      path: '(menu open)',
      issues: [...menuIssues, ...runtime.splice(0)],
    });
    total += menuIssues.length;
    await page
      .getByRole('button', { name: /close menu|إغلاق/i })
      .first()
      .click()
      .catch(() => {});
  }

  for (const route of ROUTES) {
    await page.goto(`${BASE}${route.path}`);
    await page.waitForLoadState('networkidle');
    if (route.settle) await page.waitForTimeout(route.settle);
    const issues = await page.evaluate(inspectLayout);
    const docLang = await page.evaluate(() => [
      document.documentElement.lang,
      document.documentElement.dir,
    ]);
    if (docLang[0] !== LANG || docLang[1] !== (LANG === 'ar' ? 'rtl' : 'ltr')) {
      issues.push({
        type: 'wrong-locale',
        detail: `expected ${LANG}, document has lang=${docLang[0]} dir=${docLang[1]}`,
      });
    }
    const slug = route.path.replace(/\W+/g, '-').replace(/^-|-$/g, '');
    await page.screenshot({ path: `${OUT}/${vp.name}-${slug}.png`, fullPage: true });
    const all = [...issues, ...runtime.splice(0)];
    total += all.length;
    report.pages.push({ viewport: vp.name, path: route.path, issues: all });
  }
  await context.close();
}
await browser.close();

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
for (const p of report.pages) {
  if (p.issues.length === 0) continue;
  console.log(`\n${p.viewport} ${p.path}`);
  for (const i of p.issues) console.log(`  - [${i.type}] ${i.detail}`);
}
console.log(
  `\n${total} issue(s) across ${report.pages.length} page renders; screenshots in ${OUT}`,
);
process.exit(total > 0 ? 1 : 0);
