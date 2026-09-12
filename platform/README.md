# Platform

Multi-tenant asset and energy management platform: an unmodified IoT core (ThingsBoard CE, upstream Docker
image) with a Node.js business layer, a Node simulator for virtual devices and a white-labelled React web
app. Everything runs on one machine with Docker Compose and works without internet access once the images
are built.

Layout, architecture and conventions: [plans/smart-office-demo/context.md](../plans/smart-office-demo/context.md).
Demo storyline: [docs/demo/demo-plan.md](../docs/demo/demo-plan.md).

## Prerequisites

- Docker Desktop (or Docker Engine) with Compose v2
- Node.js 22 or newer and pnpm 11 (`corepack enable && corepack prepare pnpm@11.3.0 --activate`)
- ~6 GB RAM free for the containers (ThingsBoard alone wants ~2 GB)

## Tenant hostnames

Tenants are told apart by hostname: `alpha.localhost`, `beta.localhost`, and so on. Chromium-based browsers
resolve every `*.localhost` name to `127.0.0.1` with no configuration. Firefox needs
`network.dns.native-is-localhost = true` in `about:config`, or entries in `/etc/hosts`:

```
127.0.0.1 alpha.localhost beta.localhost gamma.localhost
```

Phones cannot resolve these names. The phone view lives at `http://<machine-ip>:8081/m?tenant=alpha`: the
`tenant` query is remembered for the tab and sent as `X-Tenant-Key`, which the API honours only for tenants
in demo mode. Sign in there as the late worker (`ops@alpha.demo`) to answer the evening sweep's "Still
working" / "Leaving now" prompt.

## Quick start

```bash
cd platform
cp .env.example .env          # local credentials only; edit if you like (never commit .env)
pnpm install
make up                       # builds images, starts the stack, waits for health
make provision TENANT=alpha DATASET=office-demo
make provision TENANT=beta  DATASET=office-demo
make dataset   TENANT=alpha DATASET=office-demo
make dataset   TENANT=beta  DATASET=office-demo
```

Then open http://alpha.localhost:8081 and http://beta.localhost:8081. The header shows the tenant's business
clock in the platform zone (`TZ` in `.env`, Asia/Dubai); for tenants in demo mode the scenario console's
**time machine** can jump it, speed it up or pause it (plan context.md §8.1). Dataset users are
`admin@`, `ops@`, `field@`, `finance@`, `viewer@` followed by `<tenant>.demo` (for example
`admin@alpha.demo`); the password is `DATASET_USER_PASSWORD` from `.env`.

A tenant without a dataset is a valid, empty, branded platform: `make provision TENANT=gamma`. It has no
users yet, so create the first one with `make user TENANT=gamma EMAIL=admin@gamma.demo` (role `TENANT_ADMIN`,
password `DATASET_USER_PASSWORD` unless `PASSWORD=...` is given), then sign in at `http://gamma.localhost:8081`.

## Platform console

Tenants can also be created from the browser at **http://localhost:8081/admin** (the bare host, without a
tenant name). The console signs in with its own operator account, separate from tenant users: set
`PLATFORM_ADMIN_EMAIL` and `PLATFORM_ADMIN_PASSWORD` in `.env` and the API creates or updates that operator
on boot; leaving the password empty disables the console login. `make admin EMAIL=ops@platform.local
[PASSWORD=...] [NAME=...]` adds more operators later.

From there an operator can create a tenant with its key, hostname, locale, currency, tariff, branding
(display name, short name, colours, font, sign-in tagline, logo and favicon as SVG, PNG, JPG or WebP up to
1 MB), a first tenant admin and an optional demo dataset, and afterwards edit those settings, manage the
tenant's users, load a dataset or delete the tenant. Provisioning runs in the background and the console
streams its log.

Live telemetry is a per-tenant switch: **Simulated devices** in the platform console (on by default when a
dataset is loaded). The simulator asks the API which tenants to drive, is told about changes at once and
re-checks every minute, so a tenant created in the console gets moving data without any restart. Setting
`SIM_TENANTS` in `.env` overrides this with a fixed list.

## Automations, sweep and morning report

`/automations` lists the six automations (room auto-off, ghost-booking release, pre-cool, evening sweep,
peak shedding, holiday mode) with their parameters, an enable switch, "Run now" and an "Event tonight"
hold that keeps a floor on until a chosen time. Every rule compares against the tenant's business clock,
so from `/console` "Jump to 19:55" then speed 10× shows the 20:00 sweep happen on its own; "Late worker
stays" keeps one person's zone on and sends them the phone prompt. Peak shedding sheds one step per
evaluation while the building load exceeds the threshold inside its window (or on "Shed now" on the
Energy page) and restores everything once the load has stayed low for ten minutes; a "Peak load" alarm
from the IoT core triggers an immediate evaluation.

The morning report is generated once the business clock passes 07:00 (and from `/reports/mornings` or
the console on demand), stored per business date and emailed to the tenant's operations managers with the
tenant brand. Locally the mail lands in mailpit at http://localhost:8025.

## History, insights and the asset lifecycle

`make backfill TENANT=alpha WEEKS=12` writes twelve weeks of plausible history for every device of a
tenant (hourly for the older weeks, every 15 minutes for the last four), stepping the same pure
behaviours the simulator uses over a synthetic calendar: personas, bookings, weekends, two holidays, and
the evening sweep active only in the last four weeks so the savings are visible. It also fills the room
daily and hourly statistics, the device night statistics, the historical sweep runs and the booking
history, and hands the cumulative counters to the live world: **restart the simulator afterwards**
(`docker compose restart simulator`) so its meters continue from the backfilled values. Rerunning
replaces the range; `--purge` (via `docker compose run --rm api node dist/cli.js backfill --tenant alpha
--purge`) also deletes the range's telemetry from the IoT core first. REST-written history bypasses the
rule chain, so the backfill raises no alarms and sends no notifications.

The insights pages read that history: `/reports/energy-cost` (kWh and cost per department per month,
CSV export), `/reports/savings` (night-time kWh per floor before and after automation), `/reports/asset-
financials` (straight-line depreciation, also the totals above the register), `/energy/standby` (devices
idling between 5 and 80 W at night, with an audited "acceptable" mark), `/energy/ac-health` (runtime,
current drift, filter alarm and the maintenance task it opened), `/maintenance` (tasks opened by people
or by alarms), `/assets/fleet` (battery, reachability, warranty and misplacement per laptop),
`/rooms/utilisation` (hour × weekday heatmap, booked share, ghost rate) and `/calendar` (warranty ends,
ends of life and holidays in the next ninety days). Night statistics are computed by the worker once the
business clock passes 06:00; monthly report snapshots are stored on the first business day of a month.
Finance users see the reports only.

## Governance

`/audit` (administrators and operations managers) lists every command, automation decision, booking and
asset change, login and refusal with a before/after diff and a CSV export. Every report page can store a
snapshot and download it as a branded PDF; the register exports as PDF too. Monthly snapshots are emailed
with the PDFs attached. `make backup FILE=backups/x.tar.gz` dumps the platform database and copies the IoT core's
database and log volumes (the core and its database pause for a few seconds); `make restore FILE=...` puts
them back. The demo script,
pre-demo checklist and recovery steps live in `docs/demo/runbook.md`.

Other commands: `make logs`, `make ps`, `make test`, `make lint`, `make typecheck`, `make e2e`,
`make down` (removes containers **and data**). `make help` lists everything.

## Ports

| Service           | Host port   | Notes                                      |
| ----------------- | ----------- | ------------------------------------------ |
| web (nginx)       | 8081        | http://alpha.localhost:8081                |
| api               | 4000        | OpenAPI docs at http://localhost:4000/docs |
| simulator control | 4100        | internal token required                    |
| IoT core HTTP     | 8090        | REST used by the API and the CLI           |
| IoT core MQTT     | 1884        | devices connect here from the host         |
| IoT core database | not exposed | `tb-db`, PostgreSQL 16 + TimescaleDB       |
| platform postgres | 5434        | roles `app` (RLS) and `app_admin`          |
| redis             | 6380        |                                            |
| mailpit           | 8025 / 1025 | UI / SMTP                                  |
| web dev server    | 5173        | `pnpm --filter @platform/web dev`          |

The local ThingsBoard development setup on 8080/5433/1883 is untouched.

## Deploying to a server

`.github/workflows/deploy-platform.yml` deploys `platform/` to one Linux server over SSH on every push to
`main` that touches `platform/` (and on demand from the Actions tab). It copies the sources with rsync,
writes `.env` from a secret, builds the images on the server one at a time and restarts the stack with
`deploy/deploy.sh`. Caddy (`deploy/docker-compose.prod.yml`, `deploy/Caddyfile`) terminates TLS: the
console host and the API host get certificates at start, tenant hostnames get theirs on the first visit
after the API confirms the hostname belongs to a tenant (`GET /health/hostname`). New tenants therefore
need no DNS or certificate work.

Server, once (Ubuntu 22.04 or later, 8 GB RAM, ports 22, 80 and 443 open):

```bash
curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER   # Docker Engine + compose plugin
sudo apt-get install -y rsync
```

DNS, once, all plain A records (not proxied through a CDN, Caddy must see the TLS handshake):

```
dcs.verysell.ai       A  <server ip>     # platform console at /admin
*.dcs.verysell.ai     A  <server ip>     # every tenant, e.g. alpha.dcs.verysell.ai
api-dcs.verysell.ai   A  <server ip>     # public API, OpenAPI docs at /docs
```

GitHub secrets: `SSH_ROOT` (`user@host`, optionally `user@host:port`), `SSH_PRIVATE_KEY` (key authorised
for that user) and `ENV_FILE` (the complete `.env` for the server; `.env.dev` is the template with the
hostnames above, `127.0.0.1` port bindings and fresh secrets, and is git-ignored). `COMPOSE_FILE` in that
file adds the Caddy override, so `docker compose` and `make` on the server include it automatically.

First deployment: run the workflow manually with the **provision** input ticked, which creates the alpha
and beta tenants with the office dataset and 12 weeks of history after the stack is up. Tenant hostnames
default to `<key>.<PLATFORM_HOST>`; existing tenants can be renamed in the console. Afterwards:

- `ssh <server> 'cd platform && docker compose logs -f --tail=200 api'` for logs, `make backup` for a
  restore point (`make` needs `apt-get install make`, or call `deploy/backup.sh` directly)
- Mailpit is not public: `ssh -L 8025:127.0.0.1:8025 <server>` and open http://localhost:8025
- The API host serves the tenant-less routes (`/docs`, `/health`, `/admin/*`); tenant routes there need an
  `X-Tenant-Key` header and a tenant in demo mode. Tenant users go through their own hostname.

## Development outside Docker

```bash
pnpm install
pnpm build:shared                      # @platform/shared must be built before the other packages
pnpm --filter @platform/api dev        # against the compose postgres/redis/thingsboard
pnpm --filter @platform/simulator dev
pnpm --filter @platform/web dev        # http://alpha.localhost:5173, proxies /api and /socket.io to :4000
pnpm test && pnpm lint && pnpm typecheck
```

## Troubleshooting

- **Image build killed / Docker out of memory**: `make up` builds all three images in parallel. On a laptop
  with other containers running, build them one at a time first, then start:

  ```bash
  docker compose build api && docker compose build simulator && docker compose build web
  docker compose up -d
  ```

- **UI audit**: `make ui-audit` logs in, visits every route at desktop, laptop, tablet and phone widths,
  and reports horizontal overflow, clipped or squeezed content, console errors and failed requests, with
  screenshots in `e2e/audit/`.
- **`make e2e` needs a browser once**: `pnpm --filter @platform/e2e exec playwright install chromium`.
- **`make e2e-live` checks a deployed platform** (`e2e/live/`): platform-console sign-in, tenant hostnames,
  creating a tenant with the office-demo dataset, then the demo scenarios on that tenant. Set
  `LIVE_PLATFORM_HOST` (e.g. `dcs.verysell.ai`), `LIVE_TENANT` (default `gamma`), `PLATFORM_ADMIN_EMAIL`,
  `PLATFORM_ADMIN_PASSWORD` and `DATASET_USER_PASSWORD` from the server's `.env`. A tenant that already
  exists is kept; `LIVE_DELETE_TENANT=1` removes it in the last test. The live checks on the floor plan
  expect the office to be open, so the suite moves the tenant's business clock to 08:45 first and back to
  real time at the end.
- **Office time zone**: persona schedules and automations use `TZ` from `.env` (default `Asia/Dubai`); set it
  to your own zone when developing so laptops come online during your working hours.

## Reset

- Reload one tenant's demo data: `make dataset TENANT=alpha DATASET=office-demo RESET=1`
- Full reset: `make down` then `make up` and provision again. `make down` deletes all volumes, including
  the IoT core database.
- Restart one service: `docker compose restart simulator`

## Credentials

All local credentials live in `.env` (copied from `.env.example`). The IoT core sysadmin password is set
from `TB_SYSADMIN_PASSWORD` by `make provision` on first run. The platform console operator comes from
`PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD`. Service accounts `svc-api@<tenant>.demo` and
`svc-dashboards@<tenant>.demo` use `TB_SERVICE_PASSWORD`. Never commit `.env`.
