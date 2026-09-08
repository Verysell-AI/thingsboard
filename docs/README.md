# ThingsBoard CE — Project Docs for Agents

Written 2026-09-07 after a full read-through, build, DB install and smoke test of this repo
(ThingsBoard Community Edition fork, version 4.4.0-SNAPSHOT, branch `master`).
These docs are for humans and AI agents who need to orient quickly. They describe
what is *not* obvious from a directory listing; for anything else, read the code.

| File | Read it when you need to… |
|------|---------------------------|
| [architecture.md](architecture.md) | understand how a message flows from a device to the DB and UI, and the core domain concepts |
| [module-map.md](module-map.md) | find which Maven module / package owns a feature |
| [dev-setup.md](dev-setup.md) | build, install the DB, run, or debug on this machine (JDK 25, Postgres on 5433, Makefile) |
| [configuration.md](configuration.md) | change runtime behaviour (DB, queue, cache, transports, ports) via `thingsboard.yml` env vars |
| [testing.md](testing.md) | run or write tests (Testcontainers, parallel test commands, test base classes) |
| [ce-vs-pe-gaps.md](ce-vs-pe-gaps.md) | know which product features are absent from Community Edition before promising them |
| [requirements/README.md](requirements/README.md) | know what the client (DCS) asked for, per source document, and how it maps onto CE (`requirements/thingsboard-fit-gap.md`) |
| [demo/demo-plan.md](demo/demo-plan.md) | see the demo scope (asset + energy management, two brands) and its ladder of scenarios; the execution plan for agents is `plans/smart-office-demo/` |

Upstream references: https://thingsboard.io/docs/ (user docs), `TEST_FAST.md` (test commands),
`ui-ngx/structure.md` (route-to-source map of the Angular UI), `docker/README.md` (microservices compose).

Quick start on this machine:

```bash
make help        # list targets
./run.sh         # start Postgres container + server -> http://localhost:8080 (tenant@thingsboard.org / tenant)
```
