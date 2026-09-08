# Shared context for the platform and its first milestone (Smart Office demo)

Read this before touching any phase. It is the single source of truth for architecture, names, ports, the
dataset model and the ThingsBoard integration contract. If you change any of it, update the Decision log at
the bottom.

## 1. What we are building and why

DCS (UAE systems integrator) wants a multi-tenant IoT asset-management platform. We are building it on
ThingsBoard CE with a Python business layer and a React frontend. The code under `platform/` is the product
foundation: it will run the sales demo first and real tenants later without a rewrite.

Milestone 1 is a demo: our own office as the customer site, **asset management** (laptops, monitors,
projectors, rooms, lights, AC units, meters as one register) plus **energy management** (per-room and per-floor
consumption, control, automation, cost), under **two white-labelled tenants**. The signature scenario is the
**8 PM sweep**: if no laptop is online, no room is occupied and nothing is booked, lights and AC go off room by
room, with a morning report of what was saved.

In the demo every device is simulated. The simulator connects to ThingsBoard over MQTT exactly like real
devices would, so replacing it with real hardware changes nothing in the API or web.

## 2. Architecture

```text
                       ┌──────────────────────────────────────────────────────────────┐
                       │ docker compose (one machine, no internet needed)             │
                       │                                                              │
  browser ──────────▶  │  web (React Router SPA, nginx) ──REST/SSE──▶ api (FastAPI)  │
  alpha.localhost      │        │ iframe                       │   │   │              │
  beta.localhost       │        ▼                              │   │   └──▶ mailpit  │
                       │  thingsboard (tb-postgres image) ◀────┘   │      (emails)   │
                       │     ▲  ▲        │ rule chain              │                  │
                       │     │  │        └──REST call node──▶ api /internal/tb/events │
                       │  MQTT  REST (provision, latest values, RPC, dashboards)      │
                       │     │  │                                  │                  │
                       │  simulator (Python) ◀──HTTP (add device, run scenario)────┘  │
                       │  [or real devices, same MQTT contract]                        │
                       │  postgres (platform business data)                            │
                       └──────────────────────────────────────────────────────────────┘
  scenario console (web route /console, only when DEMO_MODE=true) ──▶ api ──▶ simulator
```

Responsibilities:

| Component | Owns | Does not own |
|-----------|------|--------------|
| **ThingsBoard** | Devices and credentials, telemetry history, device activity (online/offline), alarm rules on device profiles, energy dashboards, RPC delivery to devices | Business entities, people, bookings, automation logic, branding |
| **api** (`platform/api`) | Tenants and branding, users and roles, asset register, employees and custody, rooms and bookings, automation engine, notifications, maintenance tasks, reports and PDFs, audit log, live state cache, SSE to web | Telemetry storage, device transport |
| **simulator** (`platform/simulator`) | One MQTT client per virtual device, behaviour models, persona schedules, scenarios, answering RPC | Any business logic |
| **web** (`platform/web`) | Branded UI per tenant, floor plan, register, rooms, energy pages (embedding ThingsBoard dashboards), notifications, phone view, audit view, scenario console | Direct MQTT or device access |
| **api CLI** (`platform/api/src/cli`, run via `make provision|dataset|backfill`) | `provision`: create a tenant in ThingsBoard and the API (users, profiles, rule chain, dashboards). `dataset`: load a dataset (office world, employees, bookings). `backfill`: generate history for a dataset | Runtime behaviour |
| **mailpit** | Catches emails locally | Real SMTP (configured per deployment) |

Key rule: **the web never talks to ThingsBoard except through the embedded dashboard iframe.** Everything else
goes through the API so RBAC, tenancy and audit are enforced in one place.

## 3. Technology decisions

| Area | Choice | Why |
|------|--------|-----|
| Server language | **Python 3.12**, `uv` per service (each service has its own `pyproject.toml`, lock file and virtualenv; `common` is a path dependency) | Team confidence; one language for API, simulator and the later ML service |
| API | **FastAPI** structured after [zhanymkanov/fastapi-best-practices](https://github.com/zhanymkanov/fastapi-best-practices) (domain modules, see §4 and §11), Pydantic v2 + `pydantic-settings`, SQLAlchemy 2 (async, `asyncpg`), **Alembic** migrations, APScheduler (`AsyncIOScheduler` in-process; move to a worker process when needed), `sse-starlette`, `httpx` for ThingsBoard, PyJWT + `bcrypt`, `structlog`, `jinja2` for emails, Playwright (Python) for PDF, **Typer** CLI inside the package for provisioning, dataset loading and backfill | Typed, fast to build, OpenAPI for free, a known structure agents can follow |
| Simulator | Python, `aiomqtt`, FastAPI control endpoint, deterministic `random.Random(seed)` per device; behaviours live in `common` so the API's backfill can import them | Same language as the API |
| Web | **Brand-new service**: React Router **v8 framework mode**, **SPA mode** (`ssr: false`) served by nginx, TypeScript strict, **Tailwind CSS**, **shadcn/ui**, **lucide-react**, `react-i18next` (en, ar), TanStack Query for live data and mutations alongside route loaders. No relation to ThingsBoard's Angular UI | Requested stack; SPA keeps deployment to static files behind nginx |
| API types in web | `openapi-typescript` + `openapi-fetch` generated from FastAPI's `/openapi.json` into `platform/web/app/api/schema.d.ts`; regenerated by `make types` and checked in | Replaces shared TS models |
| ThingsBoard | `thingsboard/tb-postgres` upstream image, pin the newest **4.x stable** tag on Docker Hub at Phase 0 and record it below. Never a SNAPSHOT | Unmodified platform |
| Tests | `pytest` + `pytest-asyncio` + `respx` (httpx mocking) for Python; Vitest for web units; Playwright (TS) for E2E | |
| Lint/format | `ruff` (lint + format) + `mypy --strict` for Python; ESLint + Prettier for web | |

## 4. Repository layout (`platform/` at repo root)

```text
platform/
  README.md                   how to run, hostnames note, commands
  Makefile                    up, down, logs, provision, dataset, backfill, types, test, e2e, backup, restore
  docker-compose.yml          all services, fixed ports
  .env.example                local credentials and ports
  common/                     python package `platform_common` (path dependency of api and simulator)
    platform_common/{config.py (base settings), tb/{client.py, models.py}, dataset/schema.py, mqtt.py, behaviours/*.py (pure device physics)}
    tests/
  api/                        FastAPI service, layout after fastapi-best-practices
    pyproject.toml, uv.lock, alembic.ini, logging.ini, .env.example
    alembic/{env.py, versions/}
    src/
      main.py                 app factory, routers, middleware, lifespan (scheduler, live cache)
      config.py               global Settings (pydantic-settings)
      database.py             engine, session, Base, tenant-scoping guard
      exceptions.py           base exceptions → RFC 7807 handlers
      pagination.py
      models.py               shared mixins (ids, timestamps, tenant_id)
      scheduler.py            APScheduler setup
      auth/                   router, schemas, models, service, dependencies, config, exceptions, utils
      tenants/                tenant model, branding router, Host → tenant dependency, demo_mode
      users/
      locations/
      assets/
      employees/
      rooms/                  rooms + bookings (+ internal bookings endpoint for the simulator)
      energy/                 dashboards embed, history proxy, standby, ac health, cost allocation
      automations/            engine.py, rules/*.py, params.py, router, models (automation, automation_run, hold)
      commands/               CommandService → ThingsBoard RPC, command model
      notifications/
      maintenance/
      reports/                morning report, savings, financials, pdf, mail
      audit/                  AuditService, audit_log model, router
      live/                   cache, SSE router
      tb_events/              /internal/tb/events receiver
      console/                demo scenario proxy (only when demo_mode)
      cli/                    Typer app: provision, dataset, backfill (uses the same models and session)
      templates/email/*.html
    tests/                    mirrors src/ (tests/auth, tests/assets, …) + conftest.py with tenant fixtures
  simulator/                  python package `src` in its own venv
    pyproject.toml, uv.lock
    src/{main.py, config.py, world.py, registry.py, device.py, mqtt.py, control.py, scenarios.py}
    tests/
  datasets/
    office-demo/
      world.json              the office (building, rooms, devices, coordinates)
      personas.json           employee behaviour profiles
      tenants/alpha.json, beta.json   tenant name, hostname, brand, employees, tariff
      brands/alpha/, beta/    logo.svg, theme.json, fonts/
  thingsboard/
    device-profiles/*.json    one per device type, includes alarm rules
    asset-profiles/*.json
    rule-chain.json           root rule chain export (see §6.5)
    dashboards/*.json         exported dashboards
  web/                        brand-new React Router v8 app (app/routes, app/components/ui from shadcn, app/api generated types)
  e2e/                        Playwright tests (TS)
  deploy/                     nginx.conf, Dockerfiles, later: k8s or systemd notes
```

Do not put platform code anywhere else in the repo. Maven ignores `platform/`. The folder can be renamed to a
product codename later with one find-and-replace; keep the name out of code identifiers.

There is no separate `bootstrap` package: `make provision|dataset|backfill` run `docker compose run --rm api
python -m src.cli <command>`.

## 5. Dataset model (office-demo)

A **dataset** describes everything a tenant is loaded with: locations, devices, people, bookings, brand.
`platform/datasets/office-demo/` is the first dataset. `make dataset TENANT=alpha DATASET=office-demo`
creates it in ThingsBoard and in the API database; the simulator loads the same files to know what to
simulate. Real tenants have no dataset; their devices are registered through the API and connect on their own.

### 5.1 Tenants (fictional; boss may rename)

| Key | Display name | Hostname | Primary colour | Locale default |
|-----|--------------|----------|----------------|----------------|
| `alpha` | Falcon Facilities Group | `alpha.localhost` | deep blue `#0B3D91` | en |
| `beta` | Oasis Retail Holdings | `beta.localhost` | terracotta `#B5451B` | en, RTL demo in ar |

Chromium-based browsers resolve `*.localhost` to 127.0.0.1 without hosts-file edits. Firefox needs
`network.dns.native-is-localhost` or a hosts entry; document this in `platform/README.md`.

### 5.2 Building

Site "HQ" → Building "Main" → Floor 1, Floor 2. Room codes are `F{floor}.{id}`.

| Floor | Rooms | Notes |
|-------|-------|-------|
| 1 | `1.1`–`1.4` meeting rooms (cap 4, 6, 8, 12), `1.O` open plan (12 desks), `1.P` pantry, `1.R` reception | Pantry has fridge and coffee machine plugs |
| 2 | `2.1`–`2.4` meeting rooms, `2.O` open plan (12 desks), `2.S` server room, `2.E` east wing zone label | Server room is `critical: true`, never switched |

Zones (for the late-worker scenario): `1.West` = rooms 1.1, 1.2, west half of 1.O; `1.East`; `2.West`; `2.East`.
Each desk and room has a `zone`. Rooms and desks carry `x, y, w, h` in a 1000×600 viewBox for the floor plan.

### 5.3 Devices per room

| Device type | Where | Telemetry keys | Server attributes | RPC |
|-------------|-------|----------------|-------------------|-----|
| `light` | every room | `state` 0/1, `power_w` | `room`, `zone`, `critical` | `setState {state}` |
| `ac` | every room | `state`, `setpoint_c`, `room_temp_c`, `power_w`, `current_a`, `runtime_h` | `room`, `zone`, `critical`, `nominal_current_a` | `setState {state}`, `setSetpoint {setpoint_c}` |
| `occupancy` | meeting rooms only | `occupied` 0/1, `count` | `room` | — |
| `plug` | projector in each meeting room; fridge, coffee machine in pantry; 6 monitors in open plans | `state`, `power_w`, `energy_kwh` | `room`, `appliance`, `sweepable` | `setState {state}` |
| `room_meter` | every room | `power_w`, `energy_kwh`, `voltage_v`, `pf` | `room`, `night_baseline_w` | — |
| `floor_meter` | per floor | `power_w`, `energy_kwh`, `current_a`, `voltage_v`, `pf` | `floor` | — |
| `laptop` | one per employee | `battery`, `cpu`, `user`, `ap` (access-point id) | `employee_id`, `inactivityTimeout` = 30000 | — |

Access points: one per zone, `ap` value like `AP-1W`. The API maps `ap` → zone → room list; a laptop's room is
the desk room of its owner when on the home AP, otherwise the meeting room the persona is visiting.

Simulated physics (simulator owns these numbers; behaviours are pure functions in `platform_common.behaviours`):

- `light` on: 60 W meeting room, 240 W open plan, 40 W other. `ac` on: 800–1400 W by room size,
  `current_a = power_w / 230 / pf`. One AC unit, `AC-2.3`, has a slowly rising current at constant output for
  the "filter" scenario.
- `room_meter.power_w` = sum of room devices + 15 W base + noise. `floor_meter` = sum of rooms + 600 W core
  load (server room extra 2.5 kW).
- `energy_kwh` is cumulative and monotonic; simulator integrates `power_w` every tick.
- Tick: every 10 s per device, telemetry published with the current real timestamp.

### 5.4 People and personas

24 employees per tenant (12 per floor), each with `desk` (room + zone), `department` (Finance, Sales,
Engineering, Operations), a laptop and a persona from `personas.json`:

| Persona | Arrive | Leave | Meetings | Notes |
|---------|--------|-------|----------|-------|
| `early_bird` | 07:30 | 16:30 | 1 | |
| `standard` | 09:00 | 18:00 | 2 | majority |
| `late_worker` | 10:00 | 21:30 | 1 | keeps a zone on at 20:00 |
| `meeting_heavy` | 09:00 | 18:30 | 4 | moves between rooms |
| `remote_today` | — | — | 0 | laptop stays offline |

Persona schedules drive laptop online/offline and which room the laptop's `ap` reports. Weekday only. The
simulator uses the real clock; scenarios can force persona actions on demand. Employee names come from a
fixed fictional list in the dataset.

### 5.5 Bookings

The API owns bookings (room, start, end, organiser, attendees). The dataset loader creates a realistic week.
The simulator asks the API `GET /internal/bookings/now` each minute to decide which meeting rooms have people,
with per-booking `attendance` (`full`, `late`, `ghost`) so ghost bookings exist on purpose.

## 6. ThingsBoard integration contract

### 6.1 Entity mapping

| Business thing | ThingsBoard entity | Notes |
|----------------|--------------------|-------|
| Tenant | Tenant | One per platform tenant. `provision` logs in as sysadmin to create it |
| API service account | Tenant Admin user `svc-api@<tenant>.<domain>` | The API uses its JWT for all REST calls; refresh handled by `platform_common.tb.TbClient` |
| Dashboard viewer | Tenant Admin user `svc-dashboards@<tenant>.<domain>` | Token passed to the iframe; see §6.6 |
| Site, Building, Floor, Room, Zone | Asset with an `AssetProfile` of the same name | Relation `Contains` from parent to child |
| Every device in §5.3 | Device with a `DeviceProfile` per type | Access token generated per device (dataset devices use `<tenant>-<code>` for reproducibility; real devices get random tokens); `Contains` relation from the Room asset |
| Laptop | Device profile `laptop` | `inactivityTimeout` server attribute 30000 ms so Offline appears in ≤30 s |

Business-only entities (employees, bookings, maintenance tasks, asset financials, audit log) live in the API
database. The API stores `tb_entity_id` on every row that mirrors a ThingsBoard entity.

### 6.2 REST endpoints the API (including its CLI) uses

All under `http://thingsboard:9090` inside compose, `http://localhost:8090` from the host. Wrapped in
`platform_common.tb.TbClient` (httpx, async, typed). Nothing else may call ThingsBoard.

| Purpose | Endpoint |
|---------|----------|
| Login | `POST /api/auth/login` → `{token, refreshToken}`; refresh `POST /api/auth/token` |
| Tenant (sysadmin) | `POST /api/tenant` |
| Tenant user | `POST /api/user?sendActivationMail=false`, then `GET /api/user/{id}/activationLink` and `POST /api/noauth/activate` with `{activateToken, password}` |
| Device / Asset profile | `POST /api/deviceProfile`, `POST /api/assetProfile` |
| Device | `POST /api/device?accessToken=<token>` |
| Asset | `POST /api/asset` |
| Relation | `POST /api/relation` `{from, to, type:"Contains", typeGroup:"COMMON"}` |
| Server attributes | `POST /api/plugins/telemetry/{DEVICE|ASSET}/{id}/attributes/SERVER_SCOPE` |
| Latest telemetry | `GET /api/plugins/telemetry/DEVICE/{id}/values/timeseries?keys=a,b` |
| History / aggregates | same path with `startTs, endTs, interval, agg=AVG|SUM|MAX, limit` |
| Backfill telemetry | `POST /api/plugins/telemetry/DEVICE/{id}/timeseries/ANY` body `[{ts, values:{...}}]` |
| RPC to device | `POST /api/rpc/oneway/{deviceId}` `{method, params}`; `twoway` when a reply matters (timeout 5 s) |
| Alarms | `GET /api/alarm/{entityType}/{entityId}`, `POST /api/alarm/{id}/ack` |
| Rule chain import | `POST /api/ruleChain`, then `POST /api/ruleChain/metadata`, then `POST /api/ruleChain/{id}/root` |
| Dashboard import | `POST /api/dashboard` with the exported JSON |

### 6.3 MQTT contract (devices ↔ ThingsBoard)

Broker `thingsboard:1883` inside compose, `localhost:1884` from the host. Username = device access token.
Real devices follow the same contract.

| Direction | Topic | Payload |
|-----------|-------|---------|
| publish telemetry | `v1/devices/me/telemetry` | `{"ts": <ms>, "values": {...}}` |
| publish client attributes | `v1/devices/me/attributes` | `{"fw": "sim-1.0"}` |
| subscribe RPC | `v1/devices/me/rpc/request/+` | `{"method":"setState","params":{"state":1}}` |
| reply RPC | `v1/devices/me/rpc/response/{requestId}` | `{"ok":true,"state":1}` |

A device is **online** while its MQTT session is connected and publishing; **offline** after
`inactivityTimeout` with no messages. The simulator disconnects a laptop's client to take it offline.

### 6.4 Device profiles and alarm rules (in ThingsBoard, editable live)

| Profile | Alarm rule | Severity | Cleared when |
|---------|-----------|----------|--------------|
| `laptop` | inactivity (activity events routed by the rule chain) | Warning "Asset unreachable" | activity resumes |
| `ac` | `current_a > nominal_current_a * 1.25` for 10 min (dynamic value from server attribute) | Major "AC current high — check filter" | below 1.1× |
| `floor_meter` | `power_w > 75000` for 2 min (building threshold 150 kW is evaluated in the API) | Warning "Peak load" | below |
| `room_meter` | `power_w > night_baseline_w * 2` between 22:00 and 06:00 | Warning "Night anomaly" | below |

The peak threshold is the value changed live during the demo (Phase 5).

### 6.5 Rule chain

One root rule chain, exported to `platform/thingsboard/rule-chain.json`:

```text
Input → Message Type Switch
  Post telemetry → [filter: metadata.backfill != "true"] → Save Timeseries → Device Profile Node
                     → (alarm created/cleared) → REST call "platform events"
                     └────────────────────────────────────▶ REST call "platform events"
  Post telemetry with metadata.backfill == "true" → Save Timeseries only
  Post attributes → Save Attributes
  Activity / Inactivity / Connect / Disconnect events → REST call "platform events"
  RPC request from device → RPC reply (default)
```

`REST call "platform events"` posts to `http://api:8000/internal/tb/events` with header
`X-Internal-Token: ${INTERNAL_API_TOKEN}` and body `{type, originator:{id, type, name}, ts, data, metadata}`.
The API authenticates with the shared token, resolves the tenant from the device's stored `tb_entity_id`,
updates its live-state cache, and ignores telemetry whose `ts` is older than 5 minutes.

### 6.6 Dashboards and embedding

Energy dashboards are built once in the ThingsBoard UI, exported to `platform/thingsboard/dashboards/`, and
imported per tenant by `provision`. The web embeds them in an iframe:
`http://<tb-host>/dashboards/<dashboardId>?accessToken=<jwt>&refreshToken=<jwt>` where the tokens belong to
`svc-dashboards` and are fetched from the API (`GET /energy/dashboards/{key}/embed`). Dashboard settings:
toolbar hidden, no title, no state controller, neutral theme. Fallback if token embedding misbehaves: assign
dashboards to the public customer and use `?publicId=`. ThingsBoard's own UI is never shown outside the iframe.

Dashboard set: `energy-overview`, `floor-drilldown` (state param `floor`), `room-detail` (state param `room`),
`ac-health`. Entity aliases resolve by asset profile and relation so one export works for any tenant.

## 7. API domain model (SQLAlchemy, Alembic-managed)

```text
tenant(id, key, name, hostname, tb_tenant_id, brand jsonb, locale, tariff_per_kwh, currency, demo_mode bool)
user(id, tenant_id, email, password_hash, role: TENANT_ADMIN|OPS_MANAGER|FIELD_OPERATOR|FINANCE|VIEWER, employee_id?)
employee(id, tenant_id, name, department, desk_room_id, zone, persona?, email)
location(id, tenant_id, type: SITE|BUILDING|FLOOR|ROOM|ZONE, code, name, parent_id, tb_asset_id, capacity?, critical, floor, geometry jsonb)
asset(id, tenant_id, code, name, class, type, brand, model, serial, category, location_id, custodian_employee_id?,
      purchase_date, purchase_cost, useful_life_years, warranty_end, status, tb_device_id?, device_type?, meta jsonb)
booking(id, tenant_id, room_id, start, end, organiser_id, title, attendance: FULL|LATE|GHOST, status: ACTIVE|RELEASED|DONE)
automation(id, tenant_id, key, enabled, params jsonb)
automation_run(id, tenant_id, key, started_at, finished_at, summary jsonb)
command(id, tenant_id, asset_id, method, params jsonb, source: USER|AUTOMATION, actor_user_id?, automation_run_id?, result, sent_at)
notification(id, tenant_id, user_id, kind, title, body, actions jsonb, read_at?, acted_at?)
maintenance_task(id, tenant_id, asset_id, title, cause, status, created_from_alarm_id?)
hold(id, tenant_id, scope_type: ZONE|FLOOR|ROOM, scope_id, until, reason)
audit_log(id, tenant_id, actor_type, actor_id, action, entity_type, entity_id, before jsonb, after jsonb, ts, ip)
room_daily_stat(tenant_id, room_id, date, occupied_minutes, booked_minutes, ghost_count, kwh, wasted_kwh)
device_nightly_stat(tenant_id, asset_id, date, avg_night_power_w, hours_above_5w)
report(id, tenant_id, kind, period, generated_at, pdf_path)
```

Every table has `tenant_id`; a SQLAlchemy event asserts every query on tenant tables carries a tenant filter
(test-enforced). Live state (latest telemetry per device, online flag, room occupancy) is an in-memory cache
fed by `/internal/tb/events` and pushed to the web over SSE `GET /live` (tenant-scoped). Rebuilt from
ThingsBoard latest values on startup.

## 8. Simulator design

- Loads the dataset, builds one `VirtualDevice` per device with an `aiomqtt` client and a behaviour.
- Behaviours (`platform_common.behaviours`): pure `step(state, dt, inputs) -> (state, telemetry)` functions per
  device type; a registry holds current `power_w` per device so meters can sum. Same functions are imported by
  the API's `backfill` CLI.
- Real clock. `Scheduler` fires persona events. Deterministic randomness via `random.Random(hash(code))`.
- RPC handler applies state changes and replies; effects appear in the next tick.
- HTTP control API on `:4100` (FastAPI, header `X-Internal-Token`):

| Endpoint | Effect |
|----------|--------|
| `POST /devices` | add a virtual device at runtime `{tenant, code, type, access_token, attrs}` |
| `DELETE /devices/{code}` | remove |
| `POST /scenario/{name}` | `new-laptop-first-boot {code}`, `everyone-leaves`, `late-worker-stays {employee_id}`, `lunch-peak`, `heater-left-on {room}`, `ac-filter-degrade {code}`, `ghost-meeting {room}`, `move-laptop {code, room}` |
| `POST /time/hint` | `{phase: morning|midday|evening|night}` shifts persona schedules so the demo runs at any hour without moving the clock |
| `GET /state` | snapshot for debugging |

## 9. Automation engine (API)

APScheduler job every minute per tenant. Each automation reads the live-state cache and bookings, decides,
issues commands through `CommandService` (which calls ThingsBoard RPC and records `command` and `audit_log`),
and writes an `automation_run`. Manual triggers exist for every automation (`POST /automations/{key}/run`).
Automations are enabled per tenant; a real tenant starts with all disabled.

| Key | Default params | Rule |
|-----|----------------|------|
| `room_auto_off` | `idle_minutes: 15` | meeting room unoccupied, no laptop present for N minutes, no booking now → lights, AC, sweepable plugs off |
| `ghost_booking` | `grace_minutes: 10` | booking started N minutes ago and room unoccupied → booking `RELEASED`, notify organiser |
| `precool` | `lead_minutes: 30` | first booking of the day in a room starts in ≤N min → AC on, setpoint 22 |
| `evening_sweep` | `time: "20:00"`, `grace_minutes: 15` | for each non-critical room: no laptop online in room, no occupancy, no booking within grace → lights and AC off; else skip with reason. Keep the whole zone of any online laptop and notify its owner. Summary saved; morning report at 07:00 |
| `peak_shedding` | `threshold_kw: 150`, `window: "12:00-14:00"`, `order: ["unoccupied_rooms","pantry","open_plan_ac_setpoint+2"]` | building total above threshold → shed in order until below; restore after 10 min below threshold − 10 % |
| `holiday_mode` | `dates: []` | on listed dates: sweep at 00:01, skip pre-cool, only critical rooms on |

Rooms with `critical: true` are never commanded. `VIEWER` and `FINANCE` cannot issue commands or run
automations (403, audited as `DENIED`; the demo shows this on purpose).

## 10. Key event flows

**New employee**: web `POST /employees` → API creates employee, asset (laptop), ThingsBoard device
(`POST /api/device?accessToken=`), server attributes, relation to desk room → if `tenant.demo_mode`, `POST
simulator/devices` → returns. Console button "First boot" → simulator scenario → laptop connects, publishes for
60 s, disconnects → ThingsBoard Inactivity event after 30 s → rule chain → `/internal/tb/events` → API marks
offline, creates notification "Asset unreachable" → SSE → floor plan turns the laptop grey then amber.

**Sweep**: scheduler or console → automation evaluates → for each room to switch: `POST /api/rpc/oneway/{id}`
`setState {state:0}` for light and AC, spaced 300 ms → devices apply → next tick power drops → meters →
telemetry → API cache → SSE → floor plan dims room by room. `automation_run.summary` lists rooms off, skipped
with reasons, and kWh saved (estimated at sweep time, measured later from stats).

**Peak**: console "Lunch peak" → simulator raises loads → floor meters exceed thresholds → ThingsBoard alarm →
events → API runs `peak_shedding` immediately on alarm (not only on the minute) → commands → chart drops.
Viewer clicking "Shed now" gets 403 and a toast.

## 11. Conventions

- Python: type hints everywhere, `mypy --strict`, `ruff` clean, `pytest` for every service function that
  decides something (decision functions are pure and table-tested). Async end to end (FastAPI, SQLAlchemy
  async, httpx, aiomqtt).
- API follows fastapi-best-practices: one folder per domain with `router.py`, `schemas.py`, `models.py`,
  `service.py`, `dependencies.py`, `constants.py`, `exceptions.py`, `utils.py` as needed; cross-module imports
  use explicit module names (`from src.assets import service as assets_service`); routers are thin and call
  services; validation and lookups (e.g. "asset exists and belongs to tenant") are FastAPI dependencies that
  return the object; Pydantic schemas use a shared `BaseSchema` with `from_attributes=True`; settings via
  `pydantic-settings` per module where needed and a global `src/config.py`; async routes only, no blocking
  I/O in async paths (Playwright PDF and bcrypt run in a thread pool); custom exceptions inherit from
  `src/exceptions.py` bases and map to RFC 7807; SQL-first (SQLAlchemy Core/ORM queries, no ORM-side loops for
  aggregates); tests mirror the module tree and use an async client fixture with tenant and role fixtures.
- Every API mutation goes through a service that writes `audit_log` with before/after. Routers never write
  audit rows directly.
- All ThingsBoard access through `platform_common.tb.TbClient`. Nothing else imports httpx for ThingsBoard.
- Tenant resolution: `Host` header → `tenant.hostname` (also `X-Tenant-Key` for the phone view when the
  hostname cannot be used, only if `demo_mode`). Every query scoped by `tenant_id`. Cross-tenant tests are
  mandatory (Phase 5).
- Errors: RFC 7807 problem JSON via a FastAPI exception handler. Never leak ThingsBoard error bodies.
- Web: React Router framework mode routes under `app/routes/`, loaders call the generated `openapi-fetch`
  client, shadcn components under `app/components/ui/`, icons only from `lucide-react`, Tailwind tokens from
  CSS variables set by the branding provider, all strings through i18n.
- Commits: conventional commits, no AI references, no plan or phase identifiers.
- No real people's names in datasets. Env vars documented in `platform/.env.example`; never commit `.env`.
- `DEMO_MODE` (per tenant `demo_mode` and global env) gates: scenario console route, simulator calls,
  `X-Tenant-Key` header. Everything else is production code.

## 12. Ports, hosts, credentials (local)

| Service | Container port | Host port |
|---------|----------------|-----------|
| thingsboard HTTP | 9090 | 8090 |
| thingsboard MQTT | 1883 | 1884 |
| thingsboard internal postgres | 5432 | not exposed |
| postgres (platform) | 5432 | 5434 |
| api (uvicorn) | 8000 | 8000 |
| simulator | 4100 | 4100 |
| web (nginx) | 80 | 8081 |
| web dev (react-router dev) | — | 5173 |
| mailpit UI / SMTP | 8025 / 1025 | 8025 / 1025 |

ThingsBoard sysadmin default `sysadmin@thingsboard.org` / `sysadmin`; `provision` changes it to the value in
`.env`. Dataset tenant users: `admin@`, `ops@`, `field@`, `finance@`, `viewer@` + `<tenant>.demo`, password
from `.env` (`DATASET_USER_PASSWORD`). The local ThingsBoard dev setup (8080, 5433, 1883) is untouched.

## 13. Running and verifying

```bash
cd platform
cp .env.example .env
make up                       # docker compose up -d; waits for ThingsBoard health
make provision TENANT=alpha   # ThingsBoard tenant + users + profiles + rule chain + dashboards + API tenant row
make provision TENANT=beta
make dataset TENANT=alpha DATASET=office-demo    # locations, devices, employees, bookings, automations
make dataset TENANT=beta  DATASET=office-demo
make backfill TENANT=alpha WEEKS=12              # Phase 4+
make types                    # regenerate web/app/api/schema.d.ts from the running API
make test                     # pytest + vitest
make e2e                      # playwright against the running stack
make logs / make down
```

Open `http://alpha.localhost:8081` and `http://beta.localhost:8081`. Scenario console: `/console`
(TENANT_ADMIN, only when the tenant is in demo mode).

## 14. Decision log

| Date | Decision | Why |
|------|----------|-----|
| 2026-09-07 | Milestone scope = asset + energy management, two white-labelled tenants | Boss decision |
| 2026-09-08 | All devices simulated in the demo; no real laptops, Pi, plugs or mobile app | User decision; reliability |
| 2026-09-08 | ThingsBoard unmodified upstream image; business logic outside the JVM | No Java on the team; keeps the upgrade path |
| 2026-09-08 | `platform/` is the product foundation, not a demo folder; demo content is a *dataset*; provisioning is separate from dataset loading; Alembic from day one; `DEMO_MODE` gates demo-only features | User decision: the code may run real tenants |
| 2026-09-08 | Web is a brand-new service: React Router v8 framework mode (SPA), shadcn/ui, Tailwind, lucide-react. No dependency on ThingsBoard's Angular UI | User request |
| 2026-09-08 | Server side in Python: FastAPI API following the fastapi-best-practices layout, Python simulator. **Confirmed by user.** Provision/dataset/backfill CLIs live inside the API package (`src/cli`); pure device behaviours live in `common` | Team confidence in Python; one server language incl. later ML; CLIs share the API's models and session |
| 2026-09-08 | Automations live in the API, not in rule chains; alarm thresholds stay in ThingsBoard device profiles | Easier for the team to build and debug; still shows a live no-code edit in ThingsBoard |
| 2026-09-08 | Real clock only. Scenarios are triggered; history is backfilled with past timestamps and `metadata.backfill=true`; `time/hint` shifts persona schedules | Avoids two-clock bugs; keeps alarms quiet during backfill |
| 2026-09-08 | Telemetry reaches the API by rule-chain REST call node, not polling | Push, one integration path for events and alarms |
| 2026-09-08 | Phone view is a responsive web route | Scope |
| (Phase 0) | Pinned ThingsBoard image tag: **TBD, record here**. Pinned React Router v8 minor version: **TBD** | |
