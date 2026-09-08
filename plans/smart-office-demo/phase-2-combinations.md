# Phase 2 — Combinations (ladder Level 2)

Status: Not started
Depends on: Phase 1 done. Read [context.md](context.md) §9, §10.

## Context

Single things have states. Now we cross-reference them: laptops become occupancy sensors, energy is judged
against occupancy, bookings against presence, and the first automation switches a single room off. This phase
introduces the **automation engine** in the API; Phase 3 adds the building-wide automations on the same
engine. The engine is product code: real tenants get the same automations, disabled by default.

## Requirements and acceptance criteria

1. **Occupancy from laptops**: `PresenceService` computes per room `laptops_online` (laptops whose `ap` maps
   to the room, or whose owner's desk is in the room while on the home AP) and `occupied = sensor_occupied or
   laptops_online > 0`. Open-plan areas, which have no sensor, show a head count from laptops. Exposed on
   `/rooms` and drawn on the floor plan.
2. **Wasted energy badge**: a room with `occupied=false` for ≥ 10 min and (`light.state=1` or `ac.state=1`)
   shows a "Wasting" badge with a live counter of wasted kWh since it emptied (integral of room-meter power
   minus 15 W base). Building-level "wasted today" tile on the Energy overview.
3. **Ghost-booking release**: automation `ghost_booking`: active booking, room unoccupied for `grace_minutes`
   → booking `RELEASED`, notification to the organiser, audit row, room shows Free. Console scenario "Ghost
   meeting in room X" creates a booking starting now with `GHOST` attendance so the release can be shown
   quickly after lowering `grace_minutes` on the Automations page.
4. **Per-room auto-off**: automation `room_auto_off`: meeting room unoccupied, no laptops, no booking now,
   for `idle_minutes` → lights, AC, sweepable plugs off via `CommandService` with `source=AUTOMATION`. Floor
   plan dims the room. Never for `critical` rooms.
5. **Misplaced laptop**: laptop online > 8 h cumulative in a room that is neither its owner's desk room nor a
   meeting room → asset flagged `misplaced` with the room; register filter "Exceptions" and asset drawer show
   it; custodian notified. Console scenario "Move laptop X to room Y".
6. **Room panel** (`/rooms/:id/panel`, full-screen route for a tablet outside the room): Free / Busy / Booked,
   next booking, occupancy count, "used X kWh today, AED Y", Release / Extend button for the organiser.
7. **Automations page** (`/automations`, OPS_MANAGER+): list with enabled toggle, params editor (JSON-schema
   form generated from the Pydantic params model), last run summary, "Run now". Runs at `/automations/runs`.
8. Tests: presence derivation, waste integral, ghost release decision, auto-off decision including critical
   exclusion and booking guard, misplaced detection. Decision functions are pure and table-tested.

## Files

```text
platform/api/src/services/automations/{engine,registry,context,params,automations.service}.ts, rules/{ghost-booking,room-auto-off}.rule.ts
platform/api/src/routes/automations/index.ts
platform/api/src/jobs/automations.processor.ts (BullMQ tick, runs in worker)
platform/api/src/services/rooms/{presence.service,waste.service}.ts, platform/api/src/routes/rooms/index.ts (panel data)
platform/api/src/services/assets/misplaced.service.ts
platform/shared/src/dto/automations.ts
platform/api/drizzle/0002_*.sql                           assets.misplaced_room_id, room_daily_stat if not present
platform/simulator/src/scenarios.ts                        ghost-meeting, move-laptop
platform/web/app/routes/{_shell.automations,_shell.automations.runs,rooms.$id.panel}.tsx
platform/web/app/components/{waste-badge,presence-count,params-form}.tsx
```

## Steps

1. **Engine**: BullMQ repeatable job `automations.tick` every minute per tenant plus `runNow(key)`. Each rule
   implements `evaluate(ctx): Decision[]` and the engine applies decisions through `CommandService`. `ctx`
   gives Redis live state, bookings now, presence, params, holds. Every run writes `AutomationRun` with
   decisions and reasons, even when nothing happened. Per-tenant Redis lock so alarm-triggered runs (Phase 3)
   do not race the minute tick.
2. **Presence**: derive from Redis live state; debounce AP changes 60 s; publish `room.presence` on the tenant channel.
3. **Waste**: track `empty_since` per room and integrate meter power; reset when occupied; persist daily totals
   in `RoomDailyStat` (also used in Phase 4).
4. **Rules**: `ghost_booking`, `room_auto_off` per context.md §9. Dataset loader seeds `Automation` rows with
   defaults; in demo mode they are enabled.
5. **Misplaced**: hourly job accumulating presence per (laptop, room); flag and unflag; notify custodian.
6. **Web**: routes and badges; Automations page renders the params form from the rule's Zod schema shared via
   `@platform/shared`.
7. **Console**: ghost meeting, move laptop, run auto-off now.

## Validation

- Storyline step 3 (ghost booking released, Room 1.3 wasting) reproducible from `/console` within two minutes
  after lowering grace minutes.
- Auto-off: empty Room 1.1 with lights on → after `idle_minutes` (set to 1 for the test) lights and AC off,
  `Command` rows with `source=AUTOMATION`, floor plan dims.
- Server room `2.S` never receives a command even when "empty".
- `make test` green.

## Risks

- **Presence flapping**: debounce as above.
- **Waste double counting** of standby loads: subtract room base load.

## Rollback

Disable automations on the Automations page. Schema additive.

## Report

`reports/phase-2-combinations.md`.
