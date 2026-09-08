# Office Demo Ideas for the DCS Pitch

> Decision 2026-09-07: the demo focuses on asset management + energy management under two white-labelled tenants. See [demo-plan.md](demo-plan.md). The ideas below are kept for reference.

Purpose: show DCS what we can deliver on a ThingsBoard-based platform before detailed requirements exist.
Constraint: no reliable hardware in the office, so every idea runs on **simulated devices with scripted
behaviour** plus a **seeded demo database**, with **real phones** for scanning and the mobile app. Optional cheap
hardware is noted where it would make a demo more tangible.

How the mock layer works: a Node.js simulator holds one MQTT client per virtual device and runs a small
state-machine script per device (connect, publish, drift, fault, disconnect, answer remote commands). A seed
script creates tenants, users, the location hierarchy, devices, dashboards and rule chains from JSON so every
demo starts from the same state. A **demo controller page** gives the presenter buttons such as "New employee
joins", "Fire drill", "Leak" to trigger events live.

Effort: **S** = 1–2 days, **M** = 3–5 days, **L** = 1–2 weeks, on top of the shared base (platform running,
seed script, simulator skeleton, React shell with login and one tenant: about 2 weeks).

Recommended pick per domain is marked ★.

---

## 1. Core asset tracking (their FATS replacement, every vertical)

| | Idea | Story on stage | What DCS sees | Effort |
|--|------|----------------|---------------|--------|
| ★ | **New employee laptop lifecycle** | HR adds an employee in the React app → laptop device auto-created → simulator brings it online for 60 s (battery, user, Wi-Fi access point = room) → goes offline → alarm "asset unreachable" → later "asset left site" | Device registry, Online/Offline states, location from network, alarms, audit trail, ThingsBoard → backend event path | S |
| | **QR audit on a phone** | Print QR labels for real office laptops and chairs. Presenter walks the room with the mobile app in airplane mode: Found / Missing / Misplaced live, then reconnects and syncs. Missing item triggers a self-audit email to its custodian | Stock-take workflow, offline mobile sync, self-audit, the FATS features they already sell | M |
| | **Transfer with approval and gate pass** | Field user requests moving a monitor to another floor with photo → manager approves on web → gate pass PDF → temporary transfer overdue alert fires two minutes later (accelerated clock) | Multi-approver workflow, documents, overdue rules | M |
| | **External booking** | A "visitor" books the projector from a link without an account; the booking shows on the asset calendar and blocks a second booking | Their stated differentiator | S |

## 2. Retail

| | Idea | Story on stage | What DCS sees | Effort |
|--|------|----------------|---------------|--------|
| ★ | **Store cycle count vs POS** | Simulated handheld and fixed readers count 500 tagged garments; a mocked POS feed says 512 → variance report by size and colour, out-of-stock positions highlighted, reorder rule creates a purchase recommendation | Cycle count analytics, POS reconciliation, rule → action, report export | M |
| | **Loss prevention gate** | Simulated exit gate reads an unpaid tag → Critical alarm with the tag's last zone, dashboard flashes, SMS to security | Unauthorised-exit rule, alert routing by severity | S |
| | **Product recall** | Presenter enters a batch number → map shows every unit across three simulated stores and a warehouse | Recall management, multi-site query | S |
| | **Pantry as a shelf** (optional real) | Barcode-scan snacks in and out with a phone; stock ageing and ABC analysis on what nobody eats | Item master, stock ageing, humour that lands | S |

## 3. Healthcare

| | Idea | Story on stage | What DCS sees | Effort |
|--|------|----------------|---------------|--------|
| ★ | **Vaccine fridge cold chain** | Simulated fridge holds 4 °C, door-open event, temperature climbs to 9 °C → Warning then Critical → nobody acknowledges → escalates to the manager → work order auto-created → technician closes it on the phone with a photo → scheduled PDF compliance report | Environmental monitoring, alarm ack/escalation, alarm → work order, scheduled reporting, mobile | M |
| | **Wheelchair and infusion-pump RTLS** | BLE beacons move room to room on the hospital floor plan (simulated anchors); rule "pump left the ward" fires; Find-It shows proximity to the nearest one | Indoor positioning on image map, geofence, Find-It | M |
| | **Patient wristband mustering** | On "Evacuate ward", wristbands report at the assembly point; board shows who is missing | RTLS headcount, live dashboard | S (shares code with Oil & Gas mustering) |
| | **Sterilisation tray cycles** | Autoclave cycle counter on tagged instrument trays, alarm when a tray is used past its cycle limit | Usage-based maintenance rule | S |

## 4. Logistics & Ports

| | Idea | Story on stage | What DCS sees | Effort |
|--|------|----------------|---------------|--------|
| ★ | **Dock door receiving** | Simulated dock reader emits a burst of 40 tag reads with duplicates and two unexpected EPCs → deduplicated → auto-matched to a purchase order → GRN created with a discrepancy flag → supervisor approves on web → stock cards update → AMS/ERP webhook fires | RFID pipeline, dedup, GRN, approvals, ERP integration path (the Smart Warehouse document end to end) | M |
| | **Delivery van** | Replay a recorded GPS track around the office district: live map, geofence around the "customer site", over-speed alert, ETA, trip replay with the timeline scrubber | Fleet tracking, geofences, route playback | S |
| | **Cold-chain shipment** | Reefer container temperature linked to the shipment; excursion during transit shows on the shipment record | Track-and-trace plus sensor data | S |
| | **Truck gate check-in** | Truck RFID/QR at the gate → appointment matched → bay assigned on the dock board → departure logged | Yard management, dock board | M |

## 5. Oil & Gas

| | Idea | Story on stage | What DCS sees | Effort |
|--|------|----------------|---------------|--------|
| ★ | **Personnel mustering drill** | Presenter presses "Fire drill" → 30 simulated badges arrive at two muster points over 90 seconds, two never arrive → board turns green name by name, missing names red, supervisor gets SMS with their last known zone | Mustering, RTLS, live dashboard, alert routing; very visual | S |
| | **Permit-to-work zone gate** | Worker badge without a valid permit enters a hazardous zone → entry alarm and permit record shown side by side | Zone rules joined with business data from our backend | S |
| | **Tool crib in a hazardous area** | Ex-rated tool checked out to a worker, calibration due date passes → tool flagged, check-out blocked | Check-in/out, calibration tracking | S |

## 6. Manufacturing / Industry 4.0

| | Idea | Story on stage | What DCS sees | Effort |
|--|------|----------------|---------------|--------|
| ★ | **Machine OEE from a simulated PLC** | A simulated OPC-UA or Modbus machine (or the real office printer via SNMP) reports state, cycle count and rejects → availability, performance, quality gauges → a stall every 20 minutes drops OEE → predictive-maintenance rule after three stalls | Industrial protocol ingestion via the IoT Gateway, OEE dashboard, trend rules | M |
| | **WIP tracking through production stages** | Tagged items scanned at Cut → Assemble → Test → Pack stations; production order board fills up; a batch stuck at Test raises an alert | Work-in-progress and production orders | M |
| | **Kanban bin replenishment** | Bin weight or count drops below minimum → replenishment request and purchase recommendation | Threshold rules → business action | S |

## 7. Smart Building (their power / water / control-room packages)

| | Idea | Story on stage | What DCS sees | Effort |
|--|------|----------------|---------------|--------|
| ★ | **Smart breakers and peak shedding** | Simulated distribution boards with per-circuit V, I, kW, kWh; total crosses 150 kW at lunch → Yellow alert → operator clicks "shed non-critical circuits" → remote open command → load drops → daily energy report in the DoE-style template | Modbus-style data, remote control gated by role, energy dashboard, compliance report | M |
| | **Water leak auto shut-off** | Main inlet flow jumps 50 % above baseline for 10 minutes → Critical alarm → solenoid close command → SMS → incident ticket → manual reset required | Their exact CEP rule, auto-remediation | S |
| | **Control-room video wall** | The office TV in kiosk mode rotating executive, energy and water dashboards with the alarm feed pinned on top | Their Package C without the furniture | S |
| | **BMS correlation** | Power spike plus HVAC load plus temperature drift → rule cross-references and recommends a setpoint change | Multi-signal correlation | S |

Optional real hardware for this domain: two Wi-Fi smart plugs with power metering (about USD 40) make the
"switch off the coffee machine from the dashboard" moment real.

## 8. Facilities management (CAFM, with their partner Urbanise)

| | Idea | Story on stage | What DCS sees | Effort |
|--|------|----------------|---------------|--------|
| ★ | **Report-an-issue to closed work order** | QR code in a meeting room opens a request page → work order with SLA timer → technician accepts on the phone, pre-start safety checklist, photo, customer signature → SLA dashboard; a second ticket is left to breach its SLA and escalates | Reactive maintenance, SLA timers, safety gate, customer portal, mobile | M |
| | **Planned maintenance planner** | 12-month planner auto-generates AC filter jobs per floor; one is overdue and shows on the compliance dashboard | PPM templates and planner | M |
| | **Contractor compliance expiry** | A contractor's insurance certificate expires next week → alert, and they cannot be assigned new jobs | Supplier compliance | S |

## 9. Smart Office (the bundle chosen for the demo, with white-labelling)

"Smart office" is our own building treated as the customer site: assets, energy, rooms, comfort, safety and
maintenance, all shown under two brands. Everything below runs on simulated sensors; items marked (real) are
cheap to make tangible. Grouped by the problem an office manager actually has.

### Energy and cost

| Idea | Problem solved | Story on stage | Effort |
|------|----------------|----------------|--------|
| **After-hours auto-off** | Lights and AC left running overnight | At 20:00 rule checks occupancy, finds Floor 2 empty, switches its lighting and AC circuits off; overnight kWh drops on the chart; exception list for rooms flagged "do not switch" | S |
| **Per-department energy bill** | Nobody owns the energy cost | Circuits mapped to departments; monthly cost allocation report per cost centre; Finance role sees only that report | S |
| **Standby power hunt** | Equipment drawing power while idle | Rule flags circuits with a constant 30–80 W draw all night; ranks the top ten "vampires" | S |
| **Peak shedding** (from Smart Building) | Demand charges at lunch peak | Total crosses threshold, operator or rule sheds non-critical loads by remote command (real with two smart plugs) | M |
| **AC predictive maintenance** | Units fail in summer | Compressor runtime hours and current draw per unit; rising current at the same cooling output flags a dirty filter; work order created | S |

### Space and rooms

| Idea | Problem solved | Story on stage | Effort |
|------|----------------|----------------|--------|
| **Ghost-booking release** | Rooms booked but empty | Room booked 10:00–11:00, occupancy sensor sees nobody by 10:10, booking auto-released and the waiting list notified | S |
| **Find a free desk** | Hot-desking chaos | Desk occupancy on the floor plan, green/red in real time; phone app shows nearest free desk with a monitor | M |
| **Space utilisation report** | Paying for floor space nobody uses | Twelve weeks of accelerated occupancy history; heatmap by hour and weekday; report says "Floor 3 averages 31 %, consolidate" | S |
| **Occupancy-driven ventilation** | Stuffy meeting rooms | CO₂ rises above 1000 ppm with eight people inside; rule raises the AHU setpoint for that zone; CO₂ falls; comfort score on the dashboard | S |
| **Visitor and wayfinding kiosk** | Visitors lost, unescorted | Visitor gets a QR badge at reception, kiosk shows the route to the meeting room; badge seen in a restricted zone raises an alert | M |

### Comfort and health

| Idea | Problem solved | Story on stage | Effort |
|------|----------------|----------------|--------|
| **Comfort complaints correlated with data** | "It's always cold here" arguments | Complaint submitted via QR in the room is stored next to the room's temperature and humidity trend; facilities sees the pattern and adjusts the setpoint | S |
| **Air-quality board** | Invisible air problems | CO₂, PM2.5, temperature, humidity, noise per zone with a traffic-light index on the lobby TV | S |
| **Server-room watch** | IT room overheats or floods | Temperature, humidity, door-open, leak sensor and UPS battery (UPS via SNMP, which ThingsBoard supports natively); door open longer than 5 minutes and temperature above 27 °C escalate | S |

### Assets and IT

| Idea | Problem solved | Story on stage | Effort |
|------|----------------|----------------|--------|
| **New employee laptop lifecycle** (core pick) | Nobody knows where company devices are | Laptop auto-registered, online for a minute, offline, alarm, "left site" later | S |
| **Shared equipment pool** | Projectors and cameras go missing | Book, check out with photo, overdue reminder, return inspection; external booking link for visitors | M |
| **Loaner laptop pool** | IT lends laptops and loses track | Pool dashboard: available, on loan, overdue, in repair; loan ties to the employee record | S |
| **Printer consumables auto-reorder** | Toner runs out on deadline day | Real office printer polled over SNMP; toner below 15 % raises a purchase recommendation; page counts feed a per-department print report | S |
| **After-hours asset movement** | Equipment walks out at night | BLE-tagged monitor moves zones after 19:00 while its custodian's badge is not on site; Critical alarm with last zone | S |
| **Annual IT audit** | Weeks of manual counting | Phone QR audit per room, Found / Missing / Misplaced live, offline mode, discrepancy report emailed | M |

### Facilities and maintenance

| Idea | Problem solved | Story on stage | Effort |
|------|----------------|----------------|--------|
| **Report-an-issue to closed work order** (CAFM pick) | Broken AC reported by email chains | QR in the room, work order, SLA timer, safety checklist, photo, signature, SLA breach escalation | M |
| **Cleaning on demand** | Restrooms cleaned on a fixed schedule regardless of use | Door counter reaches 40 visits since last clean → cleaning task to the on-duty cleaner's phone; consumable refill reminders from dispenser counters | S |
| **Pantry fridge cold chain** | Spoiled food, and the same pattern as a vaccine fridge | Temperature excursion, escalation, auto work order, compliance PDF | M |
| **Coffee machine as a machine** | Machines fail without warning | Shot counter and boiler temperature; descaling due every N shots; failure prediction when brew time drifts | S |
| **Leak under the pantry sink** | Water damage found on Monday | Leak sensor → Critical alarm → simulated valve closed → SMS → incident ticket; manual reset required | S |
| **Smart bins** | Overflowing bins or wasted collection rounds | Fill level per bin; collection route only for bins above 70 % | S |
| **Compliance items on the wall** | Expired extinguishers, sealed AED not checked | Extinguishers, first-aid kits, AED as assets with inspection intervals; calendar shows overdue; monthly QR inspection round on the phone | S |

### Safety and security

| Idea | Problem solved | Story on stage | Effort |
|------|----------------|----------------|--------|
| **Mustering drill** (Oil & Gas pick, office version) | Who is still inside during an evacuation | "Fire drill" button, badges arrive at the assembly point, two missing shown in red with last zone | S |
| **Door held open** | Secure doors propped open | Door contact open longer than 60 s after hours → alarm, camera snapshot link (simulated) | S |
| **Lone worker after hours** | One person on a floor late at night | Presence detected on Floor 3 after 22:00 with a single badge → welfare check notification to security | S |
| **Parking and EV charging** | Full car park, chargers tripping the supply | Slot occupancy board at the entrance; EV chargers share a power budget and are throttled during the lunch peak | M |

### Sustainability reporting

| Idea | Problem solved | Story on stage | Effort |
|------|----------------|----------------|--------|
| **Monthly ESG report** | Manual spreadsheets for carbon and water | kWh, m³ water, waste weight converted to CO₂e per month and per head; scheduled PDF in the client's brand | S |

### Privacy note

Desk, badge and lone-worker scenarios track people. Show them with pseudonymous badge IDs and a
role-restricted "reveal identity" action that is written to the audit log, so the demo also demonstrates
GDPR-style controls rather than raising the question unanswered.

### Suggested Smart Office storyline (about 4 weeks on top of the base)

A day in the office, told in ten minutes: morning **find a free desk** and **occupancy-driven ventilation**,
a **new employee's laptop** appears and later goes missing, lunch **peak shedding**, afternoon **AC complaint
becomes a work order**, **fridge excursion escalates**, evening **after-hours auto-off** and a **door held
open** alert, and a closing **space utilisation and ESG report**. Run it twice: once as the hospital brand,
once as the retailer brand, same platform.

---

## Cross-cutting features to show regardless of domain

- **On-premise**: whole stack in Docker on one office machine, internet cable pulled mid-demo; a "site edge"
  container that buffers events while disconnected and syncs when reconnected; backup and restore.
- **Multi-tenant and white-label**: two demo tenants (a hospital and a retailer) with different logos and
  colours, users who cannot see each other's data.
- **RBAC and audit**: a read-only viewer versus an operations manager; the audit log with before/after values.
- **No-code rules**: build or edit one rule live in front of them.
- **Arabic RTL** toggle on the React app.
- **Time acceleration**: generate three months of history in seconds for the reports and depreciation views.

## Suggested shortlist if we do one per domain

| Domain | Pick | Effort |
|--------|------|--------|
| Core asset tracking | New employee laptop lifecycle (+ QR audit on a phone if time allows) | S (+M) |
| Retail | Store cycle count vs POS | M |
| Healthcare | Vaccine fridge cold chain | M |
| Logistics | Dock door receiving | M |
| Oil & Gas | Personnel mustering drill | S |
| Manufacturing | Machine OEE from a simulated PLC | M |
| Smart Building | Smart breakers and peak shedding | M |
| Facilities | Report-an-issue to closed work order | M |

Shared base about 2 weeks, then roughly 6 to 7 weeks for all eight picks with one developer plus Claude; two
developers halve that. A minimum viable pitch is the base plus the laptop lifecycle, fridge cold chain,
mustering drill and dock door receiving: about 4 weeks, and it already touches five of their eight domains.
