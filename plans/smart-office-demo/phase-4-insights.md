# Phase 4 — Insights and asset lifecycle (ladder Level 4)

Status: Not started
Depends on: Phase 3 done. Read [context.md](context.md) §6.2 (aggregates, backfill), §6.5 (backfill filter), §7.

## Context

With live behaviour working, this phase adds history and the analytics that make the business case: cost per
department, standby hunt, AC health that creates a maintenance task on the asset (the moment the two modules
visibly join), laptop fleet health, room utilisation, savings versus baseline and depreciation. It starts with
a **history backfill** so charts and reports have twelve weeks of data on the first demo. The analytics are
product code; only the backfill is dataset tooling.

## Requirements and acceptance criteria

1. **Backfill** (`make backfill TENANT=alpha WEEKS=12`): generates twelve weeks of plausible telemetry for
   every dataset device using the simulator's pure behaviour functions against a synthetic calendar (weekday
   patterns, personas, bookings, weekends, two holidays, sweep active only in the last 4 weeks so savings are
   visible), and writes it with `POST /api/plugins/telemetry/DEVICE/{id}/timeseries/ANY` in batches of ≤1000
   points, hourly for weeks 1–8 and 15-minute for the last 4 (laptops hourly presence). Sends
   `metadata.backfill=true` so the rule chain skips alarms and the events webhook. Also fills
   `room_daily_stat`, `device_nightly_stat`, historical `automation_run` rows for sweeps, and `booking`
   history. Under 10 minutes per tenant; idempotent for a given range (`--purge` deletes the range first).
2. **Cost per department** (`/reports/energy-cost`): open-plan desks carry the employee's department; meeting
   rooms split by booking organiser's department, unallocated to "Shared". Monthly table and stacked chart in
   the tenant currency; CSV export; `FINANCE` sees this report and asset financials and nothing else in Energy.
3. **Standby hunt** (`/energy/standby`): devices with `power_w` between 5 and 80 W for ≥ 6 h between 22:00 and
   06:00 on ≥ 5 of the last 7 nights, ranked with kWh/year and cost/year, "put on switched circuit"
   recommendation and an audited "mark as acceptable" action.
4. **AC health** (asset drawer for AC units, `/energy/ac-health` list, ThingsBoard `ac-health` dashboard):
   runtime hours, current-at-constant-setpoint trend; ThingsBoard alarm "AC current high" →
   `/internal/tb/events` → API creates `maintenance_task` ("Check filter — current +27 % over 14 days") on the
   asset, notifies ops, shows on the drawer and `/maintenance`. Console scenario `ac-filter-degrade {code}`
   accelerates the drift so the alarm fires within ~10 minutes.
5. **Laptop fleet health** (`/assets/fleet`): battery capacity trend per laptop → "replace within 6 months";
   no online time in 30 days → "reclaim"; warranty expiring in 90 days; as register filters and summary tiles.
6. **Room utilisation** (`/rooms/utilisation`): heatmap hour × weekday per room over 12 weeks from
   `room_daily_stat`; utilisation % versus booked %; recommendation when utilisation < 20 % or ghost rate > 30 %.
7. **Savings versus baseline** (`/reports/savings`): per floor, kWh per weekday night (20:00–07:00) for the 8
   weeks before automation versus the 4 weeks after; total saved kWh and cost; the morning report uses these
   measured values when available.
8. **Depreciation** on every asset: straight-line from `purchase_cost`, `useful_life_years`; book value today;
   category totals on the register footer and `/reports/asset-financials`; `/calendar` lists warranty and
   end-of-life dates for the next 90 days.
9. **Scheduled reports**: `report` rows generated monthly (APScheduler) and on demand for energy-cost, savings,
   asset-financials; HTML now, PDF in Phase 5.
10. Tests: allocation rules, standby detection, AC alarm → task, fleet lists, utilisation math, savings
    baseline, depreciation, backfill calendar generation.

## Files

```text
platform/api/src/cli/backfill/{__init__.py, calendar.py, writer.py}   imports platform_common.behaviours
platform/common/platform_common/behaviours/__init__.py      confirm behaviours are pure and MQTT-free
platform/api/src/energy/{allocation.py, standby.py, ac_health.py}
platform/api/src/assets/{fleet.py, depreciation.py}
platform/api/src/rooms/utilisation.py
platform/api/src/reports/{savings.py, financials.py, service.py, router.py}
platform/api/src/maintenance/{router,schemas,service}.py
platform/api/src/assets/calendar_router.py
platform/api/tests/{energy,assets,rooms,reports,maintenance,cli}/
platform/api/alembic/versions/0005_*.py                    device_nightly_stat, standby_acknowledgement
platform/thingsboard/dashboards/ac-health.json
platform/web/app/routes/{_shell.reports.energy-cost,_shell.energy.standby,_shell.energy.ac-health,_shell.maintenance,_shell.assets.fleet,_shell.rooms.utilisation,_shell.reports.savings,_shell.reports.asset-financials,_shell.calendar}.tsx
```

## Steps

1. Confirm behaviours are pure `step()` functions; the backfill steps them per 15-minute slot without MQTT.
2. Backfill: synthetic calendar → per slot compute all device values → batch write per device with
   `metadata.backfill=true` → stats tables from the same loop; progress output; `--weeks`, `--tenant`,
   `--from`, `--purge` flags.
3. Services and routers as listed; aggregates from ThingsBoard (`agg=SUM|AVG`, `interval=900000`) and from
   the stats tables; cache aggregate responses 5 minutes.
4. AC alarm handling: on `ALARM` "AC current high" create a `maintenance_task` if none open for the asset; on
   clear, add a note but keep the task open until a user closes it.
5. Web routes; `FINANCE` navigation limited to Reports → Energy cost and Asset financials.
6. Morning report uses measured savings when available.

## Validation

- After backfill, Energy Overview shows 12 weeks; `/reports/savings` shows a drop in the last 4 weeks;
  utilisation heatmap has weekday patterns and empty weekends.
- `ac-filter-degrade AC-2.3`: within 10 minutes the alarm appears, a task exists on the asset, ops is notified;
  storyline step 5 works.
- `finance@alpha.demo` sees only the two reports; `/assets` with that token → 403.
- Backfill of both tenants under 20 minutes total; re-run with `--purge` produces identical charts.
- No alarms and no notifications were created by the backfill (check `alarm` list and `notification` count).
- `make test` green.

## Risks

- **Volume**: ~130 devices × (8 weeks hourly + 4 weeks 15-minute) × ~4 keys ≈ 2.5 M values per tenant; fine
  for PostgreSQL with ≤1000-point batches written sequentially per device.
- **Rule engine load during backfill**: handled by the `metadata.backfill` filter in the rule chain (Phase 0);
  verify the filter exists before running.

## Rollback

`make backfill ... --purge` deletes the range; stats tables truncated per tenant; schema additive.

## Report

`reports/phase-4-insights.md` with backfill timings and volumes.
