# Phase 0 — Foundation

Status: Done (2026-09-08) — see [reports/phase-0-foundation.md](reports/phase-0-foundation.md)
Depends on: nothing. Read [context.md](context.md) sections 2–6, 8, 11–13 first.

## Context

Nothing exists yet under `platform/`. This phase produces a running stack, a `provision` command that creates
a tenant end to end, a `dataset` command that loads the office world into a tenant, a simulator that keeps the
dataset's devices alive over MQTT, an API that can log in, resolve a tenant from the hostname, receive
ThingsBoard events into Redis and push them over WebSocket, and a web shell that shows the right brand. No
business features yet; the goal is that Phase 1 can start on features without touching infrastructure, and
that a tenant without a dataset is already a valid, empty platform.

## Requirements and acceptance criteria

1. `make up` on a clean Docker host starts ThingsBoard, postgres, redis, api, simulator, web, mailpit with the
   ports in context.md §12, and returns only when ThingsBoard answers `GET /api/auth/login` with an HTTP status (302 on 4.2.1.1; health)
   and the API answers `GET /health` (which checks Postgres, Redis and ThingsBoard reachability).
2. `make provision TENANT=alpha` creates: ThingsBoard tenant, `svc-api` and `svc-dashboards` users, the seven
   device profiles with alarm rules from `platform/thingsboard/device-profiles/`, asset profiles, the root rule
   chain (REST node pointed at the API with `INTERNAL_API_TOKEN`), dashboards (placeholders until Phase 1), and
   the API `Tenant` row with brand from the dataset's tenant file (or a neutral default brand when no dataset
   is given). Idempotent: re-running updates in place. `make provision TENANT=gamma` with no dataset yields an
   empty branded tenant.
3. `make dataset TENANT=alpha DATASET=office-demo` creates locations (Site → Building → Floor → Room → Zone
   assets with `Contains` relations and API `Location` rows with geometry), every device from `world.json`
   with token `<tenant>-<code>`, server attributes, API `Asset` rows with `tbDeviceId`, employees, users
   (`admin@`, `ops@`, `field@`, `finance@`, `viewer@`), and default `Automation` rows (enabled only in demo
   mode). `--reset` deletes the dataset's entities first.
4. Simulator connects every dataset device over MQTT and publishes telemetry every 10 s with plausible values;
   a laptop whose persona says "at work now" is online, others offline. `GET :4100/state` shows all devices.
5. API: `POST /auth/login` per tenant; `GET /me`; `GET /branding` by Host header; `/internal/tb/events`
   updates Redis live state, publishes on the tenant channel and appends to the replay stream; the Socket.IO
   gateway forwards tenant events to subscribed clients and replays the last 60 s on reconnect; a request for
   another tenant's entity returns 404 (never 403). Swagger at `/docs`.
6. Web: login route and shell themed from `/branding` (logo, colours, name, title, favicon), sidebar with
   lucide icons, empty floor-plan route, `/console` route (visible only when `me.tenant.demoMode`) with buttons
   wired to `POST /console/scenario/:name` for `new-laptop-first-boot`, `everyone-leaves`, `lunch-peak` and a
   `time/hint` select.
7. `make test` runs unit tests for `shared`, `api`, `simulator`, `web` green; ESLint and `tsc --noEmit` clean
   across the workspace. drizzle-kit has an initial SQL migration for every table in context.md §7 (even those
   unused yet), including RLS policies and the two database roles (`app` under RLS, `app_admin` bypass).
8. `platform/README.md` explains prerequisites, the `*.localhost` note, commands, and how to reset.
9. The pinned ThingsBoard image tag and the pinned React Router v8 and Fastify versions are recorded in
   context.md §14.

## Files

Parallelisable tracks (no shared files): **A** infra + shared + ThingsBoard artefacts + API CLI, **B** simulator,
**C** api, **D** web. Track A creates `shared/` and the dataset first; others only import.

```text
platform/Makefile, docker-compose.yml, .env.example, README.md, package.json, pnpm-workspace.yaml, tsconfig.base.json, eslint.config.js, .prettierrc, .nvmrc
platform/deploy/{Dockerfile.api, Dockerfile.simulator, Dockerfile.web, nginx.conf}
platform/shared/{package.json, src/{dataset/schema.ts, dto/{auth,tenant,branding,live}.ts, contracts/{mqtt,rpc,events}.ts, behaviours/{index,laptop,light,ac,occupancy,plug,roomMeter,floorMeter}.ts, roles.ts}, test/}
platform/datasets/office-demo/{world.json, personas.json, tenants/alpha.json, tenants/beta.json, brands/alpha/*, brands/beta/*}
platform/thingsboard/{device-profiles/*.json, asset-profiles/*.json, rule-chain.json, dashboards/.gitkeep}
platform/api/{package.json (fastify-cli generated, scripts: start = fastify start -l info dist/app.js), drizzle.config.ts, drizzle/0000_init.sql + meta/}
platform/api/src/{app.ts (generated root plugin with autoload), worker.ts, cli.ts, config.ts, container.ts}
platform/api/src/db/{index.ts, tenant.ts, schema/{index,tenants,users,employees,locations,assets,bookings,automations,commands,notifications,maintenance,holds,audit,stats,reports}.ts}
platform/api/src/plugins/{config,db,redis,request-context,auth,tenant,swagger,error-handler,services,live}.ts
platform/api/src/hooks/{require-auth,require-role,require-internal-token,require-demo-mode}.ts
platform/api/src/routes/{health,auth,me,branding,console}/index.ts
platform/api/src/routes/internal/tb-events/index.ts
platform/api/src/services/auth/auth.service.ts
platform/api/src/services/tenants/{tenants.service,tenant-resolver}.ts
platform/api/src/services/users/users.service.ts
platform/api/src/services/audit/audit.service.ts
platform/api/src/services/commands/commands.service.ts                    CommandService (RPC + Command row + audit)
platform/api/src/services/tb/{tb.client,tb-events.service}.ts
platform/api/src/services/live/{live-state.service,replay.service}.ts     Redis live state and replay stream; Socket.IO lives in plugins/live.ts
platform/api/src/services/console/console.service.ts
platform/api/src/jobs/queues.ts                                            queue names, BullMQ setup (no processors yet)
platform/api/src/cli/{provision.ts, dataset.ts, tb-import.ts}
platform/api/test/{app.test.ts, tenant-isolation.test.ts (skeleton), helpers/build-test-app.ts}
platform/simulator/{package.json, src/{main.ts, config.ts, world.ts, registry.ts, device.ts, mqtt.ts, control.ts, scenarios.ts}, test/}
platform/web/{package.json, react-router.config.ts, vite.config.ts, tailwind.config.ts, components.json, app/{root.tsx, routes.ts, routes/{login,_shell,_shell.floors.$floor,_shell.console}.tsx, lib/{api.ts, branding.tsx, auth.ts, live.ts}, components/ui/*, components/shell/*}}
platform/e2e/playwright.config.ts
```

## Steps

### Track A — infra, shared, dataset, ThingsBoard artefacts, API CLI

1. pnpm workspace with packages `shared`, `api`, `simulator`, `web`, `e2e`; root ESLint, Prettier and
   `tsconfig.base.json`; Node 22 in `.nvmrc`. Pin Fastify and React Router versions; record them in
   context.md §14.
2. Pick the newest `thingsboard/tb-postgres` **4.x stable** tag on Docker Hub. Record it in context.md §14.
3. `docker-compose.yml`: `thingsboard` (in-memory queue, bundled postgres, data and log volumes, healthcheck
   on `/api/auth/login` returning 401), `postgres`, `redis` (append-only persistence), `api` (runs
   `drizzle-kit migrate` on start), `worker` (same image, `node dist/worker.js`), `simulator`, `web`
   (multi-stage: `react-router build` → nginx serving
   `build/client`, proxying `/api/` and `/socket.io/` with WebSocket upgrade to the API and passing `Host`
   through), `mailpit`. CLI commands run as `docker compose run --rm api node dist/cli.js ...`. Fixed ports
   from §12. `depends_on` with `service_healthy`.
4. `@platform/shared`: Zod schemas for `world.json`, `personas.json`, `tenants/*.json`; MQTT/RPC/event
   contract constants; role enum; pure behaviours per §5.3 physics. Write the office dataset including
   geometry; a test validates the files against the schema.
5. Author the seven device profiles and asset profiles in a scratch ThingsBoard of the pinned version (or by
   hand against the DTO shape), including alarm rules from §6.4, export to `platform/thingsboard/`. Build the
   root rule chain per §6.5 in the UI, export chain + metadata, replace the REST node URL with
   `http://api:4000/internal/tb/events` and the token with the placeholder `${INTERNAL_API_TOKEN}` that
   `provision` substitutes. Include the backfill filter node.
6. `TbClient` (`modules/tb/tb.client.ts`): sysadmin and per-tenant logins, token refresh, typed wrappers for
   every endpoint in §6.2. Unit tests with mocked fetch (`undici` MockAgent).
7. CLI via `commander` (`src/cli.ts`): `provision --tenant KEY [--dataset NAME]`: sysadmin login → set sysadmin
   password from `.env` → create tenant → users via activation link → profiles → rule chain import + set root →
   dashboards import → `Tenant` row with brand and `demoMode` from flags. `dataset --tenant KEY --dataset
   NAME [--reset]`: locations, devices (`POST /api/device?accessToken=`), attributes (`room`, `zone`,
   `critical`, `nominal_current_a`, `night_baseline_w`, `sweepable`, `inactivityTimeout` for laptops),
   relations, API rows, dataset users, automations. Print a summary table.
8. Makefile targets from §13.

### Track B — simulator

1. Load the dataset for the tenants listed in `SIM_TENANTS`; build `VirtualDevice` per device with an `mqtt`
   client (client id and username = token; reconnect with backoff; connects staggered by 50 ms).
2. Behaviours imported from `@platform/shared/behaviours`; `registry` holds current `power_w`; integrate
   `energy_kwh`.
3. `laptop` behaviour reads persona; connected and publishing while "at work", disconnected otherwise; `ap`
   follows the desk zone; `battery` drifts; `cpu` random walk.
4. RPC: subscribe `v1/devices/me/rpc/request/+`, apply `setState` / `setSetpoint`, reply on the response topic.
5. Control API (Fastify on 4100, `X-Internal-Token`): `POST /devices`, `DELETE /devices/:code`,
   `POST /scenario/:name` implementing `new-laptop-first-boot`, `everyone-leaves`, `lunch-peak`; others return
   501 with the name; `POST /time/hint`; `GET /state`.
6. Tests (Vitest): monotonic `energy_kwh`; floor power equals rooms + core load; `standard` persona online at
   10:00 and offline at 23:00; RPC changes power on the next step.

### Track C — api

1. Scaffold with `pnpm dlx fastify-cli generate api --lang=ts`, then swap its `node:test` setup for Vitest.
   Keep the generated `src/app.ts` (autoload of `plugins/` then `routes/`). Add plugins for zod-validated
   config, db (Drizzle over `pg` Pool as the RLS-restricted `app` role, plus `withTenant()` from
   `src/db/tenant.ts` that runs `SET LOCAL app.tenant_id` in a transaction), Redis (ioredis clients for
   commands, pub and sub), `@fastify/request-context`, `@fastify/jwt`, tenant resolution (Host → tenant, 404
   if unknown), global error handler emitting RFC 7807, `@fastify/swagger` + swagger-ui at `/docs`, and a
   `services` plugin that calls `buildContainer(config)` from `src/container.ts` and decorates
   `fastify.services`. Use `fastify-type-provider-zod` on the instance. Tests build the app with
   `helpers/build-test-app.ts`, which registers the same `app.ts` with a container of fakes. Drizzle schema
   for all tables in §7 with `pgPolicy` on tenant tables; `drizzle-kit generate` produces the initial SQL
   migration, hand-edit it to add the two roles and `ALTER TABLE … ENABLE ROW LEVEL SECURITY`.
2. Hooks in `src/hooks/`: `requireAuth`, `requireRole(...roles)`, `requireInternalToken`, `requireDemoMode`,
   used as `preHandler` on routes.
3. Modules: `health`, `auth` (login, refresh), `tenants` (branding), `tb` (client + `/internal/tb/events`:
   shared-token check, tenant resolution by `originator.id` → `Asset.tbDeviceId`, drop `ts` older than 5 min,
   update Redis live state, publish on `events:{tenant}`, append to `replay:{tenant}` with 60 s trim), `live`
   (Socket.IO attached to the Fastify server with `@socket.io/redis-adapter`, tenant rooms, subscription by
   device/room/type, replay on `lastEventId`), `console` (TENANT_ADMIN, demo-mode tenant, proxies to the
   simulator with the internal token).
4. `CommandService.sendRpc(assetId, method, params, actor)` → `TbClient.rpcOneway`, writes `Command` and
   `AuditLog`. Used from Phase 1 on; write it now with tests.
5. `AuditService.record(actor, action, entity, before, after)` reading actor and tenant from the request
   context; a test helper asserts every service mutation produced an audit row.
6. Startup (an `onReady` hook in the `live` plugin): if Redis live state is empty, rebuild it from ThingsBoard
   latest values for all devices of all tenants. Define BullMQ queues in `jobs/queues.ts`; `worker.ts` builds
   the container without Fastify and starts with no processors yet.
7. Tenant-scoping tests: a query through `withTenant(alpha)` never returns beta rows even when the service
   forgets a `tenantId` filter; a query outside `withTenant` returns no rows; the lint rule rejects
   `withoutTenant` outside `cli/` and `jobs/`.

### Track D — web

1. `create-react-router` (framework mode), `ssr: false`, TypeScript strict, Tailwind, shadcn init
   (`components.json`, `app/components/ui`), `lucide-react`, `react-i18next` with `en` and an empty `ar`,
   `socket.io-client`.
2. `BrandingProvider` (root loader fetches `/branding`) sets CSS variables `--brand-primary`, `--brand-accent`,
   logo, document title, favicon. shadcn theme tokens map to those variables.
3. Auth: login route, token in memory with refresh, `me` in context; route guard in the `_shell` layout.
4. Shell layout: sidebar (Floor plan, Assets, Rooms, Energy, Notifications, Audit, Console) with lucide
   icons, header with tenant logo and user menu. Placeholder routes.
5. Typed fetch wrapper `app/lib/api.ts` using `@platform/shared` DTO types.
6. `useLive()` hook on Socket.IO storing device state; reconnect passes `lastEventId`; floor-plan route
   renders room rectangles from `/locations` and colours them by any live value to prove the pipeline.
7. `/console` route: buttons calling `POST /console/scenario/:name`; shows last result; time-hint select.

## Validation

- Bring the stack up from scratch; provision alpha, beta and gamma (no dataset); load the dataset into alpha
  and beta; open all three hostnames; confirm branding differs and gamma is empty but working.
- In the ThingsBoard UI (8090) as `svc-api@alpha.demo`: devices Active for at-work laptops, telemetry arriving
  for meters, alarm rules on profiles, rule chain root shows the REST node.
- Trigger `new-laptop-first-boot` from `/console`; the laptop goes Active then Inactive within 90 s in
  ThingsBoard and the WebSocket event appears in browser devtools. Kill the browser's network for 20 s and
  confirm the replayed events arrive on reconnect.
- Run two API replicas (`docker compose up --scale api=2`) behind nginx and confirm both browsers receive
  events regardless of which replica handled the ThingsBoard webhook.
- Disconnect the host from the internet and repeat login: works.
- `make test`, lint and type checks green.

## Risks

- **ThingsBoard profile/rule-chain JSON drift** between versions: export from the exact pinned image.
- **User activation**: `sendActivationMail=false` and parse the token from `activationLink`; ThingsBoard
  accepts `POST /api/noauth/activate` without SMTP.
- **`*.localhost` in nginx**: `server_name ~^(?<tenant>.+)\.localhost$`, pass `Host` upstream, and forward
  WebSocket upgrade headers for `/socket.io/`.
- **Sticky sessions**: Socket.IO with polling fallback needs sticky sessions behind a load balancer; force
  `transports: ['websocket']` in the client to avoid it.
- **RLS and connection pooling**: `SET LOCAL` is transaction-scoped, so every tenant query must run inside
  `withTenant`'s transaction; never `SET` on a pooled connection. Migrations run as the bypass role.
- **Request context in the worker**: `@fastify/request-context` is HTTP-bound; the worker must seed the same
  AsyncLocalStorage store from the job payload before calling services. Provide one `runWithContext()` helper
  used by both.

## Rollback

`make down` removes containers and volumes. Nothing outside `platform/` is touched.

## Report

Write `reports/phase-0-foundation.md` with: pinned image tag, pinned Fastify and React Router versions,
provision and dataset timings, deviations from context.md, open issues for Phase 1.
