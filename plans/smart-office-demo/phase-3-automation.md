# Phase 3 — Whole-office automation (ladder Level 3)

Status: Not started
Depends on: Phase 2 done (automation engine, presence, commands). Read [context.md](context.md) §9, §10.

## Context

This phase delivers the signature scenario, the **8 PM sweep**, and its siblings: late-worker zone, pre-cool,
lunch peak shedding, holiday mode and the night anomaly. All run on the Phase 2 engine. The demo must be able
to run "the evening" at any time of day, so every automation has a manual trigger and the simulator has the
`time/hint` and `everyone-leaves` scenarios.

## Requirements and acceptance criteria

1. **Evening sweep** (`evening_sweep`, default 20:00, `grace_minutes` 15): for every non-critical room decide
   `OFF` or `SKIP(reason)` with reasons `laptop_online(<names>)`, `occupied`, `booking_within_grace`,
   `zone_kept_for(<employee>)`, `manual_hold`. Commands lights, AC and sweepable plugs off, spaced 300 ms so
   the floor plan visibly dims room by room. `AutomationRun.summary` =
   `{roomsOff, roomsSkipped:[{room, reason}], estimatedKwhSaved, estimatedCostSaved}`.
2. **Late-worker zone**: any laptop online at sweep time keeps its entire zone on. Its owner receives a
   notification with actions **"Still working"** (creates a `hold` on the zone for 60 min) and **"Leaving
   now"** (runs the sweep for that zone immediately). Shown in `/notifications` and on the phone view route
   `/m` (responsive, large buttons, opened on the presenter's phone).
3. **Morning report**: at 07:00 (and on demand) generate the previous evening's summary: rooms switched, rooms
   skipped and why, kWh and cost saved (estimated at sweep time; **measured** from floor-meter overnight
   consumption versus the 4-week weekday baseline once Phase 4 stats exist). Branded email to `ops@` via
   mailpit and page `/reports/mornings`.
4. **Pre-cool** (`precool`, `lead_minutes` 30): first booking of the day per room → AC on with setpoint 22
   `lead_minutes` before start.
5. **Peak shedding** (`peak_shedding`): building total above `threshold_kw` inside the window → shed in `order`
   until below: unoccupied rooms' AC and lights, then pantry plugs, then open-plan AC setpoint +2 °C.
   Triggered by the ThingsBoard `floor_meter` alarm arriving on `/internal/tb/events` as well as by the minute
   tick. Restore in reverse after 10 min below `threshold − 10 %`. Manual "Shed now" and "Restore" for
   OPS_MANAGER+; VIEWER gets 403 and a toast. State machine `NORMAL → SHEDDING(level) → RECOVERING` persisted.
6. **Holiday mode** (`holiday_mode`, `dates[]`): on listed dates the sweep runs at 00:01 and pre-cool is
   skipped; "Event tonight" override on the Automations page creates a `hold` on one floor until a chosen time.
7. **Night anomaly**: ThingsBoard alarm "Night anomaly" on a room meter → notification listing that room's
   assets sorted by current power so the culprit (a 1500 W plug, the "heater") is first. Console scenario
   `heater-left-on {room}`.
8. **Console** gains: Everyone leaves, Late worker stays (pick employee), Run evening sweep now, Lunch peak,
   Heater left on in room …, Generate morning report now, Time hint.
9. Tests: sweep decision table (each reason), zone keeping, hold/snooze, shedding order and restore, holiday
   date handling, anomaly culprit ordering.

## Files

```text
platform/api/src/services/automations/rules/{evening-sweep,precool,peak-shedding,holiday-mode}.rule.ts
platform/api/src/services/locations/zones.service.ts
platform/api/src/services/notifications/notification-actions.service.ts, platform/api/src/routes/notifications/index.ts (act endpoint)
platform/api/src/services/reports/{morning-report.service,baseline.service,mail.service}.ts, platform/api/src/routes/reports/index.ts
platform/api/src/jobs/{reports.processor.ts (07:00 morning report), outbound.processor.ts}
platform/api/src/templates/email/{Base.tsx, MorningReport.tsx}   react-email, branded from Tenant.brand
platform/api/src/routes/console/index.ts                    more scenarios
platform/shared/src/dto/{reports,notifications}.ts
platform/api/drizzle/0003_*.sql                           report kind MORNING, holds if not present
platform/simulator/src/scenarios.ts                        everyone-leaves, late-worker-stays, lunch-peak, heater-left-on, time/hint
platform/web/app/routes/{m,_shell.reports.mornings,_shell.automations (event override)}.tsx
platform/web/app/components/{sweep-wave,shed-panel}.tsx
```

## Steps

1. **Sweep rule**: pure decision function unit-tested with a table of room states. Sequential apply with
   delay in the engine. Save summary; publish `automation.run` on the tenant channel so the floor plan can animate.
2. **Zone keeping**: `ZoneService.rooms_in_zone`, `laptops_online_by_zone`; sweep keeps zones; notification
   actions stored as `[{key:"snooze", label}, {key:"leave", label}]`; `POST /notifications/{id}/act {key}` →
   snooze creates a `hold`; leave runs the sweep for that zone now.
3. **Peak**: the events handler enqueues an immediate `automations.run` job for `peak_shedding` on
   `ALARM floor_meter Peak load`; the processor runs it under the tenant lock.
4. **Pre-cool and holiday**: straightforward rules; override creates a `hold`.
5. **Morning report**: BullMQ repeatable job at 07:00 per tenant + `POST /reports/morning/run`; react-email
   HTML with brand; `nodemailer` to mailpit (SMTP settings per deployment); store `Report`; page lists them;
   PDF in Phase 5.
6. **Simulator scenarios**: `everyone-leaves` sets all personas to left-for-today except a given late worker;
   `lunch-peak` forces all AC to max and pantry plugs on for 10 min; `heater-left-on` adds 1500 W to a plug in
   the room; `time/hint evening` shifts persona schedules so "now" behaves like 19:45.
7. **Phone view**: `/m` shows the logged-in user's notifications with action buttons over WebSocket; works on a phone
   browser pointed at the demo box. Because `*.localhost` does not resolve on a phone, the API accepts
   `X-Tenant-Key` (sent by the web when the URL has `?tenant=alpha`) only for tenants in demo mode; document in
   the runbook.
8. **Console**: buttons above.

## Validation

- From `/console`: Time hint evening → Everyone leaves → Late worker stays <employee> → Run evening sweep now.
  Expected: all non-critical rooms off except that employee's zone; skip reasons listed; the notification
  appears on `/m`; tapping "Leaving now" darkens the zone; `2.S` untouched; audit rows for every command with
  `source=AUTOMATION` and the run id.
- Lunch peak → alarm within 2 min → shedding commands in order → chart drops → auto restore later.
- Morning report email in mailpit with the tenant brand.
- Heater scenario → alarm → notification lists the plug first.
- `make test` green.

## Risks

- **Sweep at real 20:00 during development** may switch things off while someone is testing: `evening_sweep`
  is disabled unless the tenant is in demo mode, and the dataset loader enables it only with `--demo`.
- **Estimated savings** can look implausible: cap at current room power × hours to 07:00 and label
  "estimated" until measured values exist.

## Rollback

Disable the four automations; delete `hold` rows; schema additive.

## Report

`reports/phase-3-automation.md`, including the sweep's skip reasons as exercised.
