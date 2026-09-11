# Plan: Smart Office Demo on the platform foundation (Asset + Energy Management, white-labelled)

Status: **Done: Phases 0–5 (2026-09-10)**; rehearse with `docs/demo/runbook.md`. User decision 2026-09-10: implement Phases 1–5.
Owner: Vu Nguyen. Executing agents: read [context.md](context.md) first, then the phase file you are assigned.

## Outcome

Milestone 1 of the platform: a ten-minute, repeatable demo for DCS showing asset management and energy
management on one platform, under two white-labelled tenants, running fully on premise (one machine, Docker
Compose, no internet). The code produced is **the product foundation**, not a throwaway: the same services
later run with real devices and real tenants. Only the *dataset* (our simulated office) is demo-specific.

The storyline and idea ladder are in [../../docs/demo/demo-plan.md](../../docs/demo/demo-plan.md); the client
requirements it answers are in [../../docs/requirements/](../../docs/requirements/README.md).

## Constraints

- ThingsBoard CE runs **unmodified from the upstream Docker image**. No Java changes. This repo's Java tree is
  reference material only.
- All new code lives under `platform/` at the repo root: a pnpm workspace in **Node.js 22 / TypeScript**
  (plain Fastify API with Drizzle, BullMQ and Redis; Node simulator; React Router v8 web with shadcn/ui,
  Tailwind, lucide-react). Python is used only for the later ML service. This matches the Node.js + Redis
  pub/sub core described in the client's BRD. See context.md §3–4.
- Provisioning (tenants, profiles, rule chain, dashboards) is separate from the demo dataset (office world,
  employees, bookings, history), so a real tenant can be provisioned without demo data.
- Database schema changes go through drizzle-kit SQL migrations from the first table; every tenant table has a
  Postgres row-level-security policy.
- Ports and hostnames are fixed in context.md §12 so the stack never collides with the local ThingsBoard dev
  setup on 8080/5433/1883.
- No secrets committed. Local credentials live in `platform/.env.example` and are for local use only.
- Fictional tenant brands only. No real company names or logos.

## Non-goals for this milestone

Warehouse, retail, healthcare, mustering, CAFM work orders, water, video wall, Keycloak/SSO, native mobile,
real hardware, time acceleration of *telemetry* (history is backfilled instead; the business clock can be
moved with the time machine, context.md §8.1), production hardening (HA, secrets manager, backups beyond a
dump script).

## Phases

| Phase | File | Delivers | Depends on | Est. (1 dev + Claude) |
|-------|------|----------|------------|-----------------------|
| 0 | [phase-0-foundation.md](phase-0-foundation.md) | Compose stack (incl. Redis), dataset definition, ThingsBoard provisioning, simulator skeleton, API skeleton with WebSocket feed, web shell with branding, scenario console | — | 2 weeks |
| 1 | [phase-1-things-and-states.md](phase-1-things-and-states.md) | Levels 0–1: floor plan twin, asset register, laptop fleet, new-employee flow, rooms and bookings, light/AC control, meters and energy dashboards | 0 | 1.5 weeks |
| 2 | [phase-2-combinations.md](phase-2-combinations.md) | Level 2: laptops as occupancy, waste badge, ghost-booking release, per-room auto-off, misplaced laptop, room panel, automation engine | 1 | 1 week |
| 3 | [phase-3-automation.md](phase-3-automation.md) | Level 3: 8 PM sweep and morning report, late-worker zone, pre-cool, peak shedding, holiday mode, night anomaly | 2 | 1 week |
| 4 | [phase-4-insights.md](phase-4-insights.md) | Level 4: history backfill, cost per department, standby hunt, AC health → maintenance task, laptop fleet health, utilisation heatmap, savings report, depreciation | 3 | 1.5 weeks |
| 5 | [phase-5-governance-and-polish.md](phase-5-governance-and-polish.md) | Level 5: second tenant polish, RBAC refusals, audit view, live rule edit, Arabic RTL, offline run, branded PDFs and emails, E2E smoke, runbook | 4 | 1 week |

Phases run in order. Inside a phase, the "Files" section shows which parts can be worked in parallel
(different packages, no shared files).

## Acceptance criteria for the milestone

1. `make up` on a clean machine with Docker brings up everything; `make provision` creates both tenants;
   `make dataset` loads the office demo dataset in under two minutes; `make down` removes everything.
2. The storyline in docs/demo/demo-plan.md can be run end to end from the scenario console without touching a
   terminal.
3. With the machine's network disabled, every step still works.
4. Tenant A's users never see tenant B's data via UI or API (tested).
5. Every switch command and asset change appears in the audit log with actor, before and after.
6. Playwright smoke test covers login, floor plan, new employee, sweep, and brand switch.
7. A third tenant can be provisioned with `make provision TENANT=gamma` and shows an empty, branded platform
   with no demo data (proves the foundation is reusable).

## How to work on this plan

- Update the **Status** line of the phase file you work on: `Not started | In progress | Blocked | Done`.
- Record decisions that change context.md **in context.md** (section "Decision log"), not in chat.
- Reports go to `plans/smart-office-demo/reports/<phase>-<topic>.md` when a phase finishes or blocks.
- Do not add plan IDs or phase numbers to code, commit messages or tests; describe behaviour instead.
