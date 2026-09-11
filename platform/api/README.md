# @platform/api

Fastify 5 service: tenants and branding, auth, locations, the ThingsBoard event ingress, the Socket.IO
live feed, and the `provision` / `dataset` CLI. Structure follows the fastify-cli scaffold: `src/plugins/`
and `src/routes/` are autoloaded (folder path = URL prefix); logic lives in `src/services/`, built once by
`src/container.ts`.

| Entry point      | Command                                                                                                                      | Purpose                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `dist/server.js` | `node dist/server.js`                                                                                                        | runs migrations as `app_admin`, serves HTTP + WebSocket on `API_PORT` |
| `dist/worker.js` | `node dist/worker.js`                                                                                                        | BullMQ workers (queues `automations`, `reports`, `outbound`)          |
| `dist/cli.js`    | `node dist/cli.js provision --tenant alpha --dataset office-demo` / `dataset --tenant alpha --dataset office-demo [--reset]` | provisioning and dataset loading                                      |

## Routes

| Method    | Path                                                                                                                                                      | Auth                                               | Notes                                                                                                                                                |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET       | `/health`                                                                                                                                                 | none                                               | Postgres, Redis, ThingsBoard reachability; 503 when degraded                                                                                         |
| GET       | `/docs`                                                                                                                                                   | none                                               | Swagger UI from the Zod schemas                                                                                                                      |
| POST      | `/auth/login`, `/auth/refresh`                                                                                                                            | none                                               | tenant from `Host`                                                                                                                                   |
| GET       | `/me`                                                                                                                                                     | bearer                                             | user + tenant summary                                                                                                                                |
| GET       | `/branding`, `/branding/logo`, `/branding/favicon`                                                                                                        | none                                               | tenant brand for the login page; assets are served in whatever type was uploaded                                                                     |
| GET       | `/locations`, `/locations/:id`, `/locations/floors/:floor/plan`                                                                                           | bearer                                             | floor plan with rooms, zones (with `accessPoint`), desks, devices                                                                                    |
| GET/PATCH | `/assets`, `/assets/facets`, `/assets/:id`                                                                                                                | bearer (matrix)                                    | asset register: search, filters, paging, book value; detail with commands, custody, audit, attributes; PATCH audits `asset.update` / `asset.custody` |
| POST      | `/assets/:id/commands`                                                                                                                                    | TENANT_ADMIN, OPS_MANAGER, FIELD_OPERATOR          | RPC to the device through `CommandsService`; others get 403 + `DENIED` audit                                                                         |
| GET       | `/assets/:id/history?keys=&from=&to=&interval=&agg=`                                                                                                      | bearer                                             | ThingsBoard history proxy, ≤ 35 days, ≤ 5000 points, cached 30 s                                                                                     |
| GET/POST  | `/employees`, `/employees/:id`                                                                                                                            | bearer / TENANT_ADMIN, OPS_MANAGER                 | POST creates employee + desk + laptop asset + ThingsBoard device (+ simulated laptop in demo mode) with compensation                                 |
| GET       | `/rooms?floor=&kind=`, `/rooms/:id`                                                                                                                       | bearer                                             | live room status (FREE / BUSY / BOOKED), people, laptops, lights, AC, power, kWh today, bookings                                                     |
| GET/POST  | `/bookings`, `/bookings/:id`, `/bookings/:id/cancel`                                                                                                      | bearer / TENANT_ADMIN, OPS_MANAGER, FIELD_OPERATOR | overlap → 409; `attendance` honoured in demo mode only                                                                                               |
| GET/POST  | `/notifications`, `/notifications/:id/read`, `/notifications/read-all`, `/notifications/:id/act`                                                          | bearer                                             | the signed-in user's notifications, unread count, action keys                                                                                        |
| GET       | `/energy/summary`, `/energy/breakdown?scope=floor\|room`, `/energy/top`, `/energy/trend?scope=&code=&range=`                                              | bearer                                             | from floor/room meters: power now, kWh today/week/month, cost, power factor, per-bucket trends (cached 30 s)                                         |
| POST      | `/admin/auth/login`, `/admin/auth/refresh`, GET `/admin/auth/me`                                                                                          | none / platform bearer                             | platform operators; tenant-less, so these work on the bare host                                                                                      |
| GET/POST  | `/admin/tenants`, `/admin/tenants/:key` (PATCH, DELETE), `/admin/tenants/:key/dataset`, `/admin/tenants/:key/users`, `/admin/datasets`, `/admin/jobs/:id` | platform bearer                                    | the console: create, brand, edit and delete tenants, manage their users, load datasets; long tasks return 202 + a job to poll                        |
| GET       | `/internal/bookings/now?tenant=`                                                                                                                          | `X-Internal-Token`                                 | bookings running at the tenant's business clock, for the simulator                                                                                   |
| GET/POST  | `/clock`                                                                                                                                                  | bearer / TENANT_ADMIN, demo mode                   | tenant business clock (time machine): jump, speed, reset; pushed to the simulator and to browsers as a `clock` event                                 |
| GET       | `/internal/clock/:tenantKey`                                                                                                                              | `X-Internal-Token`                                 | simulator pulls the clock at startup                                                                                                                 |
| POST      | `/internal/tb/events`                                                                                                                                     | `X-Internal-Token`                                 | rule-chain ingress → Redis live state → pub/sub → WebSocket                                                                                          |
| WS        | `/socket.io`                                                                                                                                              | `auth.token`                                       | `snapshot`, then `event`; `auth.lastEventId` replays ≤ 60 s                                                                                          |

`/admin/*` is the one family of routes without a tenant: it is guarded by `requirePlatformAdmin`, whose
tokens carry `scope: 'platform'` and no tenant, so a tenant token never opens the console and vice versa.
The first operator comes from `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` on boot, or from the CLI
`admin` command.

Every tenant request resolves the tenant from the `Host` header (port ignored); `X-Tenant-Key` is
accepted only for tenants in demo mode. Unknown tenant → 404. Errors are RFC 7807 `application/problem+json`.

Access is one table, `src/hooks/rbac.matrix.ts` (route key → roles), applied by `requireAccess(key)`:
TENANT_ADMIN everything; OPS_MANAGER everything except users, branding, console and the clock; FIELD_OPERATOR
reads, device commands and bookings; FINANCE energy, notifications and reports only; VIEWER reads. Every
refusal is a 403 with a `DENIED` audit row. "Now" and "today" in every service come from the tenant business
clock (`ClockService.now`) in `TIME_ZONE`; ThingsBoard events raise `Asset unreachable` for silent laptops and
notify operations through `NotificationsService` (`src/services/tb/event-hooks.ts`).

## Database

Drizzle schema in `src/db/schema/`, migrations in `drizzle/` (see its README). Two roles: `app` (row-level
security, used by the server) and `app_admin` (BYPASSRLS; migrations, CLI, jobs, and the device lookup for
incoming ThingsBoard events). All tenant queries run inside `withTenant(db, tenantId, tx => …)`, which sets
`app.tenant_id` for the transaction; a query outside it returns no rows.

Desks are stored inside the open-plan room's `locations.geometry.desks[]` (`code, zone, x, y, employeeId`);
zone rows keep the Wi-Fi access point in `geometry.accessPoint`. Device positions are `assets.meta.x/y`.

## Tests

```bash
pnpm --filter @platform/api test            # unit tests (no services needed) + integration (skipped without env)
docker run --rm -d --name api-test-pg -p 5435:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=platform_test postgres:16-alpine
docker run --rm -d --name api-test-redis -p 6381:6379 redis:7-alpine
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5435/platform_test TEST_REDIS_URL=redis://localhost:6381 \
  pnpm --filter @platform/api test:integration
```

The integration helper drops and recreates the `public` schema of `TEST_DATABASE_URL`, so point it at a
throwaway database only.
