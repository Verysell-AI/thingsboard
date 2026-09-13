# Smart Office demo — runbook

The stack lives in `platform/` and runs on one machine with Docker Compose. Everything the audience sees is
served from that machine: two tenant hostnames (`alpha.localhost`, `beta.localhost`) and the bare host for
the platform console and the phone view. No internet is needed once the images are built.

## Before the demo (the evening before, about 25 minutes)

1. `cd platform && make down && make up` — clean stack; wait for "healthy".
2. `make provision TENANT=alpha` and `make provision TENANT=beta`.
3. `make dataset TENANT=alpha DATASET=office-demo` and the same for `beta`.
4. `make backfill TENANT=alpha WEEKS=12` and the same for `beta` (about a minute each), then
   `docker compose restart simulator` so the meters continue from the backfilled counters.
5. Open `http://alpha.localhost:8081/console` as `admin@alpha.demo`: **Back to real time** on the time
   machine, then **Everyone leaves** is *not* pressed yet.
6. Browser profiles: profile A for `alpha.localhost` (presenter), profile B for `beta.localhost` (brand
   switch), profile C for the IoT core UI at `http://localhost:8090` signed in as
   `svc-dashboards@alpha.demo` (live rule edit). Keep C's tab on the `ac` device profile.
7. Phone on the same Wi-Fi: `http://<machine-ip>:8081/m?tenant=alpha`, sign in as `ops@alpha.demo`
   (the late worker, Idris Barakat). Leave the page open.
8. Mailpit at `http://localhost:8025` in a background tab (the morning report lands there).
9. `make backup FILE=backups/before-demo.tar.gz` — the fallback if something goes wrong on stage.

Credentials come from `platform/.env` (`DATASET_USER_PASSWORD`). Users per tenant: `admin@`, `ops@`,
`field@`, `finance@`, `viewer@` + `<tenant>.demo`.

## The ten-minute script

Times are the *business clock* shown in the header; the time machine moves it, telemetry stays on the real
clock. **The office is closed on Saturday and Sunday**: no persona comes in, so every laptop is offline and
scenarios that need a laptop ("Move a laptop", the sweep's late-worker zone) show nothing. On a weekend, jump
the time machine to a weekday hour (tick *tomorrow* on a Sunday) or use the console's **Bring online** toggle
on the laptop first.

| Step | Where | Clicks | Expected |
|------|-------|--------|----------|
| 1. The office wakes up | `/floors/1` | Time machine → **Jump to 08:45**, speed **10×** | Laptop dots turn green as personas arrive; Room 1.2 pre-cools (AC on) before its 09:00 booking |
| 2. New employee | `/employees/new` | Name, department, desk room `2.O`, persona *standard* → **Create**; on the register drawer press **First boot** | Laptop asset and device appear; online for a minute, then grey, then the *Asset unreachable* notification |
| 3. Ghost booking and waste | `/console` → **Ghost meeting** in `1.4`; `/automations` → set *Ghost-booking release* grace to 1 min | Within a minute Room 1.4 shows *Free* again and the organiser gets *Booking released*; Room 1.3 (AC on, nobody in) carries the *Wasting* badge and the Energy tile *Wasted today* climbs |
| 4. Lunch peak | Time machine **Jump to 12:30**; `/automations` → peak threshold **5 kW** (the office draws ~7–17 kW) | Next tick: *Shedding, step 1* on the Energy page; unoccupied rooms go dark; sign in as `viewer@` in a private window and press **Shed now** → red refusal, and `/audit` shows the `DENIED` row |
| 5. AC health | `/console` → **AC filter degrade** `AC-2.3` (the unit must be running: hold Room 2.3 on `/automations` → *Event tonight* if needed) | After ~12 min the *AC current high* alarm opens a **Check filter** task on the unit; `/energy/ac-health` shows it in *Alarm*, `/maintenance` lists the task |
| 6. The 8 PM sweep | `/console` → **Late worker stays** (Idris Barakat); time machine **Jump to 19:58**, speed **10×** | At 20:00 the sweep runs by itself: floor plan dims room by room, the run summary lists skipped rooms with reasons, zone `1.West` stays on; the phone shows *Still working in 1.West?* → tap **Leaving now** → the zone goes dark |
| 7. Morning after | Time machine **Jump to 07:05 tomorrow**, then `/reports/mornings` | The morning report appears (also as a branded email in mailpit): rooms switched off, kept on and why, kWh and cost saved (measured against the baseline) |
| 8. Insights | `/reports/energy-cost`, `/reports/savings`, `/energy/standby`, `/rooms/utilisation` | Cost per department, the baseline drop after 13 Aug, the twelve idle monitors and the coffee machine, weekday heatmaps |
| 9. Brand and language | Profile B: `beta.localhost` login; header language → **AR** | Oasis colours and logo, same data story; the shell mirrors right-to-left |
| 10. No-code edits | Profile C: device profile `ac` → alarm rule → duration 10 → **5 min**; `/automations` → *Evening sweep* time **19:00** → Save | Both take effect on the next evaluation without a restart |
| 11. Offline | Pull the network cable, refresh the browser | Everything keeps working; the request audit test proves no external host is contacted |

Reset between rehearsals: time machine **Back to real time**, `/automations` → restore the peak
threshold (150 kW) and the ghost grace (10 min), remove holds, `docker compose restart simulator`.

## Recovery

| Symptom | Action |
|---------|--------|
| Floor plan frozen, no live dots | `docker compose restart simulator` (counters continue from the platform's live state) |
| Automations not running | `docker compose restart worker`; `/automations/runs` should show a run per minute |
| A tenant's data is a mess | `make dataset TENANT=alpha DATASET=office-demo RESET=1`, then `make backfill TENANT=alpha WEEKS=12` and restart the simulator |
| IoT core unhealthy | `docker compose restart thingsboard` (about a minute); the API rebuilds live state from the core on the first requests |
| Everything | `make restore FILE=backups/before-demo.tar.gz` (stops the writers, restores the platform database and the core's volumes, starts again) |

## Likely questions

- **On-premise?** Yes: one Compose file, no cloud calls; the demo runs unplugged. Kubernetes and systemd
  notes are planned in `platform/deploy/`.
- **White-label?** Per tenant: hostname, name, colours, logo, favicon, font, emails, PDFs, page titles;
  created from the platform console at `/admin`.
- **Roles?** Tenant admin, operations manager, field operator, finance, viewer; one access matrix in the
  API, every refusal audited.
- **Real devices?** The simulator speaks the same MQTT contract a real device would; swapping in real
  lights, plugs or meters changes nothing in the platform.
- **ERP / other systems?** REST with OpenAPI at `/docs`; outbound calls go through a retried queue.
- **What is underneath?** An unmodified open-source IoT core for devices, telemetry and alarm rules; all
  business logic, people, bookings, automations and branding live in our own services.
