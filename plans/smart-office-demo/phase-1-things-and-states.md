# Phase 1 — Things and states (ladder Levels 0–1)

Status: Not started
Depends on: Phase 0 done. Read [context.md](context.md) §5, §6, §7, §10.

## Context

The stack runs and tenants exist. This phase makes the office visible: a floor-plan digital twin, the asset
register, live laptop states, the new-employee flow, meeting rooms with bookings, light and AC control from
the asset record, and the first energy dashboards. Everything here is a single thing with a state; no
cross-referencing yet (that is Phase 2). All of it is product code; only the dataset loader and scenarios are
demo-specific.

## Requirements and acceptance criteria

1. **Floor plan** (`/floors/:floor`): SVG per floor from `location.geometry`. Rooms coloured by state with
   badges for lights on and AC on; laptops drawn as dots on desks and in meeting rooms, green online, grey
   offline, amber Warning. Clicking anything opens its asset drawer. Updates live via SSE within 2 s.
2. **Asset register** (`/assets`): table with search, filters (class, type, floor, room, custodian, status),
   BRD asset-master columns (code, name, class/type/brand/model, serial, location, custodian, purchase date and
   cost, warranty end, status, live state). Detail drawer: attributes, live telemetry, 24 h history chart
   (API proxy of ThingsBoard history), custody, **Actions** panel, Audit tab.
3. **New employee** (`/employees/new`): form (name, department, desk room, persona when demo mode) → creates
   employee, laptop asset, ThingsBoard device, and (demo mode) simulator device (context.md §10), with
   compensation on failure. Success view has "First boot" (demo mode) → laptop online 60 s then offline →
   notification "Asset unreachable: LAPTOP-xxx" in the bell; floor-plan dot grey then amber. Audit rows exist.
4. **Rooms** (`/rooms`): list and detail; today's bookings timeline; status Free / Busy / Booked. Create and
   cancel booking. Dataset week exists with `FULL`, `LATE`, `GHOST` attendance and the simulator honours it.
5. **Control from the asset record**: light and AC drawers have on/off switches and AC setpoint; plugs have
   on/off. Through `CommandService`; the room meter chart reacts within one tick. `VIEWER` and `FINANCE` see
   the switches disabled with a tooltip and get 403 (audited `DENIED`) from the API.
6. **Energy** (`/energy`): tabs Overview, Floors, Rooms embedding ThingsBoard dashboards `energy-overview`,
   `floor-drilldown`, `room-detail` per context.md §6.6 inside the branded shell, no ThingsBoard chrome.
   Dashboards show building kW now, kWh today/week/month, cost at the tenant tariff, top 5 consumers,
   per-floor and per-room 15-minute trends, power factor.
7. **Projector inference**: a projector plug above 20 W marks the projector asset "In use" on the floor plan
   and in the register, although the projector has no device of its own.
8. Tests: room status derivation, projector inference, new-employee service (TbClient and simulator mocked),
   RBAC on command routes.

## Files

```text
platform/datasets/office-demo/world.json                  confirm geometry per room and desk (Track A)
platform/thingsboard/dashboards/{energy-overview,floor-drilldown,room-detail}.json   (Track A)
platform/api/src/cli/{dataset.py (bookings week), provision.py (dashboard ids → tenant.brand.dashboards)}
platform/simulator/src/bookings.py, platform/common/platform_common/behaviours/occupancy.py   poll API bookings; occupancy follows attendance
platform/api/src/{locations,assets,employees,rooms,energy,notifications}/{router,schemas,service,dependencies}.py
platform/api/src/rooms/internal_router.py               GET /internal/bookings/now for the simulator
platform/api/src/energy/history.py                       ThingsBoard history proxy with aggregation and caching
platform/api/tests/{locations,assets,employees,rooms,energy,notifications}/
platform/api/alembic/versions/0002_*.py                   only if columns are missing
platform/web/app/routes/{_shell.floors.$floor,_shell.assets,_shell.assets.$id,_shell.employees.new,_shell.rooms,_shell.rooms.$id,_shell.energy,_shell.notifications}.tsx
platform/web/app/components/{floor-plan-svg,live-badge,asset-actions,booking-timeline,tb-dashboard-frame}.tsx
```

Tracks: **A** dataset geometry + dashboards + CLI; **B** simulator bookings/occupancy; **C** API routers
and services; **D** web routes. C publishes response models first, D regenerates types with `make types`.

## Steps

1. **Geometry**: grid layout per floor (rooms as rectangles, desks as points), viewBox 1000×600, validated by
   the dataset schema.
2. **Dashboards**: build the three dashboards in the ThingsBoard UI of tenant alpha with entity aliases that
   resolve by asset profile and relation (Floor → Rooms → devices) so one export works for any tenant. Hide
   toolbar, neutral theme. Export, commit, import in `provision`; store returned ids on the tenant row so
   `GET /energy/dashboards/{key}/embed` can build the iframe URL with the `svc-dashboards` token.
3. **Bookings**: dataset loader creates a week per tenant: 2–5 bookings per meeting room per weekday, 15 %
   `GHOST`, 20 % `LATE`. Simulator polls `/internal/bookings/now` every 60 s; occupancy sets `occupied=1,
   count=n` for `FULL` from start, from start+12 min for `LATE`, never for `GHOST`; also occupied when a
   `meeting_heavy` persona's laptop is in the room.
4. **API**: routers and services above. `HistoryService` proxies ThingsBoard `values/timeseries` with `agg`,
   caps ranges, caches 30 s. `NotificationService.create()` + `GET /notifications` + `POST /{id}/read`.
   New-employee flow as one service method with compensation.
5. **Web**: routes above using loaders for initial data and TanStack Query for mutations and live refresh.
   `TbDashboardFrame` fetches the embed URL and renders the iframe with a placeholder while loading. Asset
   drawer tabs: Overview, Live, History, Custody, Actions, Audit.
6. **Console additions**: laptop picker for "First boot", "Ghost meeting in room …" (used in Phase 2),
   time hint.

## Validation

- Storyline steps 1 and 2 (morning floor plan, new employee) from docs/demo/demo-plan.md using only the
  browser.
- Toggle `AC-1.2` from the drawer; ThingsBoard shows `state` change within 10 s; room meter chart drops by
  roughly the AC's power.
- Log in as `viewer@alpha.demo`: switches disabled; `curl` the command endpoint with the viewer token → 403 and
  an `audit_log` row with action `DENIED`.
- Tenants see only their own rooms and assets; gamma (no dataset) shows empty lists, no errors.
- `make test` green; `make types` no diff.

## Risks

- **Iframe token embedding** may log the iframe's ThingsBoard session into the same origin as a ThingsBoard
  UI tab used for the live rule edit in Phase 5; use a separate browser profile for that tab, or fall back to
  public dashboards (context.md §6.6).
- **Dashboard entity aliases** must not hard-code ids; test by importing into beta.
- **SSE volume**: ~130 devices every 10 s is fine; batch frames per 500 ms anyway.

## Rollback

Routes are additive. `make dataset --reset` restores data.

## Report

`reports/phase-1-things-and-states.md`: dashboard id handling, deviations, Phase 2 notes.
