# Shared context for the platform and its first milestone (Smart Office demo)

Read this before touching any phase. It is the single source of truth for architecture, names, ports, the
dataset model and the ThingsBoard integration contract. If you change any of it, update the Decision log at
the bottom.

## 1. What we are building and why

DCS (UAE systems integrator) wants a multi-tenant IoT asset-management platform. We are building it on
ThingsBoard CE with a **Node.js business layer** and a React frontend, matching the stack DCS's own BRD
describes (Node.js core, Redis pub/sub for the real-time feed, Python FastAPI only for the ML forecasting
service). The code under `platform/` is the product foundation: it will run the sales demo first and real
tenants later without a rewrite.

Milestone 1 is a demo: our own office as the customer site, **asset management** (laptops, monitors,
projectors, rooms, lights, AC units, meters as one register) plus **energy management** (per-room and per-floor
consumption, control, automation, cost), under **two white-labelled tenants**. The signature scenario is the
**8 PM sweep**: if no laptop is online, no room is occupied and nothing is booked, lights and AC go off room by
room, with a morning report of what was saved.

In the demo every device is simulated. The simulator connects to ThingsBoard over MQTT exactly like real
devices would, so replacing it with real hardware changes nothing in the API or web.

## 2. Architecture

```text
                       ┌────────────────────────────────────────────────────────────────┐
                       │ docker compose (one machine, no internet needed)               │
                       │                                                                │
  browser ──────────▶  │  web (React Router SPA, nginx) ──REST + WebSocket──▶ api (Fastify)│
  alpha.localhost      │        │ iframe                            │   │   │            │
  beta.localhost       │        ▼                                   │   │   └──▶ mailpit│
                       │  thingsboard (tb-postgres image) ◀─────────┘   │               │
                       │     ▲  ▲        │ rule chain                   ▼               │
                       │     │  │        └──REST call node──▶ api /internal/tb/events   │
                       │  MQTT  REST (provision, latest values, RPC, dashboards)        │
                       │     │  │                                       │               │
                       │  simulator (Node) ◀──HTTP (add device, run scenario)──────────┘│
                       │  [or real devices, same MQTT contract]                          │
                       │                                                                │
                       │  redis (live-state cache, pub/sub fan-out, BullMQ jobs, replay) │
                       │  postgres (platform business data, Drizzle + RLS)               │
                       │  ml (Python FastAPI, later: forecasting, anomaly detection)      │
                       └────────────────────────────────────────────────────────────────┘
  scenario console (web route /console, only for tenants in demo mode) ──▶ api ──▶ simulator
```

Responsibilities:

| Component | Owns | Does not own |
|-----------|------|--------------|
| **ThingsBoard** | Devices and credentials, telemetry history, device activity (online/offline), alarm rules on device profiles, energy dashboards, RPC delivery to devices | Business entities, people, bookings, automation logic, branding |
| **api** (`platform/api`, Fastify) | Tenants and branding, users and roles, asset register, employees and custody, rooms and bookings, automation engine, notifications, maintenance tasks, reports and PDFs, audit log, live state, WebSocket feed to web, CLI for provisioning/dataset/backfill | Telemetry storage, device transport |
| **redis** | Live-state cache shared by API replicas, pub/sub fan-out of events to WebSocket gateways, 60-second replay buffer (Redis Streams), BullMQ queues for scheduled and retried jobs | Durable business data |
| **simulator** (`platform/simulator`, Node) | One MQTT client per virtual device, behaviour models, persona schedules, scenarios, answering RPC | Any business logic |
| **web** (`platform/web`) | Branded UI per tenant, floor plan, register, rooms, energy pages (embedding ThingsBoard dashboards), notifications, phone view, audit view, scenario console | Direct MQTT or device access |
| **ml** (`platform/ml`, Python FastAPI, later phases) | Demand/energy forecasting, anomaly baselines, called by the API over HTTP | Anything else |
| **mailpit** | Catches emails locally | Real SMTP (configured per deployment) |

Key rule: **the web never talks to ThingsBoard except through the embedded dashboard iframe.** Everything else
goes through the API so RBAC, tenancy and audit are enforced in one place.

## 3. Technology decisions

| Area | Choice | Why |
|------|--------|-----|
| Language and workspace | **Node.js 22 LTS, TypeScript strict, pnpm workspaces** (`shared`, `api`, `simulator`, `web`, `e2e`); Python only in `ml/` | Matches the BRD's Node.js core; one language across API, simulator and web with shared types |
| API framework | **Plain Fastify 5, scaffolded with `fastify-cli` (`fastify generate --lang=ts`)** and kept in its conventions: `@fastify/autoload` for `src/plugins/` and `src/routes/`, route prefixes from folder names, `src/app.ts` exports the root plugin, `fastify start` runs the server. Added: `fastify-type-provider-zod` for validation and `@fastify/swagger` + `@fastify/swagger-ui` for OpenAPI from the same Zod schemas, `@fastify/request-context` (AsyncLocalStorage) for tenant/user/request id, `preHandler` hooks as guards, a `services` plugin that builds a typed container and decorates the instance (no decorator DI), Socket.IO attached to the Fastify server with `@socket.io/redis-adapter`, BullMQ with a separate worker entry point, `commander` CLI | The official scaffold is the structure engineers already know; plain `async/await` end to end; no request-scope or RxJS pitfalls |
| Data | **Drizzle ORM** with PostgreSQL 16 (`node-postgres` driver): schema written in TypeScript (`src/db/schema/*.ts`, one file per domain, no DSL file), `drizzle-kit generate` produces SQL migrations from the first table and `drizzle-kit migrate` applies them; **Postgres row-level security** on every tenant table with policies declared in the schema via `pgPolicy`; `drizzle-zod` derives insert/select Zod schemas for internal validation, while API DTOs stay hand-written in `@platform/shared` | No schema DSL; SQL-like queries; RLS makes tenant isolation a database guarantee, which also lets us answer the BRD's "row-level security" requirement literally |
| Redis | **Redis 7** (or Valkey): `ioredis`; keys for live state, pub/sub channels per tenant, Streams for the replay buffer, **BullMQ** for scheduled jobs (automations every minute, morning report, monthly reports) and retried outbound calls (webhooks, mock ERP) | The BRD's Redis pub/sub, plus a proper job queue instead of in-process cron |
| Real-time feed | **WebSocket (Socket.IO)** from API to web, subscriptions by tenant, device, room or event type; replay of the last 60 s on reconnect from Redis Streams | BRD Module 3 requirement; SSE dropped |
| Shared package | `@platform/shared`: Zod schemas for DTOs, dataset schema, MQTT/RPC contract constants, pure device behaviours (used by simulator and backfill) | One definition for API, web and simulator |
| Simulator | Node, `mqtt` package, deterministic `seedrandom` per device, Fastify control endpoint | Same language; behaviours from `shared` |
| Web | **Brand-new service**: React Router **v8 framework mode**, **SPA mode** (`ssr: false`) served by nginx, TypeScript strict, **Tailwind CSS**, **shadcn/ui**, **lucide-react**, `react-i18next` (en, ar), TanStack Query alongside route loaders, `socket.io-client` | Requested stack; no relation to ThingsBoard's Angular UI |
| PDF and email | Playwright (Node) rendering print routes to PDF inside the API container; `nodemailer` + `react-email` templates branded per tenant | One template set for screen and PDF |
| Auth | `@fastify/jwt` access + refresh tokens, `bcrypt`, `requireRole` hook, tenant resolution by `Host` | |
| ThingsBoard | `thingsboard/tb-postgres` upstream image, pin the newest **4.x stable** tag on Docker Hub at Phase 0 and record it below. Never a SNAPSHOT | Unmodified platform |
| Tests | Vitest everywhere (`shared`, `api`, `simulator`, `web`); API integration tests use `app.inject()` against a test database; Playwright for browser E2E | |
| Lint/format | ESLint (typescript-eslint) + Prettier, shared config at the workspace root | |

## 4. Repository layout (`platform/` at repo root)

```text
platform/
  README.md                   how to run, hostnames note, commands
  Makefile                    up, down, logs, provision, dataset, backfill, test, e2e, backup, restore
  docker-compose.yml          all services, fixed ports
  .env.example                local credentials and ports
  package.json, pnpm-workspace.yaml, tsconfig.base.json, eslint.config.js, .prettierrc, .nvmrc
  shared/                     @platform/shared
    src/{dataset/schema.ts, dto/*.ts (zod), contracts/{mqtt.ts, rpc.ts, events.ts}, behaviours/*.ts, roles.ts}
  api/                        Fastify service scaffolded by fastify-cli (entry points: fastify start, worker, cli)
    drizzle.config.ts, drizzle/ (generated SQL migrations + meta)
    src/
      app.ts                  root plugin (generated): autoloads plugins/ then routes/; the only thing `fastify start` needs
      worker.ts               BullMQ workers only (same image, `node dist/worker.js`); builds the services container without HTTP
      cli.ts                  commander: provision, dataset, backfill, backup; same container
      config.ts               zod-validated env → typed config
      container.ts            buildContainer(config): constructs services with their dependencies (db, Redis, TbClient, …); typed, no DI framework
      db/                     schema/*.ts (drizzle tables, enums, relations, pgPolicy per tenant table), index.ts (pool + drizzle instance), tenant.ts (withTenant helper)
      plugins/                autoloaded, one file each: config, db (drizzle + withTenant), redis, request-context, auth (jwt), tenant (Host → tenant), swagger, error-handler (problem+json), services (decorates fastify.services from container.ts), live (Socket.IO + redis adapter)
      hooks/                  preHandler guards: requireAuth, requireRole(roles), requireInternalToken, requireDemoMode
      routes/                 autoloaded, prefix = folder path; thin handlers calling fastify.services
        health/  auth/  me/  branding/  locations/  assets/  employees/  rooms/  bookings/  energy/  automations/
        notifications/  maintenance/  reports/  audit/  console/  internal/tb-events/  internal/bookings/
      services/               one folder per domain: <domain>.service.ts (+ <domain>.test.ts); schemas come from @platform/shared/dto
        auth/  tenants/  users/  locations/  assets/  employees/  rooms/  energy/  automations/ (engine, rules/)  commands/
        notifications/  maintenance/  reports/  audit/  live/ (live state, replay)  tb/ (TbClient, events handler)  console/
      jobs/                   BullMQ queue definitions and processors (automations tick, reports, outbound retry)
      templates/email/        react-email components
    test/                     integration tests with app.inject() (isolation, rbac); unit tests live beside services
  simulator/                  Node service
    src/{main.ts, config.ts, world.ts, registry.ts, device.ts, mqtt.ts, control.ts, scenarios.ts}
  web/                        React Router v8 app (app/routes, app/components/ui from shadcn)
  e2e/                        Playwright tests
  ml/                         Python FastAPI (later phases): forecasting, anomaly baselines
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
  deploy/                     nginx.conf, Dockerfiles, later: k8s or systemd notes
```

Do not put platform code anywhere else in the repo. Maven ignores `platform/`. The folder can be renamed to a
product codename later with one find-and-replace; package scope `@platform/*` can stay.

`make provision|dataset|backfill` run `docker compose run --rm api node dist/cli.js <command> ...`. The
`worker` compose service runs `node dist/worker.js` from the same image.

## 5. Dataset model (office-demo)

A **dataset** describes everything a tenant is loaded with: locations, devices, people, bookings, brand.
`platform/datasets/office-demo/` is the first dataset. `make dataset TENANT=alpha DATASET=office-demo` creates
it in ThingsBoard and in the API database; the simulator loads the same files to know what to simulate. Real
tenants have no dataset; their devices are registered through the API and connect on their own.

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

Simulated physics (behaviours are pure functions in `@platform/shared/behaviours`, used by the simulator and
the backfill):

- `light` on: 60 W meeting room, 240 W open plan, 40 W other. `ac` on: 800–1400 W by room size,
  `current_a = power_w / 230 / pf`. One AC unit, `AC-2.3`, has a slowly rising current at constant output for
  the "filter" scenario.
- `room_meter.power_w` = sum of room devices + 15 W base + noise. `floor_meter` = sum of rooms + 600 W core
  load (server room extra 2.5 kW).
- `energy_kwh` is cumulative and monotonic; the simulator integrates `power_w` every tick.
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
| API service account | Tenant Admin user `svc-api@<tenant>.<domain>` | The API uses its JWT for all REST calls; refresh handled by `TbClient` |
| Dashboard viewer | Tenant Admin user `svc-dashboards@<tenant>.<domain>` | Token passed to the iframe; see §6.6 |
| Site, Building, Floor, Room, Zone | Asset with an `AssetProfile` of the same name | Relation `Contains` from parent to child |
| Every device in §5.3 | Device with a `DeviceProfile` per type | Access token generated per device (dataset devices use `<tenant>-<code>` for reproducibility; real devices get random tokens); `Contains` relation from the Room asset |
| Laptop | Device profile `laptop` | `inactivityTimeout` server attribute 30000 ms so Offline appears in ≤30 s |

Business-only entities (employees, bookings, maintenance tasks, asset financials, audit log) live in the API
database. The API stores `tbEntityId` on every row that mirrors a ThingsBoard entity.

### 6.2 REST endpoints the API (including its CLI) uses

All under `http://thingsboard:9090` inside compose, `http://localhost:8090` from the host. Wrapped in
`modules/tb/tb.client.ts` (typed, `undici`/`fetch`, token refresh). Nothing else may call ThingsBoard.

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

`REST call "platform events"` posts to `http://api:4000/internal/tb/events` with header
`X-Internal-Token: ${INTERNAL_API_TOKEN}` and body `{type, originator:{id, type, name}, ts, data, metadata}`.
The API authenticates with the shared token, resolves the tenant from the device's stored `tbEntityId`,
updates live state in Redis, publishes the event on the tenant's Redis channel and appends it to the tenant's
replay stream, and ignores telemetry whose `ts` is older than 5 minutes.

### 6.6 Dashboards and embedding

Energy dashboards are built once in the ThingsBoard UI, exported to `platform/thingsboard/dashboards/`, and
imported per tenant by `provision`. The web embeds them in an iframe:
`http://<tb-host>/dashboards/<dashboardId>?accessToken=<jwt>&refreshToken=<jwt>` where the tokens belong to
`svc-dashboards` and are fetched from the API (`GET /energy/dashboards/:key/embed`). Dashboard settings:
toolbar hidden, no title, no state controller, neutral theme. Fallback if token embedding misbehaves: assign
dashboards to the public customer and use `?publicId=`. ThingsBoard's own UI is never shown outside the iframe.

Dashboard set: `energy-overview`, `floor-drilldown` (state param `floor`), `room-detail` (state param `room`),
`ac-health`. Entity aliases resolve by asset profile and relation so one export works for any tenant.

## 7. API domain model (Drizzle schema, one table per line)

```text
Tenant(id, key, name, hostname, tbTenantId, brand Json, locale, tariffPerKwh, currency, demoMode Boolean)
User(id, tenantId, email, passwordHash, role: TENANT_ADMIN|OPS_MANAGER|FIELD_OPERATOR|FINANCE|VIEWER, employeeId?)
Employee(id, tenantId, name, department, deskRoomId, zone, persona?, email)
Location(id, tenantId, type: SITE|BUILDING|FLOOR|ROOM|ZONE, code, name, parentId, tbAssetId, capacity?, critical, floor, geometry Json)
Asset(id, tenantId, code, name, class, type, brand, model, serial, category, locationId, custodianEmployeeId?,
      purchaseDate, purchaseCost, usefulLifeYears, warrantyEnd, status, tbDeviceId?, deviceType?, meta Json, misplacedRoomId?)
Booking(id, tenantId, roomId, start, end, organiserId, title, attendance: FULL|LATE|GHOST, status: ACTIVE|RELEASED|DONE)
Automation(id, tenantId, key, enabled, params Json)
AutomationRun(id, tenantId, key, startedAt, finishedAt, summary Json)
Command(id, tenantId, assetId, method, params Json, source: USER|AUTOMATION, actorUserId?, automationRunId?, result, sentAt)
Notification(id, tenantId, userId, kind, title, body, actions Json, readAt?, actedAt?)
MaintenanceTask(id, tenantId, assetId, title, cause, status, createdFromAlarmId?)
Hold(id, tenantId, scopeType: ZONE|FLOOR|ROOM, scopeId, until, reason)
AuditLog(id, tenantId, actorType, actorId, action, entityType, entityId, before Json, after Json, ts, ip)
RoomDailyStat(tenantId, roomId, date, occupiedMinutes, bookedMinutes, ghostCount, kwh, wastedKwh)
DeviceNightlyStat(tenantId, assetId, date, avgNightPowerW, hoursAbove5w)
Report(id, tenantId, kind, period, generatedAt, pdfPath)
```

Every tenant table has `tenant_id` and an RLS policy `tenant_id = current_setting('app.tenant_id')::uuid`.
The API connects as a non-superuser role subject to RLS. All service code runs queries inside
`withTenant(tenantId, tx => …)`, which opens a transaction and executes `SET LOCAL app.tenant_id` first; a
query outside that helper sees no rows. Provisioning and cross-tenant jobs use a separate `withoutTenant`
helper on a bypass role, and its use is limited to `cli/` and `jobs/` by a lint rule (test-enforced).
Services still add `tenantId` to writes explicitly; RLS is the safety net, not the only filter.

**Live state** lives in Redis, not in process memory, so several API replicas agree: hash per device
(`live:{tenant}:{deviceCode}` → latest values, online flag, ts), set per room for presence, pub/sub channel
`events:{tenant}` for fan-out, stream `replay:{tenant}` trimmed to 60 s for reconnecting clients. Rebuilt from
ThingsBoard latest values on startup if empty.

## 8. Simulator design

- Loads the dataset, builds one `VirtualDevice` per device with an `mqtt` client and a behaviour from
  `@platform/shared/behaviours`.
- Behaviours are pure `step(state, dt, inputs) → {state, telemetry}` functions; a registry holds current
  `power_w` per device so meters can sum. Same functions are imported by the API's backfill CLI.
- Real clock. `Scheduler` fires persona events. Deterministic randomness via `seedrandom(code)`.
- RPC handler applies state changes and replies; effects appear in the next tick.
- HTTP control API on `:4100` (Fastify, header `X-Internal-Token`):

| Endpoint | Effect |
|----------|--------|
| `POST /devices` | add a virtual device at runtime `{tenant, code, type, accessToken, attrs}` |
| `DELETE /devices/:code` | remove |
| `POST /scenario/:name` | `new-laptop-first-boot {code}`, `everyone-leaves`, `late-worker-stays {employeeId}`, `lunch-peak`, `heater-left-on {room}`, `ac-filter-degrade {code}`, `ghost-meeting {room}`, `move-laptop {code, room}` |
| `POST /time/hint` | `{phase: morning|midday|evening|night}` shifts persona schedules so the demo runs at any hour without moving the clock |
| `GET /state` | snapshot for debugging |

## 9. Automation engine (API)

A BullMQ repeatable job `automations.tick` runs every minute per tenant (one job per tenant, concurrency 1 per
tenant via a Redis lock). Each automation reads live state from Redis and bookings from Postgres, decides,
issues commands through `CommandService` (which calls ThingsBoard RPC and records `Command` and `AuditLog`),
and writes an `AutomationRun`. Manual triggers exist for every automation (`POST /automations/:key/run`), and
alarm events can enqueue an immediate run. Automations are enabled per tenant; a real tenant starts with all
disabled.

| Key | Default params | Rule |
|-----|----------------|------|
| `room_auto_off` | `idleMinutes: 15` | meeting room unoccupied, no laptop present for N minutes, no booking now → lights, AC, sweepable plugs off |
| `ghost_booking` | `graceMinutes: 10` | booking started N minutes ago and room unoccupied → booking `RELEASED`, notify organiser |
| `precool` | `leadMinutes: 30` | first booking of the day in a room starts in ≤N min → AC on, setpoint 22 |
| `evening_sweep` | `time: "20:00"`, `graceMinutes: 15` | for each non-critical room: no laptop online in room, no occupancy, no booking within grace → lights and AC off; else skip with reason. Keep the whole zone of any online laptop and notify its owner. Summary saved; morning report at 07:00 |
| `peak_shedding` | `thresholdKw: 150`, `window: "12:00-14:00"`, `order: ["unoccupied_rooms","pantry","open_plan_ac_setpoint+2"]` | building total above threshold → shed in order until below; restore after 10 min below threshold − 10 % |
| `holiday_mode` | `dates: []` | on listed dates: sweep at 00:01, skip pre-cool, only critical rooms on |

Rooms with `critical: true` are never commanded. `VIEWER` and `FINANCE` cannot issue commands or run
automations (403, audited as `DENIED`; the demo shows this on purpose).

## 10. Key event flows

**New employee**: web `POST /employees` → API creates Employee, Asset (laptop), ThingsBoard device
(`POST /api/device?accessToken=`), server attributes, relation to desk room → if `tenant.demoMode`, `POST
simulator/devices` → returns. Console button "First boot" → simulator scenario → laptop connects, publishes for
60 s, disconnects → ThingsBoard Inactivity event after 30 s → rule chain → `/internal/tb/events` → API updates
Redis live state, publishes on `events:{tenant}`, creates notification "Asset unreachable" → every API
replica's `LiveGateway` forwards to subscribed sockets → floor plan turns the laptop grey then amber.

**Sweep**: BullMQ tick or console → automation evaluates → for each room to switch: `POST /api/rpc/oneway/{id}`
`setState {state:0}` for light and AC, spaced 300 ms → devices apply → next tick power drops → meters →
telemetry → Redis → WebSocket → floor plan dims room by room. `AutomationRun.summary` lists rooms off, skipped
with reasons, and kWh saved (estimated at sweep time, measured later from stats).

**Peak**: console "Lunch peak" → simulator raises loads → floor meters exceed thresholds → ThingsBoard alarm →
events → API enqueues an immediate `peak_shedding` run → commands → chart drops. Viewer clicking "Shed now"
gets 403 and a toast.

**Reconnect**: web socket reconnects with `lastEventId` → gateway replays from `replay:{tenant}` stream
(≤ 60 s) before resuming live.

## 11. Conventions

- TypeScript strict everywhere, ESM, no `any` without a comment. Zod schemas in `@platform/shared/dto` are the
  single definition of request/response shapes; Fastify validates and serialises with
  `fastify-type-provider-zod`, `@fastify/swagger` publishes OpenAPI at `/docs` from the same schemas, the web
  imports the same types.
- Fastify structure follows the `fastify-cli` scaffold: `src/plugins/` and `src/routes/` are autoloaded;
  a route folder's path is its URL prefix; route files contain thin handlers only and call
  `fastify.services.<domain>`. All logic lives in `src/services/<domain>/<domain>.service.ts` (plain classes
  or factory functions receiving their dependencies), constructed once in `src/container.ts` and exposed by
  the `services` plugin; no decorator DI, no request-scoped instances. Cross-domain calls go through the
  other domain's service, never through the database tables of another domain. Guards are `preHandler` hooks from
  `src/hooks/`: `requireAuth`, `requireRole`, `requireInternalToken`, `requireDemoMode`; tenant resolution is
  a plugin that runs on every request. Errors via the global error handler emitting RFC 7807; never leak
  ThingsBoard error bodies. Tests use Vitest (replacing the template's `node:test`) with `app.inject()`.
- Request context (tenant, user, request id) lives in `@fastify/request-context` (AsyncLocalStorage) so
  services and the audit writer can read it without parameter threading; BullMQ jobs carry `tenantId` in the
  payload and the worker seeds the same context before calling services. Database access always goes through
  `withTenant()` (RLS) from the request or job context; raw `db.` calls outside it are a review failure.
- Every mutation goes through a service that writes `AuditLog` with before/after via `AuditService.record`.
  Route handlers never write audit rows directly.
- All ThingsBoard access through `modules/tb/tb.client.ts`. Nothing else imports HTTP clients for
  ThingsBoard.
- Tenant resolution: `Host` header → `Tenant.hostname` (also `X-Tenant-Key` for the phone view when the
  hostname cannot be used, only if `demoMode`). Request-scoped tenant context via `AsyncLocalStorage`; the
  `withTenant()` and Postgres RLS enforce `tenantId`. Cross-tenant tests are mandatory (Phase 5).
- Long-running or retried work is a BullMQ job, never a `setInterval`. Processors run in the `worker`
  entry point, not in the HTTP process. Outbound calls to external systems (webhooks, mock ERP, later real
  ERP) go through the `outbound` queue with exponential backoff.
- Web: React Router framework mode routes under `app/routes/`, loaders call a typed fetch wrapper using
  `@platform/shared` types, shadcn components under `app/components/ui/`, icons only from `lucide-react`,
  Tailwind tokens from CSS variables set by the branding provider, all strings through i18n, live data via a
  `useLive()` hook on `socket.io-client`.
- Commits: conventional commits, no AI references, no plan or phase identifiers.
- No real people's names in datasets. Env vars documented in `platform/.env.example`; never commit `.env`.
- `demoMode` (per tenant) gates: scenario console route, simulator calls, `X-Tenant-Key` header. Everything
  else is production code.

## 12. Ports, hosts, credentials (local)

| Service | Container port | Host port |
|---------|----------------|-----------|
| thingsboard HTTP | 9090 | 8090 |
| thingsboard MQTT | 1883 | 1884 |
| thingsboard internal postgres | 5432 | not exposed |
| postgres (platform) | 5432 | 5434 |
| redis | 6379 | 6380 |
| api (HTTP + WebSocket) | 4000 | 4000 |
| simulator | 4100 | 4100 |
| web (nginx) | 80 | 8081 |
| web dev (react-router dev) | — | 5173 |
| mailpit UI / SMTP | 8025 / 1025 | 8025 / 1025 |
| ml (later) | 8000 | 8000 |

ThingsBoard sysadmin default `sysadmin@thingsboard.org` / `sysadmin`; `provision` changes it to the value in
`.env`. Dataset tenant users: `admin@`, `ops@`, `field@`, `finance@`, `viewer@` + `<tenant>.demo`, password
from `.env` (`DATASET_USER_PASSWORD`). The local ThingsBoard dev setup (8080, 5433, 1883) is untouched.

## 13. Running and verifying

```bash
cd platform
cp .env.example .env
pnpm install
make up                       # docker compose up -d; waits for ThingsBoard and API health
make provision TENANT=alpha   # ThingsBoard tenant + users + profiles + rule chain + dashboards + API tenant row
make provision TENANT=beta
make dataset TENANT=alpha DATASET=office-demo    # locations, devices, employees, bookings, automations
make dataset TENANT=beta  DATASET=office-demo
make backfill TENANT=alpha WEEKS=12              # Phase 4+
make test                     # pnpm -r test (vitest/jest)
make e2e                      # playwright against the running stack
make logs / make down
```

Open `http://alpha.localhost:8081` and `http://beta.localhost:8081`. Scenario console: `/console`
(TENANT_ADMIN, only when the tenant is in demo mode). API docs: `http://localhost:4000/docs`.

## 14. Decision log

| Date | Decision | Why |
|------|----------|-----|
| 2026-09-07 | Milestone scope = asset + energy management, two white-labelled tenants | Boss decision |
| 2026-09-08 | All devices simulated in the demo; no real laptops, Pi, plugs or mobile app | User decision; reliability |
| 2026-09-08 | ThingsBoard unmodified upstream image; business logic outside the JVM | No Java on the team; keeps the upgrade path |
| 2026-09-08 | `platform/` is the product foundation, not a demo folder; demo content is a *dataset*; provisioning is separate from dataset loading; migrations from day one; `demoMode` gates demo-only features | User decision: the code may run real tenants |
| 2026-09-08 | Web is a brand-new service: React Router v8 framework mode (SPA), shadcn/ui, Tailwind, lucide-react | User request |
| 2026-09-08 | **Business layer in Node.js/TypeScript (Drizzle, BullMQ), Redis for live state, pub/sub fan-out and replay, WebSocket feed to the web; Python only for the later ML service (FastAPI).** Supersedes the FastAPI-API decision of the same day | The client's BRD specifies a Node.js core with Redis pub/sub and a separate FastAPI ML service; matching it removes a stack objection and keeps one language across API, simulator and web |
| 2026-09-08 | **ORM: Drizzle with Postgres RLS**, replacing Prisma | User dislikes Prisma's schema DSL; Drizzle schema is TypeScript, migrations are plain SQL, and `pgPolicy` lets tenant isolation be enforced by the database |
| 2026-09-08 | **API framework: plain Fastify 5**, not NestJS and not tRPC. Structure comes from §11 conventions | NestJS: request-scope bubbling, RxJS interceptors and async event-handler pitfalls are permanent guardrails an agent-written codebase would keep tripping on. tRPC: the BRD requires a public REST/OpenAPI surface for non-TypeScript integrators, so tRPC would have meant two API surfaces; team chose one plain surface |
| 2026-09-08 | Automations live in the API (BullMQ jobs), not in rule chains; alarm thresholds stay in ThingsBoard device profiles | Easier to build and debug; still shows a live no-code edit in ThingsBoard |
| 2026-09-08 | Real clock only. Scenarios are triggered; history is backfilled with past timestamps and `metadata.backfill=true`; `time/hint` shifts persona schedules | Avoids two-clock bugs; keeps alarms quiet during backfill |
| 2026-09-08 | Telemetry reaches the API by rule-chain REST call node, not polling | Push, one integration path for events and alarms |
| 2026-09-08 | Phone view is a responsive web route | Scope |
| (Phase 0) | Pinned ThingsBoard image tag: **TBD, record here**. Pinned React Router v8 and Fastify minor versions: **TBD** | |
