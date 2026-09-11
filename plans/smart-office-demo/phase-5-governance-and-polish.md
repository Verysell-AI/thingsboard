# Phase 5 — Governance, white-label polish, rehearsal (ladder Level 5)

Status: Done (2026-09-10), see [reports/phase-5-governance-and-polish.md](reports/phase-5-governance-and-polish.md)
Depends on: Phase 4 done. Read [context.md](context.md) §1, §6.4, §11, §12 and the storyline in
docs/demo/demo-plan.md.

## Context

Everything works for tenant alpha. This phase makes the platform look and behave like a product: two brands
that are truly separate, roles that visibly refuse, an audit view, the live rule edit, Arabic RTL, branded
PDFs and emails, an offline run, an end-to-end smoke test and a rehearsed script. Nothing new in the domain.

## Requirements and acceptance criteria

1. **Two tenants, fully branded**: hostnames, logos, favicons, colours, fonts (bundled in the brand folder, no
   CDN), page titles, email templates, PDF headers and footers, login background. Searching rendered HTML,
   emails and PDFs for "ThingsBoard" or "Verysell" finds nothing. Embedded dashboards use a neutral ThingsBoard
   theme with toolbar hidden; the iframe container carries the brand. Tenant gamma (no dataset) gets the
   neutral default brand and is equally clean.
2. **Cross-tenant isolation tests**: automated tests log in to alpha and request every beta id discovered via
   the beta API (assets, rooms, bookings, reports, notifications, WebSocket) and assert 404; the WebSocket feed carries
   only alpha device codes. Same in reverse.
3. **RBAC matrix** enforced and tested per route: TENANT_ADMIN all; OPS_MANAGER all except users, branding and
   console; FIELD_OPERATOR read + commands on assets on their floor + bookings; FINANCE reports only; VIEWER
   read only. UI hides or disables what the role cannot do, API returns 403, every 403 writes an `AuditLog`
   row with action `DENIED`.
4. **Audit view** (`/audit`, TENANT_ADMIN and OPS_MANAGER): filterable table (actor, action, entity, date),
   before/after diff viewer, CSV export; commands, automation decisions, booking changes, asset changes, logins
   and denials are all present.
5. **Live rule edit**: presenter opens the ThingsBoard UI (separate browser profile, `svc-dashboards`) and
   changes the `floor_meter` peak threshold in the device profile alarm rule from 75 000 W to 60 000 W; the
   next "Lunch peak" fires earlier. Exact clicks in the runbook. Also change `evening_sweep.time` in
   `/automations` as the no-code edit inside our product.
6. **Arabic RTL**: `react-i18next` with `en` and `ar` bundles for all UI strings (machine translation is
   acceptable, reviewed for the ~40 strings visible in the storyline), `dir="rtl"` switching, mirrored layout
   using Tailwind logical properties, `Intl` formatting with `ar-AE`. Language toggle in the user menu; beta
   defaults to `ar` when `?lang=ar`.
7. **Branded PDFs**: Playwright (Node) in the API container renders `/print/reports/{kind}/{id}` (print
   stylesheet) to PDF for the morning report, energy cost, savings, asset financials and asset register export;
   downloadable and attached to the monthly report email.
8. **Offline run**: runbook step to disable the host's network; the whole storyline passes. A Playwright
   request-log test asserts only `*.localhost` and `localhost:8090` are contacted. Fonts bundled, no map
   tiles, no CDN scripts.
9. **Playwright smoke** (`platform/e2e`): login both tenants, floor plan renders with live dots, new employee
   flow, run sweep and assert rooms dim and the run summary appears, viewer refusal toast, brand switch, RTL
   toggle. `make e2e` against the compose stack.
10. **Runbook** `docs/demo/runbook.md`: pre-demo checklist (down, up, provision, dataset, backfill, time
    machine reset to real time,
    browser profiles, phone on Wi-Fi with `?tenant=`), the ten-minute script with exact clicks and expected
    results, recovery steps (restart simulator, reload one tenant's dataset, restart ThingsBoard), and likely
    DCS questions with our answers (on-prem, white-label, RBAC, ERP path, ThingsBoard base, real devices).
11. **Backup and restore**: `make backup` dumps both databases and ThingsBoard volumes to a tarball;
    `make restore FILE=...` restores; shown once in the script.

## Files

```text
platform/web/app/i18n/{en.json, ar.json, index.ts}, app/styles/rtl.css
platform/web/app/routes/{_shell.audit, print.reports.$kind.$id}.tsx
platform/datasets/office-demo/brands/*/fonts/*, email/*, login-bg.*
platform/api/src/services/reports/{pdf.service,export.service}.ts, platform/api/src/routes/print/index.ts
platform/api/src/routes/audit/index.ts
platform/api/src/cli/backup.ts
platform/api/src/hooks/rbac.matrix.ts                      single matrix table routeKey → roles, applied by the requireRole hook
platform/api/test/{tenant-isolation.test.ts, rbac.test.ts}
platform/e2e/tests/{smoke.spec.ts, offline-requests.spec.ts, brand-audit.spec.ts}
platform/Makefile                                          backup, restore
docs/demo/runbook.md
```

## Steps

1. RBAC matrix as one table in `src/hooks/rbac.matrix.ts`; the `requireRole` hook applies it; `DENIED`
   audit; tests iterate the table.
2. Isolation tests: a "discover all ids" helper built from the API itself so the test does not go stale.
3. Audit route with diff viewer and CSV export.
4. i18n extraction (build fails on untranslated keys), RTL stylesheet, `dir` on `<html>`, logical properties.
5. Print routes and the Playwright PDF service (official Playwright Node base image for the API container);
   attach to emails; add downloads to report pages.
6. Brand audit test: fetch each page, email and PDF and grep forbidden words.
7. Offline request audit test; bundle fonts; confirm the ThingsBoard iframe loads no external assets.
8. Runbook and backup/restore targets; rehearse the script three times, fix what breaks, record timings.

## Validation

- Full storyline from docs/demo/demo-plan.md executed twice (alpha, beta) with the network disabled, within
  twelve minutes, using only the browser and the phone.
- `make e2e` green against a freshly provisioned, dataset-loaded and backfilled stack.
- Brand audit finds no forbidden words. Isolation and RBAC tests green.
- Tenant gamma still works and is empty.

## Risks

- **ThingsBoard iframe session collision** with the live-rule-edit tab: two browser profiles (runbook).
- **Playwright in the API image** adds ~400 MB; acceptable; use the official Playwright Node base image.
- **Arabic layout bugs** in third-party components: limit RTL demo to storyline pages and note known issues.

## Rollback

All additive. Language defaults to `en`; PDFs optional.

## Report

`reports/phase-5-governance-and-polish.md` and the completed `docs/demo/runbook.md`. Then update README.md
status to Done and close the plan.
