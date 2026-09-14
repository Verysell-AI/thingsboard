# Smart Office demo — presenter script

One office day in about twelve minutes on the deployed site. Onboard a customer live on
**dcs.verysell.ai**, then tell the day on tenant **alpha** (Falcon Facilities Group,
`alpha.dcs.verysell.ai`), which carries twelve weeks of history, and close under the second brand
(`beta.dcs.verysell.ai`). Times in the script are the **business clock** in the header, which the time
machine moves; device data always keeps the real clock. The business timezone is Asia/Dubai.

Companion documents: [runbook](runbook.md) (pre-demo checklist, recovery, backup) and the
[demo plan](demo-plan.md) (the ideas ladder).

## 0. Thirty minutes before

| Step             | Where                                                | What                                                                                                                                                                                                                                                                            |
| ---------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server           | terminal                                             | `ssh -i key.pem ubuntu@18.141.47.14`, then `cd platform && docker compose ps`: every container healthy. Safety copy: `make backup FILE=backups/demo.tar.gz` (the IoT core pauses for a few seconds)                                                                               |
| Tunnel           | terminal, keep it open                               | `ssh -i key.pem -L 8025:127.0.0.1:8025 -L 8090:127.0.0.1:8090 ubuntu@18.141.47.14`. Mailpit is then `http://localhost:8025` and the IoT core UI `http://localhost:8090`; neither is public                                                                                        |
| Fresh simulator  | on the box                                           | `docker compose restart simulator`, wait two minutes so the "Asset unreachable" notifications from the restart are old news                                                                                                                                                      |
| Clock            | `https://alpha.dcs.verysell.ai/console`              | Time machine → **Back to real time**. Demo day is a weekday, so laptops come online by themselves between 07:30 and 18:00 Dubai time. Outside those hours, plan on the time machine                                                                                              |
| Automations      | alpha `/automations`                                 | Ghost-booking grace **10**, peak threshold **150 kW**, evening sweep **20:00**; remove any hold in the _Event tonight_ card; all six automations enabled                                                                                                                          |
| Browser profiles |                                                      | A: `https://alpha.dcs.verysell.ai` as `admin@alpha.demo`. B: `https://beta.dcs.verysell.ai` as `admin@beta.demo`. C: `http://localhost:8090` (tunnel) as `svc-dashboards@alpha.demo`, open on the `ac` device profile. D: `https://dcs.verysell.ai/admin` as the platform operator |
| Phone            | any network                                          | `https://alpha.dcs.verysell.ai/m`, signed in as `ops@alpha.demo` (Idris Barakat, the late worker). Leave the page open                                                                                                                                                           |
| Tenant name      |                                                      | For the live onboarding: a key nobody used (for example `delta`) and a fictional company name that is not "Falcon" or "Oasis". Have a logo file (SVG or PNG) ready                                                                                                               |

All passwords come from `platform/.env.dev`: `DATASET_USER_PASSWORD` for tenant users (`admin@`, `ops@`,
`field@`, `finance@`, `viewer@` + `alpha.demo`), `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` for the
platform console, `TB_SERVICE_PASSWORD` for the IoT core UI.

## 1. Screen order and talk track

### Screen 0 — Onboard a customer live (08:55, 1.5 min)

Say: _"Every customer is a tenant with its own hostname, brand and users. Onboarding one is a form, not a
project. Let me create yours now."_

Profile D, `https://dcs.verysell.ai/admin` → **New tenant**. Key `delta`, company name, colours, logo,
tagline, locale, currency, tariff; tick **Demo mode** (it is off by default, and the time machine and the
scenarios console need it); leave **Simulated devices** on; first admin user; dataset _office-demo_. **Create**
— the provisioning log streams on the page. Open `https://delta.dcs.verysell.ai` in a new tab and sign in as
the admin you just created.

- ~10 s: tenant, users, profiles, rule chain and dataset provisioned (21 locations, 71 devices, 24 people).
- ~20 s: the new hostname serves the brand; the first visit fetches its certificate.
- Up to 2 minutes: the simulator picks the tenant up because **Simulated devices** is on and laptop dots
  turn green on its floor plan.
- No history yet: the insight pages stay thin until `make backfill TENANT=delta WEEKS=12` runs on the box
  (about two minutes).

Then: _"The rest of the day I will show on a customer that has been running for three months, so the reports
have history."_ Continue on alpha.

### Screen 1 — Login and floor plan (09:00, 1 min)

Open profile A, `https://alpha.dcs.verysell.ai`. Say: _"This is Falcon, a customer live for three months.
Same platform, its own brand and users."_ You land on **Floor 1**.

- Point at the plan: rooms, desks, lights, AC units, meters, laptops as dots. _"Every consumer is an asset,
  and the assets tell us who is in the room."_
- Green dots are laptops online; the room fill shows lights on. Click a laptop dot → its asset record opens
  in the drawer (Overview, Live, History, Custody, Actions, Audit).
- Switch to **Floor 2** with the buttons at the top.

If the demo runs before 07:30 or after 18:00 business time, use the time machine first (Screen 5) or
**Bring online** on one laptop from the console.

### Screen 2 — Register a device: the new employee (09:30, 2 min)

**People → New employee.** Fill: name (a fictional colleague), department, desk room `2.O`, leave the desk
blank (a free desk is picked), persona _standard_. **Create employee.**

What happened, say it while it appears:

1. An employee record and a **laptop asset** (`LAPTOP-Exxx`) with custodian, purchase data and warranty.
2. A **device** in the IoT core with its own access token and server attributes (owner, desk room, zone).
   A real laptop agent would connect over MQTT with that token; here the simulator does.
3. The laptop appears on the Floor 2 plan at the new desk, grey (never connected).

Press **First boot** on the confirmation card. Within about 15 seconds the dot turns green and the card
says _Online_. After a minute the laptop goes quiet on purpose; 30 seconds later the core reports it
inactive and the platform raises **Asset unreachable**: the dot turns amber and the bell shows the
notification. _"That is how we know a device stopped talking, whatever the device is."_

### Screen 3 — Assign and move a laptop (09:45, 1.5 min)

**Assets** (the register). Search `LAPTOP-E003`, open the row → **Custody** tab → _Change custodian_ to
another person → save. The custody history and the audit tab record it.

Console → **Move a laptop**: laptop `LAPTOP-E003`, room `1.3`, **Move**. If the card says the laptop is
offline, press **Bring online** first. Within ten seconds the laptop reports the east access point; after
a one-minute debounce the dot moves into room 1.3 and the room shows one laptop. _"No positioning
hardware: the Wi-Fi access point is the location."_

**Assets → filter Exceptions**: after eight hours in a foreign room the laptop would be flagged _misplaced_
(the backfilled history already has examples of the flag in the morning report).

### Screen 4 — Rooms, ghost booking, waste (10:10, 2 min)

**Rooms.** Free / Busy / Booked per room, people count from sensors and laptops, kWh today and cost.
Open room 1.4 → timeline of bookings, the **Book** form.

Console → **Ghost meeting**, room `1.4`, **Create**. On **Rooms**, 1.4 turns _Booked_ while nobody is
there. Say: _"Ten minutes after the start with nobody inside, the platform releases the room."_ To show
it now: **Check ghost bookings** (or lower the grace to 1 minute on Automations). Room 1.4 returns to
_Free_, the organiser gets _Booking released_, and Automations → Run history explains the decision.

The ghost booking shows on **Rooms**, not on the floor plan: the plan draws presence, and a ghost booking
is precisely the absence of it.

Back on the floor plan, an empty room with lights or AC on for ten minutes carries the **Wasting** badge;
the Energy overview tile _Wasted today_ climbs with it.

### Screen 5 — Time machine and the lunch peak (12:30, 2 min)

Console → time machine → **Jump to a time of day** `12:30`. The header clock jumps; personas, bookings
and automations follow, telemetry stays real.

Console → **Lunch peak**: the simulator pushes every AC to full output for ten minutes. **Energy** page:
the power tile climbs. On **Automations**, set the peak threshold to **5 kW** (the office draws 7 to 17 kW)
and save. Within a minute the Energy page's **Peak shedding** panel shows _Shedding, step 1_: unoccupied
rooms' AC and lights go off on the floor plan; step 2 is the pantry plugs, step 3 the open-plan setpoint.

Private window as `viewer@alpha.demo` → Energy → **Shed now**: a red refusal. Back in profile A,
**Audit** → filter action `DENIED`: the row is there with role and route. _"Every refusal is written down."_

Restore the threshold to 150 kW afterwards; the panel goes through _Recovering_ and puts everything back
after ten minutes under the threshold (speed 10× makes that a few seconds).

### Screen 6 — AC health and the maintenance task (15:00, 1.5 min)

**Energy → AC health.** Runtime, current, drift of current per watt against two weeks ago. `AC-2.3` is the
unit whose filter is clogging in the history.

Console → **AC filter degrade** `AC-2.3`. The unit must be running: if room 2.3 is off, hold it on
**Automations → Event tonight** (floor 2) or switch its AC on from the register. The alarm needs ten
minutes above 125 % of nominal current, so start this early and come back to it. When it fires: **AC
health** shows _Alarm_, **Maintenance** lists _Check filter: AC-2.3_ opened from the alarm, and the asset
drawer carries the task badge. _"The energy signal creates the maintenance work on the asset record."_

### Screen 7 — The 8 PM sweep (20:00, 2 min)

Console → **Late worker stays**, pick _Idris Barakat_ (the ops manager, signed in on the phone). Time
machine → **Jump to 19:58**, speed **10×**.

At 20:00 the sweep runs on its own: rooms dim one after another on the floor plan (300 ms apart), the
banner announces rooms switched off and kept on, and **Automations → Evening sweep** lists every skip
with its reason: laptop online, occupied, booking within grace, zone kept for Idris, manual hold,
critical room (the server room is never touched).

The phone buzzes: _Still working in 1.West?_ Tap **Still working** → a one-hour hold appears on
Automations. Tap **Leaving now** → the zone goes dark on the plan. Speed back to **1×**.

### Screen 8 — Morning after and the insights (07:05, 2 min)

Time machine → **Jump to 07:05, tomorrow**. Within a minute **Reports → Morning reports** shows the
report: rooms off, rooms kept and why, kWh and cost saved (measured against the pre-automation baseline),
alarms overnight, ghost bookings released, unreachable and misplaced assets. Mailpit on the tunnel
(`http://localhost:8025`) has the same report as a branded email; the **PDF** button downloads it with the
brand.

Then, quickly:

- **Reports → Savings**: night-time kWh per floor, grey baseline nights, coloured nights since 14 August,
  total saved (about 556 kWh on alpha).
- **Reports → Energy cost**: kWh and cost per department per month, CSV export.
- **Energy → Standby hunt**: the twelve monitors and the coffee machine idling all night, yearly cost,
  _Mark acceptable_ is audited.
- **Rooms → Utilisation**: hour × weekday heatmaps; 1.4's ghost rate, 1.1 rarely used.
- **Assets → Laptop fleet**, **Reports → Asset financials** (book value by category), **Calendar**
  (warranties ending).

### Screen 9 — Governance and the second brand (1.5 min)

- **Audit**: filter by actor, action, entity; open a row for the before/after diff; export CSV.
- Header language → **AR**: the shell mirrors right-to-left.
- Profile B, `https://beta.dcs.verysell.ai`: Oasis Retail Holdings, own colours and logo, same platform, its
  own data. Sign in as `finance@beta.demo` to show a role that sees only the reports.
- Profile C, IoT core UI on the tunnel: device profile `ac` → alarm rule → change the duration from 10 to 5
  minutes. In profile A, **Automations** → Evening sweep time 19:00 → Save. _"Rules and schedules change
  live, no deployment."_
- Close on the tenant you created in Screen 0, now with green dots of its own.

## 2. Scenarios at a glance

| Console card                                                                      | What it does                                     | Where you see it                                        | Latency                                |
| --------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------- | -------------------------------------- |
| First boot of a laptop                                                            | Laptop connects for 60 s, then goes quiet        | Floor plan dot, employee card, bell                     | 15 s online, offline alert ~90 s after |
| Everyone leaves                                                                   | All laptops offline for the day                  | Floor plan, Rooms                                       | one tick (10 s)                        |
| Late worker stays                                                                 | One laptop stays online until 23:30              | Sweep keeps its zone, phone prompt                      | immediate                              |
| Lunch peak                                                                        | AC at full output, appliances busy for 10 min    | Energy power tile, shedding panel                       | 10 s; shedding next tick               |
| Ghost meeting                                                                     | 45-minute booking nobody attends                 | Rooms → Booked, released after grace                    | grace 10 min or _Check ghost bookings_ |
| Move a laptop                                                                     | Laptop reports another room's access point       | Dot moves, room laptop count                            | 10 s + 60 s debounce                   |
| Bring online / Take offline                                                       | Forces one laptop online for the day, or offline | Floor plan dot                                          | 10 s                                   |
| Heater left on                                                                    | +1.5 kW on a pantry plug                         | Room power, night anomaly alarm (22:00–06:00 real time) | 10 s                                   |
| AC filter degrade                                                                 | Current rises 3 % per minute on one unit         | AC health, maintenance task, alarm                      | alarm after ~10 min running            |
| Run auto-off / Check ghost bookings / Run evening sweep / Generate morning report | Runs the rule or report now                      | Automations run history, Reports                        | seconds                                |
| Time machine                                                                      | Jump, speed, pause, back to real time            | Header clock; every rule follows                        | automations re-evaluate at once        |

A scenario that targets one laptop does nothing while that laptop is offline — outside office hours, at the
weekend, or after _Everyone leaves_. Press **Bring online** first, or move the clock to a weekday hour.

## 3. Registering devices and assigning assets

- **Laptops** come from **People → New employee**: the platform creates the employee, the laptop asset,
  the device in the IoT core (with access token and attributes) and, in demo mode, the simulated laptop.
  Delete or retire through the register's status.
- **Custodian** of any asset: register → row → **Custody** → _Change custodian_. Audited, with history.
- **Rooms, lights, AC, plugs, meters, sensors** are loaded from the dataset for the demo tenants and
  register their devices the same way; a real installation would create them through the API or a future
  register form. A real device connects with the device's access token over MQTT
  (`v1/devices/me/telemetry`), exactly like the simulator.
- **Tenants and their users** are created in the platform console (`https://dcs.verysell.ai/admin`) or, on
  the box, with `make provision` / `make user`.
- **Commands** to lights, AC and sweepable plugs: asset drawer → **Actions** (switch, setpoint). Viewers
  and finance are refused and audited.

## 4. Reset between runs

1. Time machine → **Back to real time**.
2. Automations: peak threshold 150, ghost grace 10, sweep time 20:00; remove holds.
3. On the box: `docker compose restart simulator` (clears scenario state; laptops reconnect within a
   minute; expect the unreachable notifications).
4. If the data is messy: `make restore FILE=backups/demo.tar.gz` (about 75 s) and restart the simulator.
5. The tenant created in Screen 0 can stay; delete it from the platform console if you want a clean list.

## 5. If something goes wrong

| Symptom                               | Do                                                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| No green dots at all                  | Weekend or outside 07:30–18:00 business time → time machine to a weekday hour, or **Bring online** on one laptop           |
| A scenario says the laptop is offline | **Bring online** first                                                                                                     |
| New tenant shows no dots              | Give the simulator up to two minutes; check _Simulated devices_ is on for that tenant, then restart the simulator          |
| Floor plan not moving, bell silent    | Reload the tab once; if still static, on the box `docker compose restart api worker`                                       |
| Automations idle                      | On the box `docker compose restart worker`; run history should gain a row per minute                                       |
| AC alarm does not come                | The unit is off: hold room 2.3 (Event tonight) and switch the AC on from the register, then wait ten minutes              |
| A hostname does not resolve or 502s   | Caddy needs a moment after a container recreate; reload once, then on the box `docker compose restart caddy`               |
| Everything                            | On the box, `make restore` with the pre-demo backup                                                                        |

## 6. Questions you will get

Short answers to say out loud, with the fact behind each one in case someone pushes.

### Architecture

**"How does this relate to ThingsBoard?"**
ThingsBoard is our IoT core, and we run it unmodified. It owns device identity and credentials, MQTT
ingestion, timeseries storage, threshold alarm rules and command delivery. Everything above that — tenants,
people, bookings, automations, costs, reports — is ours. _"ThingsBoard knows a device published 412 watts.
It has no idea that is Room 1.4, booked by Sara, in the Facilities budget."_
Behind it: the published image `thingsboard/tb-node:4.2.1.1` with no Java source patched, a 19-node rule
chain in `platform/thingsboard/rule-chain.json`, three alarm rules in the device profiles (_AC current
high_, _Peak load_, _Night anomaly_), and 24 REST endpoints called from one directory,
`api/src/services/tb/`.

**"Why Node and Fastify when ThingsBoard is Java?"**
Different jobs. The Java core does what it is good at: device connections, ingestion at volume, timeseries
retention. Our layer is business rules that change often — tariffs, sweep policy, report formats, branding
— and one set of TypeScript types is shared by the API, the worker, the simulator and the browser. Forking
the Java core to add bookings would have cost us every future upgrade.

**"How do you upgrade ThingsBoard without breaking this?"**
We run the published image and pin the version; nothing in its source is patched. An upgrade is a version
bump and a regression run, not a merge. Our coupling is one directory and one rule-chain file, both in
version control — which is also the answer to "are you locked in?".

**"How do we connect real hardware instead of the simulator?"**
A real device authenticates with its own access token and publishes to `v1/devices/me/telemetry` over MQTT
— the same contract the simulator uses. Nothing above the core changes. For gear that does not speak MQTT
(BACnet, Modbus, LoRaWAN) you add a gateway or an integration; the platform sees the same devices either
way.

**"How far does it scale?"**
Ingestion is the core's job and it is horizontally scalable on TimescaleDB. Our layer is stateless behind
the API, so it scales by adding containers, and the per-tenant automation tick is a queued repeatable job
spread across workers. The demo runs on one box because it is a demo. Honest answer: we have not load
tested to ten thousand devices, and I would want a sizing exercise against your real device mix before
quoting numbers.

**"Does the time machine fake the data?"**
No — worth being precise here. The business clock moves what the business logic believes the time is:
bookings, schedules, the sweep, report periods. Telemetry, alarms and audit rows always carry real
timestamps. It exists so a twelve-minute demo can show an eight-o'clock sweep. A production tenant simply
runs at real time.

### Security

**"How is one customer's data kept away from another's?"**
Four layers. The hostname resolves the tenant on every request. Postgres row-level security covers 17
tables with 17 policies, and the runtime connects as a role that is _subject_ to those policies — a query
that forgets its tenant filter returns nothing rather than another tenant's rows; migrations use a separate
role that bypasses them. Each platform tenant maps to its own ThingsBoard tenant, so device data is
separated in the core too. Redis keys and queues are namespaced per tenant.
Behind it: `deploy/postgres-init.sh` creates `app` (restricted) and `app_admin` (`BYPASSRLS`);
`api/src/db/tenant.ts` sets `app.tenant_id` for the life of each transaction.

**"How do users sign in, and how are passwords stored?"**
Email and password against the tenant's user table. Passwords are bcrypt hashes — never stored or
recoverable in plaintext. A successful sign-in issues a 15-minute access token and a 7-day refresh token;
the access token lives in memory with a session-storage mirror, so a reload keeps the session and closing
the tab ends it. Single sign-on (SAML or OIDC) is an integration point, not a rewrite.

**"Who can do what?"**
Five roles: tenant admin, operations manager, field operator, finance, viewer. They are one table mapping
capability keys to roles, checked before the handler runs, not scattered `if` statements — and there is a
test asserting the whole matrix. You saw it on stage: the viewer pressed **Shed now** and was refused.

**"Can the audit trail be trusted?"**
Every change writes its audit row inside the same database transaction as the change itself, so they commit
together or not at all. Rows carry actor, action, entity, before and after JSON, timestamp, IP and request
id, from 36 call sites across the services — and refusals are audited as `DENIED` alongside successes.
The honest limit: it is an append-only application table, not a tamper-proof ledger, so a database
administrator could edit it. If you need cryptographic non-repudiation we ship rows to a write-once store
or your SIEM — a connector, not a redesign.

**"Can it run on-premise or air-gapped?"**
Yes; that is how this demo runs. One Compose file, no cloud services, no external fonts or scripts. An
automated test drives seven pages and asserts the browser contacted no host outside the box
(`e2e/tests/offline-requests.spec.ts`).

**"What is your backup and recovery story?"**
`make backup` writes one tarball holding the platform database dump and the IoT core's volumes; `make
restore` puts it back, about 75 seconds on this dataset, and we have exercised the round trip. In
production that becomes a scheduled job with off-box retention plus Postgres point-in-time recovery.

**"Is this production-ready? What is missing?"**
Answer this one straight: it is a working system, not yet a hardened deployment. Before a paying tenant
goes live I would add rate limiting and security headers on the API, tighten CORS from permissive to an
explicit origin list, move secrets out of an `.env` file into a managed secret store, add single sign-on,
move from one Compose host to a high-availability topology, and commission a penetration test. None of
that is an architectural change — it is deployment work, on the order of two to three weeks.
