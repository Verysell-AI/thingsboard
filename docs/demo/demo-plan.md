# Smart Office Demo: Asset + Energy Management, built up in levels

Decision (2026-09-07): the office demo focuses on **asset management** and **energy management**, shown
under **two white-labelled tenants**. Ideas are arranged as a ladder: each level reuses what the previous
one built, so we can stop at any level and still have a coherent demo.

Implementation plan for executing agents: [plans/smart-office-demo/README.md](../../plans/smart-office-demo/README.md)
(start with its `context.md`). All devices are simulated; there is no real hardware and no mobile app.

The office model: two floors, meeting rooms, open desks, pantry, server room. Things we track:
**laptops**, **monitors and projectors**, **meeting rooms**, **lights**, **AC units**, **energy meters** per room and
per floor. Every device is simulated by the Node.js simulator (decision 2026-09-08: no real laptops, no
Raspberry Pi, no smart plugs, no mobile app); the audience should not be able to tell.

The thread running through every level: *every energy consumer is an asset, and the assets tell us whether
anyone is in the room.*

---

## Level 0 — The office as a digital twin

| Idea | What it shows |
|------|---------------|
| Floor plan with every room, desk, light, AC unit and meter placed on it; click anything to open its asset record | Asset register, location hierarchy Site → Building → Floor → Room, image map |
| Each asset has an owner, a cost, a purchase date, a warranty date and a live state | The register is the same for a laptop and an AC unit |

## Level 1 — Single things, simple states

| Idea | Behaviour | What it shows |
|------|-----------|---------------|
| **Laptop status** | Each laptop reports on/off, battery, logged-in user, Wi-Fi access point → room. Online / Offline / Warning on the floor plan | Device registry, state monitoring, location without any positioning hardware |
| **New employee laptop** | HR adds an employee → laptop asset and device created → online for 60 s → offline → "unreachable" alarm | Auto-provisioning, alarms, the ThingsBoard → backend event path |
| **Meeting room status** | Booking calendar plus a simulated occupancy sensor. Room panel shows Free / Busy / Booked | Assets that are spaces, not devices |
| **Lights and AC as assets** | Each has on/off state, power draw and a switch on its record; switching it sends a command and the meter reacts | Two-way control, RPC, role-gated action |
| **Room and floor energy meter** | Live kW, today's kWh, cost at a tariff, per room and per floor | Energy dashboard basics |
| **Projector on/off from power draw** | A plug reading above 20 W means the projector is on, even with no data connection | Inferring asset state from energy |

## Level 2 — Combine two things

| Idea | Behaviour | What it shows |
|------|-----------|---------------|
| **Laptops as occupancy sensors** | Number of laptops online in a room is the room's occupancy. No sensors needed for the whole open-plan area | Cross-referencing asset data and location |
| **Wasted energy per room** | Room empty (no laptops, sensor idle, no booking) but AC or lights running → "waste" badge and a wasted-kWh counter that keeps climbing | Occupancy × energy, a number the CFO understands |
| **Ghost-booking release** | Room booked, nobody there after 10 minutes → booking released, next person on the waiting list notified | Calendar × occupancy |
| **Auto-off when the meeting ends** | Last laptop leaves and occupancy stays zero for 15 minutes → lights and AC off in that room only | First automation, scoped to one room |
| **Misplaced laptop** | Laptop seen in a room where its custodian does not sit for more than a day → "misplaced" flag on the audit view | Custody × location |
| **Room panel with energy** | The meeting-room screen shows Free / Busy plus "this room used 3.2 kWh today, AED 1.40" | Making consumption visible where it happens |

## Level 3 — Whole-office automation (the 8 PM sweep)

| Idea | Behaviour | What it shows |
|------|-----------|---------------|
| **8 PM sweep** | For every room: any laptop online? any occupancy? any booking? If all no → switch off that room's lights and AC. Rooms skipped are listed with the reason ("Room 2.3: 1 laptop online, user A. Hassan"). Next morning a report: "17 rooms switched off, 42 kWh saved, AED 18" | The headline scenario: scheduled rule, entity query, remote commands, report |
| **Late-worker zone** | A laptop still online at 8 PM keeps only its own zone on. The user gets a notification: "Still working? We'll keep Floor 2 East on. Tap when you leave." Tapping triggers the sweep for that zone | Personalised automation, mobile push, security note for lone workers |
| **Pre-cool for the first meeting** | First booking of the day at 09:00 → AC in that room starts at 08:30, nothing else | Calendar-driven automation |
| **Lunch peak shedding** | Total load crosses the threshold between 12:00 and 14:00 → shed unoccupied rooms first, pantry second, never the server room; operator can override; chart drops | Priority-based shedding, role-gated override |
| **Weekend and holiday mode** | Calendar says holiday → whole building off except the server room and one security zone; an "event tonight" button overrides for one floor | Schedules and exceptions |
| **Anomaly at night** | A room draws twice its usual night-time load (a heater left on) → alarm with the room's asset list to find the culprit | Baseline anomaly rule |

## Level 4 — Insights and asset lifecycle

| Idea | Behaviour | What it shows |
|------|-----------|---------------|
| **Energy bill per department** | Rooms and desks mapped to departments → monthly cost allocation; Finance role sees only this report | Cost centre reporting |
| **Standby hunt** | Monitors, printers and chargers drawing 5–80 W all night, ranked with an annual cost each; "unplug or put on a switched circuit" recommendation | Small-load analytics |
| **AC health** | Runtime hours and current per AC unit; current rising at the same cooling output → filter alarm → maintenance task created on that AC unit's asset record | The asset-energy link, predictive maintenance |
| **Laptop fleet health** | Battery capacity trend per laptop → replacement forecast; laptops not switched on for 30 days → "reclaim" list; warranty expiry calendar | Asset lifecycle from live data |
| **Room utilisation** | Twelve weeks of accelerated history → heatmap by hour and weekday → "Room 3.4 used 12 %, convert to desks" | Space decisions from data |
| **Savings versus baseline** | Monthly report: kWh before automation versus after, per floor, in the tenant's brand as a scheduled PDF | The ROI slide, generated by the platform |
| **Depreciation and book value** | Every asset, including AC units and lights, depreciates; category totals on the register | Financial tracking from the BRD |

## Level 5 — Governance and white-label (shown on top of everything above)

| Idea | What it shows |
|------|---------------|
| Two tenants, two brands, two hostnames, own logos, colours, emails and PDFs; no ThingsBoard or Verysell visible | White-labelling |
| Roles: Tenant Admin, Operations Manager, Field Operator, Finance, Viewer. Viewer tries to switch off the AC and is refused | RBAC |
| Audit log with before/after for every switch command and every asset change during the demo | Immutable audit trail |
| Change the 8 PM sweep to 7 PM live in the rule editor | No-code configuration |
| Arabic RTL toggle; internet cable pulled mid-demo | Localisation, on-premise |

---

## Demo storyline (one office day in ten minutes)

1. **09:00** Floor plan lights up as laptops come online; Room 1.2 pre-cooled for the 09:00 meeting.
2. **09:30** New employee joins; laptop appears, shows in Room 2.1, custodian assigned.
3. **10:10** Room 1.4 booked but empty → released. Room 1.3 shows "waste" badge: AC on, nobody in.
4. **12:30** Lunch peak → unoccupied rooms shed first, chart drops; Viewer tries to override and is refused.
5. **15:00** AC-2F-03 current drift → filter alarm → maintenance task on its asset record, warranty still valid.
6. **20:00** The sweep runs: 17 rooms off, Room 2.3 kept on because one laptop is online; that user gets the
   "still working?" notification and taps "leaving"; the zone goes dark.
7. **Next morning** Report: energy saved, rooms switched, assets flagged, cost per department. Switch brand,
   same story, other tenant. Pull the cable, refresh, still running.

## Effort by level (one developer with Claude; two developers roughly halve it)

| Level | Cumulative weeks |
|-------|------------------|
| Base stack, seed, simulator, React shell with theming | 2 |
| Levels 0–1 | 3.5 |
| Level 2 | 4.5 |
| Level 3 | 5.5 |
| Level 4 | 7 |
| Level 5 polish, mobile notification, rehearsal | 8 |

Stopping after Level 3 already delivers the 8 PM sweep story in about five and a half weeks.

## Open questions for the boss

1. One or two developers, and the target demo date.
2. Fictional tenant brands to use (the plan currently uses "Falcon Facilities Group" and "Oasis Retail
   Holdings" as placeholders).
3. Whether the demo stops after Level 3 (the sweep) or goes through Level 5 for the first showing.

Resolved 2026-09-08: all devices are simulated; no real laptop agents, smart plugs or mobile app.
