# Smart Office demo — runbook

The presenter's screen-by-screen script is [demo-script.md](demo-script.md); this file is the checklist
around it.

The stack lives in `platform/` and runs on one machine with Docker Compose, either the demo box behind
`dcs.verysell.ai` or a laptop. Everything the audience sees is served from that machine: one hostname per
tenant and the bare host for the platform console and the phone view. Locally those are
`alpha.localhost:8081` and `beta.localhost:8081`, and no internet is needed once the images are built.

## Demoing from the deployed site

The hosted demo is already provisioned and backfilled: `https://dcs.verysell.ai` (platform console),
`https://alpha.dcs.verysell.ai` and `https://beta.dcs.verysell.ai`. Use it instead of a local stack unless
you need to rebuild from scratch; the rest of this file then applies on the box, reached with
`ssh -i key.pem ubuntu@18.141.47.14` and `cd platform`.

Two services bind to loopback on the box and are not public. Open a tunnel for them and keep it running:

```
ssh -i key.pem -L 8025:127.0.0.1:8025 -L 8090:127.0.0.1:8090 ubuntu@18.141.47.14
```

Mailpit is then `http://localhost:8025` and the IoT core UI `http://localhost:8090`. Credentials for the
deployed site come from `platform/.env.dev`, not `platform/.env`.

## Before the demo (the evening before, about 25 minutes)

Local stack only; skip this section when demoing from the deployed site.

1. `cd platform && make down && make up` — clean stack; wait for "healthy".
2. `make provision TENANT=alpha` and `make provision TENANT=beta`.
3. `make dataset TENANT=alpha DATASET=office-demo` and the same for `beta`.
4. `make backfill TENANT=alpha WEEKS=12` and the same for `beta` (about a minute each), then
   `docker compose restart simulator` so the meters continue from the backfilled counters.
5. Open `http://alpha.localhost:8081/console` as `admin@alpha.demo`: **Back to real time** on the time
   machine, then **Everyone leaves** is _not_ pressed yet.
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

Times are the _business clock_ shown in the header; the time machine moves it, telemetry stays on the real
clock. **The office is closed on Saturday and Sunday**: no persona comes in, so every laptop is offline and
scenarios that need a laptop ("Move a laptop", the sweep's late-worker zone) show nothing. On a weekend, jump
the time machine to a weekday hour (tick _tomorrow_ on a Sunday) or use the console's **Bring online** toggle
on the laptop first.

| Step                       | Where                                                                                                                               | Clicks                                                                                                                                                                                                                           | Expected                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1. The office wakes up     | `/floors/1`                                                                                                                         | Time machine → **Jump to 08:45**, speed **10×**                                                                                                                                                                                  | Laptop dots turn green as personas arrive; Room 1.2 pre-cools (AC on) before its 09:00 booking            |
| 2. New employee            | `/employees/new`                                                                                                                    | Name, department, desk room `2.O`, persona _standard_ → **Create**; on the register drawer press **First boot**                                                                                                                  | Laptop asset and device appear; online for a minute, then grey, then the _Asset unreachable_ notification |
| 3. Ghost booking and waste | `/console` → **Ghost meeting** in `1.4`; `/automations` → set _Ghost-booking release_ grace to 1 min                                | Within a minute Room 1.4 shows _Free_ again and the organiser gets _Booking released_; Room 1.3 (AC on, nobody in) carries the _Wasting_ badge and the Energy tile _Wasted today_ climbs                                         |
| 4. Lunch peak              | Time machine **Jump to 12:30**; `/automations` → peak threshold **5 kW** (the office draws ~7–17 kW)                                | Next tick: _Shedding, step 1_ on the Energy page; unoccupied rooms go dark; sign in as `viewer@` in a private window and press **Shed now** → red refusal, and `/audit` shows the `DENIED` row                                   |
| 5. AC health               | `/console` → **AC filter degrade** `AC-2.3` (the unit must be running: hold Room 2.3 on `/automations` → _Event tonight_ if needed) | After ~12 min the _AC current high_ alarm opens a **Check filter** task on the unit; `/energy/ac-health` shows it in _Alarm_, `/maintenance` lists the task                                                                      |
| 6. The 8 PM sweep          | `/console` → **Late worker stays** (Idris Barakat); time machine **Jump to 19:58**, speed **10×**                                   | At 20:00 the sweep runs by itself: floor plan dims room by room, the run summary lists skipped rooms with reasons, zone `1.West` stays on; the phone shows _Still working in 1.West?_ → tap **Leaving now** → the zone goes dark |
| 7. Morning after           | Time machine **Jump to 07:05 tomorrow**, then `/reports/mornings`                                                                   | The morning report appears (also as a branded email in mailpit): rooms switched off, kept on and why, kWh and cost saved (measured against the baseline)                                                                         |
| 8. Insights                | `/reports/energy-cost`, `/reports/savings`, `/energy/standby`, `/rooms/utilisation`                                                 | Cost per department, the baseline drop after 13 Aug, the twelve idle monitors and the coffee machine, weekday heatmaps                                                                                                           |
| 9. Brand and language      | Profile B: `beta.localhost` login; header language → **AR**                                                                         | Oasis colours and logo, same data story; the shell mirrors right-to-left                                                                                                                                                         |
| 10. No-code edits          | Profile C: device profile `ac` → alarm rule → duration 10 → **5 min**; `/automations` → _Evening sweep_ time **19:00** → Save       | Both take effect on the next evaluation without a restart                                                                                                                                                                        |
| 11. Offline                | Pull the network cable, refresh the browser                                                                                         | Everything keeps working; the request audit test proves no external host is contacted                                                                                                                                            |

Reset between rehearsals: time machine **Back to real time**, `/automations` → restore the peak
threshold (150 kW) and the ghost grace (10 min), remove holds, `docker compose restart simulator`.

## Recovery

Run these where the stack is: on the demo box after `ssh -i key.pem ubuntu@18.141.47.14 && cd platform`.

| Symptom                         | Action                                                                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Floor plan frozen, no live dots | `docker compose restart simulator` (counters continue from the platform's live state)                                                   |
| Automations not running         | `docker compose restart worker`; `/automations/runs` should show a run per minute                                                       |
| A tenant's data is a mess       | `make dataset TENANT=alpha DATASET=office-demo RESET=1`, then `make backfill TENANT=alpha WEEKS=12` and restart the simulator           |
| IoT core unhealthy              | `docker compose restart thingsboard` (about a minute); the API rebuilds live state from the core on the first requests                  |
| Everything                      | `make restore FILE=backups/before-demo.tar.gz` (stops the writers, restores the platform database and the core's volumes, starts again) |

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
