# Phase 0 — Foundation

Status: Not started
Depends on: nothing. Read [context.md](context.md) sections 2–6, 8, 11–13 first.

## Context

Nothing exists yet under `platform/`. This phase produces a running stack, a `provision` command that creates
a tenant end to end, a `dataset` command that loads the office world into a tenant, a simulator that keeps the
dataset's devices alive over MQTT, an API that can log in, resolve a tenant from the hostname and receive
ThingsBoard events, and a web shell that shows the right brand. No business features yet; the goal is that
Phase 1 can start on features without touching infrastructure, and that a tenant without a dataset is already
a valid, empty platform.

## Requirements and acceptance criteria

1. `make up` on a clean Docker host starts ThingsBoard, postgres, api, simulator, web, mailpit with the ports
   in context.md §12, and returns only when ThingsBoard answers `GET /api/auth/login` with 401 (health) and
   the API answers `GET /health`.
2. `make provision TENANT=alpha` creates: ThingsBoard tenant, `svc-api` and `svc-dashboards` users, the seven
   device profiles with alarm rules from `platform/thingsboard/device-profiles/`, asset profiles, the root rule
   chain (REST node pointed at the API with `INTERNAL_API_TOKEN`), dashboards (placeholders until Phase 1), and
   the API `tenant` row with brand from the dataset's tenant file (or a neutral default brand when no dataset
   is given). Idempotent: re-running updates in place. `make provision TENANT=gamma` with no dataset yields an
   empty branded tenant.
3. `make dataset TENANT=alpha DATASET=office-demo` creates locations (Site → Building → Floor → Room → Zone
   assets with `Contains` relations and API `location` rows with geometry), every device from `world.json`
   with token `<tenant>-<code>`, server attributes, API `asset` rows with `tb_device_id`, employees, users
   (`admin@`, `ops@`, `field@`, `finance@`, `viewer@`), and default `automation` rows (all disabled except in
   demo mode). `--reset` deletes the dataset's entities first.
4. Simulator connects every dataset device over MQTT and publishes telemetry every 10 s with plausible values;
   a laptop whose persona says "at work now" is online, others offline. `GET :4100/state` shows all devices.
5. API: `POST /auth/login` per tenant; `GET /me`; `GET /branding` by Host header; `/internal/tb/events`
   updates the live cache; `GET /live` streams SSE with device state changes; a request for another tenant's
   entity returns 404 (never 403, to avoid leaking existence). `GET /openapi.json` is complete enough for
   `make types` to generate the web client.
6. Web: login route and shell themed from `/branding` (logo, colours, name, title, favicon), sidebar with
   lucide icons, empty floor-plan route, `/console` route (visible only when `me.tenant.demo_mode`) with buttons
   wired to `POST /console/scenario/{name}` for `new-laptop-first-boot`, `everyone-leaves`, `lunch-peak` and
   a `time/hint` select.
7. `make test` runs pytest (common, api, simulator) and vitest green; `ruff`, `mypy --strict`,
   ESLint clean. Alembic has an initial migration for every table in context.md §7 (even those unused yet).
8. `platform/README.md` explains prerequisites, the `*.localhost` note, commands, and how to reset.
9. The pinned ThingsBoard image tag and the pinned React Router v8 version are recorded in context.md §14.

## Files

Parallelisable tracks (no shared files): **A** infra + common + ThingsBoard artefacts + API CLI,
**B** simulator, **C** api, **D** web. Track A creates `common/` and the dataset first; others only import.

```text
platform/Makefile, docker-compose.yml, .env.example, README.md, pyproject.toml (uv workspace), .python-version
platform/deploy/{Dockerfile.api, Dockerfile.simulator, Dockerfile.web, nginx.conf}
platform/common/{pyproject.toml, platform_common/{config.py, tb/client.py, tb/models.py, dataset/schema.py (pydantic), mqtt.py, tokens.py, behaviours/{__init__,laptop,light,ac,occupancy,plug,room_meter,floor_meter}.py}, tests/}
platform/datasets/office-demo/{world.json, personas.json, tenants/alpha.json, tenants/beta.json, brands/alpha/*, brands/beta/*}
platform/thingsboard/{device-profiles/*.json, asset-profiles/*.json, rule-chain.json, dashboards/.gitkeep}
platform/simulator/{pyproject.toml, src/{main.py, config.py, world.py, registry.py, device.py, mqtt.py, control.py, scenarios.py}, tests/}
platform/api/{pyproject.toml, alembic.ini, logging.ini, alembic/{env.py, versions/0001_initial.py}}
platform/api/src/{main.py, config.py, database.py, exceptions.py, pagination.py, models.py, scheduler.py}
platform/api/src/auth/{router,schemas,models,service,dependencies,config,exceptions,utils}.py
platform/api/src/tenants/{router (branding),schemas,models,service,dependencies (Host → tenant)}.py
platform/api/src/users/{models,schemas,service}.py
platform/api/src/{locations,assets,employees,automations,commands,notifications,maintenance,reports}/models.py   tables only in Phase 0
platform/api/src/commands/service.py                       CommandService (RPC + command row + audit)
platform/api/src/audit/{models,service,schemas}.py
platform/api/src/live/{cache.py, router.py (SSE)}
platform/api/src/tb_events/{router.py, service.py, schemas.py}
platform/api/src/console/{router.py, service.py}
platform/api/src/cli/{__main__.py, provision.py, dataset.py, tb_import.py}
platform/api/tests/{conftest.py, auth/, tenants/, tb_events/, commands/, cli/}
platform/web/{react-router.config.ts, vite.config.ts, tailwind.config.ts, components.json (shadcn), app/{root.tsx, routes.ts,
  routes/{login,_shell,_shell.floors.$floor,_shell.console}.tsx, api/{client.ts, schema.d.ts}, lib/{branding.tsx, auth.ts, live.ts}, components/ui/*, components/shell/*}}
platform/e2e/playwright.config.ts
```

## Steps

### Track A — infra, common, dataset, ThingsBoard artefacts, API CLI

1. Three `uv` projects: `common` (library), `api`, `simulator`, each with its own `pyproject.toml`, `uv.lock`
   and virtualenv; `api` and `simulator` depend on `common` as a path dependency. Shared `ruff` and `mypy`
   config via `[tool.*]` copied per project; Python 3.12 in `.python-version`.
2. Pick the newest `thingsboard/tb-postgres` **4.x stable** tag on Docker Hub. Record it in context.md §14.
3. `docker-compose.yml`: `thingsboard` (in-memory queue, bundled postgres, data and log volumes, healthcheck
   on `/api/auth/login` returning 401), `postgres`, `api` (uvicorn, runs `alembic upgrade head` on start),
   `simulator`, `web` (multi-stage: `react-router build` → nginx serving `build/client`, proxying `/api/` to
   the API and passing `Host` through), `mailpit`. CLI commands run as `docker compose run --rm api python -m
   src.cli ...`. Fixed ports from §12. `depends_on` with `service_healthy`.
4. `platform_common.dataset.schema`: Pydantic models for `world.json`, `personas.json`, `tenants/*.json`;
   write the office dataset per context.md §5 including geometry; a test validates the files.
5. Author the seven device profiles and asset profiles in a scratch ThingsBoard of the pinned version (or by
   hand against the DTO shape), including alarm rules from §6.4, export to `platform/thingsboard/`. Build the
   root rule chain per §6.5 in the UI, export chain + metadata, replace the REST node URL with
   `http://api:8000/internal/tb/events` and the token with the placeholder `${INTERNAL_API_TOKEN}` that
   `provision` substitutes. Include the backfill filter node.
6. `platform_common.tb.TbClient`: async httpx client, sysadmin and per-tenant logins, token refresh, typed
   wrappers for every endpoint in §6.2. Tests with `respx`.
7. `python -m src.cli provision --tenant KEY [--dataset NAME]` (Typer app in `src/cli`): sysadmin login → set sysadmin password from `.env` →
   create tenant → users via activation link → profiles → rule chain import + set root → dashboards import →
   API `tenant` row (direct SQLAlchemy, same models as the API) with brand and `demo_mode` from flags.
   `python -m src.cli dataset --tenant KEY --dataset NAME [--reset]`: locations, devices (`POST /api/device?accessToken=`),
   attributes (`room`, `zone`, `critical`, `nominal_current_a`, `night_baseline_w`, `sweepable`,
   `inactivityTimeout` for laptops), relations, API rows, dataset users, automations. Print a summary table.
8. Makefile targets from §13 wrapping `docker compose run --rm api python -m src.cli ...` and `uv run`.

### Track B — simulator

1. Load the dataset for the tenants listed in `SIM_TENANTS`; build `VirtualDevice` per device with an
   `aiomqtt` client (client id and username = token; reconnect with backoff; connects staggered by 50 ms).
2. Behaviours as pure `step()` functions per §5.3 physics; `registry` holds current `power_w`; integrate
   `energy_kwh`.
3. `laptop` behaviour reads persona; connected and publishing while "at work", disconnected otherwise; `ap`
   follows the desk zone; `battery` drifts; `cpu` random walk.
4. RPC: subscribe `v1/devices/me/rpc/request/+`, apply `setState` / `setSetpoint`, reply on the response topic.
5. Control API (FastAPI on 4100, `X-Internal-Token`): `POST /devices`, `DELETE /devices/{code}`,
   `POST /scenario/{name}` implementing `new-laptop-first-boot`, `everyone-leaves`, `lunch-peak`; others return
   501 with the name; `POST /time/hint`; `GET /state`.
6. Tests: monotonic `energy_kwh`; floor power equals rooms + core load; `standard` persona online at 10:00 and
   offline at 23:00; RPC changes power on the next step.

### Track C — api

1. FastAPI app: settings (pydantic-settings), SQLAlchemy async engine, Alembic initial migration for all
   tables in §7, dependencies `current_tenant` (Host → tenant, 404 if unknown) and `current_user` (JWT,
   roles), RFC 7807 exception handler, structlog request logging.
2. Routers: `health`, `auth/login`, `me`, `branding`, `internal/tb/events` (shared-token check, tenant
   resolution by `originator.id` → `asset.tb_device_id`, drop `ts` older than 5 min, update cache, emit SSE),
   `live` (SSE, tenant-scoped), `console/scenario/{name}` (TENANT_ADMIN, tenant in demo mode, proxies to the
   simulator with the internal token).
3. `CommandService.send_rpc(asset_id, method, params, actor)` → `TbClient.rpc_oneway`, writes `command` and
   `audit_log`. Used from Phase 1 on; write it now with tests.
4. `AuditService.record(actor, action, entity, before, after)`; a pytest fixture asserts every service mutation
   produced an audit row.
5. Startup: rebuild the live cache from ThingsBoard latest values for all devices of all tenants; start
   APScheduler (no jobs yet).
6. Tenant-scoping guard: SQLAlchemy `before_compile` hook that raises if a tenant-scoped table is queried
   without a `tenant_id` criterion; unit test for it.

### Track D — web

1. `create-react-router` (framework mode), `ssr: false`, TypeScript strict, Tailwind, shadcn init
   (`components.json`, `app/components/ui`), `lucide-react`, `react-i18next` with `en` and an empty `ar`.
2. `BrandingProvider` (root loader fetches `/branding`) sets CSS variables `--brand-primary`, `--brand-accent`,
   logo, document title, favicon. shadcn theme tokens map to those variables.
3. Auth: login route, token in memory with refresh, `me` in context; route guard in the `_shell` layout.
4. Shell layout: sidebar (Floor plan, Assets, Rooms, Energy, Notifications, Audit, Console) with lucide
   icons, header with tenant logo and user menu. Placeholder routes.
5. `openapi-typescript` + `openapi-fetch` client generated into `app/api/schema.d.ts` by `make types`.
6. `useLive()` SSE hook storing device state; floor-plan route renders room rectangles from `/locations`
   and colours them by any live value to prove the pipeline.
7. `/console` route: buttons calling `POST /console/scenario/{name}`; shows last result; time-hint select.

## Validation

- Bring the stack up from scratch; provision alpha, beta and gamma (no dataset); load the dataset into alpha
  and beta; open all three hostnames; confirm branding differs and gamma is empty but working.
- In the ThingsBoard UI (8090) as `svc-api@alpha.demo`: devices Active for at-work laptops, telemetry arriving
  for meters, alarm rules on profiles, rule chain root shows the REST node.
- Trigger `new-laptop-first-boot` from `/console`; the laptop goes Active then Inactive within 90 s in
  ThingsBoard and the SSE event appears in browser devtools.
- Disconnect the host from the internet and repeat login: works.
- `make test`, lint and type checks green; `make types` produces no diff after a fresh generation.

## Risks

- **ThingsBoard profile/rule-chain JSON drift** between versions: export from the exact pinned image.
- **User activation**: `sendActivationMail=false` and parse the token from `activationLink`; ThingsBoard
  accepts `POST /api/noauth/activate` without SMTP.
- **`*.localhost` in nginx**: `server_name ~^(?<tenant>.+)\.localhost$` and pass `Host` upstream.
- **React Router v8**: pin the installed minor version in `package.json` and record it in context.md §14 so
  later agents scaffold against the same release.
- **Alembic with async engine**: use the async template for `env.py`.

## Rollback

`make down` removes containers and volumes. Nothing outside `platform/` is touched.

## Report

Write `reports/phase-0-foundation.md` with: pinned image tag, pinned React Router version, provision and dataset
timings, deviations from context.md, open issues for Phase 1.
