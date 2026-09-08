# Integrated Smart Building System — workflow and architecture (summary)

Source: `Smart_Building_Solution_Workflow.docx`, "Generalized Technical Workflow & Software Architecture",
v1.0, 3 September 2026, status "Ready for Development". This is the one document that names the platform
class we are building on: its conclusion asks for a *"modern, cloud-native IoT platform (ThingsBoard-class)"*
with real-time processing, complex event correlation, multi-protocol integration, enterprise security and
24/7 resilience. Much of the document is hardware and fit-out (breakers, faucets, control-room furniture);
this summary keeps that brief and expands the software requirements.

## Objectives

- ≥15% energy reduction through circuit-level monitoring and control.
- ≥30% water reduction through sensor faucets, sub-metering and leak detection.
- Single-pane-of-glass operator dashboard integrating power, water, BMS, CCTV and access control.
- Open protocols only (Modbus, BACnet/IP, MQTT, REST, ONVIF); no vendor lock-in.
- **On-premises processing**, no mandatory cloud, **3-year data retention** at 15-minute granularity, DR failover.
- N+1 redundancy on critical systems, 99.9% uptime, health monitoring.
- **90-day (13-week) implementation** from initiation.

## Four-layer architecture

1. **Field layer**: smart circuit breakers (MCBs), power and water meters, sensor faucets and flow meters,
   leak detectors, BMS, CCTV and access control, temperature/humidity sensors.
2. **Connectivity layer**: Modbus RTU/TCP, LoRaWAN/Zigbee, BACnet/IP, MQTT, REST/webhooks, ONVIF/RTSP.
3. **Integration layer (the IoT platform)**: complex event processing, rules engine and workflow automation,
   multi-protocol gateway, data normalisation, alert management and escalation, audit logging.
4. **Presentation layer**: web operations dashboard, iOS/Android apps, video wall, operator consoles, audit and
   reporting UI. Connected over HTTPS/WebSocket.

## Package A — Smart power management

- Hardware: Modbus RTU smart MCBs (16–100 A, Class 1 metering, remote open/close, configurable trip curves,
  firmware update, per-operation audit trail); one RS-485 gateway and 24 VDC supply per distribution board;
  Dell PowerEdge R450-class server (64 GB, 4 TB RAID-6, UPS). Software examples given are **Dahua ICC / energy
  modules** licensed per gateway.
- Platform must ingest per breaker: voltage, current, active/reactive power, power factor, frequency, kWh,
  trip status and alarm flags; and send remote open/close commands (RBAC-gated).
- Workflow: survey (DB inventory, as-built drawings, BOQ, shutdown plan) → per-DB installation and
  commissioning (register gateway in platform, test trip/reset, validate metering, firmware baseline, config
  backup) → integration (Modbus register map, V/I/P alarm thresholds, remote commands, scheduled reports,
  escalation rules, **72-hour observation window**).
- KPIs: peak demand per circuit, daily kWh by end-use, power factor, THD harmonics, load factor, cost
  attribution; automated load shedding at peak; **DoE-format compliance reporting**; predictive maintenance
  triggers from trends.

## Package B — Smart water management

- Hardware: 80–100 touchless sensor faucets (≤4 L/min, 60 s auto shut-off, Estidama PBRS listed); MID Class 2
  sub-meters with Modbus RTU or pulse output (per floor cold main, per water heater); leak detection with
  acoustic/pressure sensor, **fail-safe-closed motorised solenoid on the main inlet**, pressure transducer
  backup, manual override.
- Leak logic: continuous monitoring → on leak pattern send dashboard alert, SMS/email escalation, close
  solenoid, log incident; manual reset required.
- Workflow: faucet and meter survey (faucet register deliverable, pressure > 2 bar, power availability) →
  floor-by-floor replacement and metering → leak system commissioning → integration (Modbus registry, per-floor
  dashboards, daily/weekly limits, before/after report, auto shut-off scenarios, 30-day trend, 72-hour
  observation) → **performance validation of ≥30% saving with Estidama PBRS evidence**.

## Package C — Central command and control room

ISO 11064 ergonomic control room: 25–35 m², two sit-stand operator consoles with dual 27" monitors, 2×2 55"
video wall with controller and preset layouts, managed L2/3 switch with PoE, KVM-over-IP, dual ISP, NGFW with
IDS/IPS on an OT VLAN, 10 kVA UPS, N+1 HVAC, 42U rack, fire detection and clean-agent suppression, card access,
CCTV, structured Cat6A/fibre cabling, raised floor, acoustic treatment, lighting spec. Software impact: the
dashboard must drive a video wall and operator consoles in a 24/7 setting.

## Package D — Unified integration platform (core software scope)

### Protocols and direction

| Device type | Protocol | Direction | Gateway |
|-------------|----------|-----------|---------|
| Smart MCBs | Modbus RTU | Bidirectional | Modbus-TCP gateway |
| Water meters | Modbus RTU / pulse | Read-only | Modbus-TCP gateway |
| Leak sensors | LoRaWAN / Zigbee | Read-only | LoRa/Zigbee gateway |
| BMS | BACnet/IP | Bidirectional (gated) | BACnet-IP router |
| CCTV | ONVIF / RTSP | Read-only | ONVIF gateway |
| Access control | Wiegand-over-IP | Event log only | Native IP |
| Future cloud | REST / MQTT | Outbound telemetry | Native |

Platform components named: protocol translators (Modbus→MQTT, BACnet→REST), normalisation engine,
time-series DB, CEP, rules and workflows, alert manager, historian and reporting; outbound APIs/webhooks to
enterprise energy management, CMMS, billing and compliance reporting (DoE, PBRS).

### Example CEP rules the platform must express

1. **Energy peak**: total power > 150 kW between 12:00–14:00 → yellow alert, recommend shedding non-critical
   circuits, log; escalate if sustained > 30 min.
2. **Water leak**: main inlet flow > baseline + 50% for > 10 min and no scheduled maintenance → red critical
   alert, close solenoid, SMS facilities team, **open CCTV playback of last 30 min**, auto-create incident
   ticket; manual override to resume.
3. **Predictive maintenance**: MCB trips > 3/day or power factor < 0.85 for 7 days → orange alert, diagnostics
   report, schedule inspection, log degradation, recommend replacement.
4. **BMS correlation**: power spike + HVAC load up ≥30% + temperature drift → cross-reference BMS logs, identify
   cause, recommend setpoint change, compute energy impact.

### Mandatory dashboard capabilities

- **Executive**: energy kWh and water m³ today/week/month, peak kW with timestamp, top 5 circuits, active
  alarms by priority, health of every gateway/sensor, uptime %, cost impact (kWh × rate, m³ × rate).
- **Energy drill-down**: floor → circuit with colour coding, 15-minute trend graphs with ≥3-year retention,
  demand vs consumption on one chart, power factor, THD, peak-shaving opportunities.
- **Water drill-down**: floor cold + hot, per-faucet heat map, meter readings, live leak status, trends,
  estimated % reduction.
- **Alarms**: Info / Warning / Critical, acknowledgement workflow, escalation auto-assignment, full audit
  trail, auto-remediation triggers, mobile push for critical.
- **Reporting**: scheduled daily/weekly/monthly/annual with auto-email; PDF/Excel/CSV; DoE energy template;
  Estidama PBRS water evidence; drag-drop custom report builder; export to ERP/CMMS.
- **Mobile**: swipeable KPI cards, alarm list with push, **manual MCB control gated by RBAC**, water alerts,
  offline cached data, O&M document access, emergency contacts.

### Security architecture (defence in depth)

OT VLAN isolation, NGFW with IDS/IPS and deep packet inspection, DMZ for public APIs; signed firmware, no
default passwords, TLS 1.2+, certificate pinning, secure boot; AES-256 credential vault, HSM, **90-day
credential rotation**, break-glass access; **RBAC with at least five roles (Admin, Engineer, Operator, Viewer,
Auditor)**, MFA, SSO via AD/LDAP/Okta, session timeouts, geo-fencing critical operations to the local network;
quarterly OWASP scans, annual external pen-test, SIEM integration, incident playbook, **NESA UAE IA Standard**
audit trail.

## Package E — Training, documentation, support

Four tracks: Operator (3 days), Engineer (5 days, includes API and custom integration development),
Administrator (3 days: RBAC, AD/LDAP, backup/restore, rules engine, notifications, escalation, scheduled
reports, exports, audit retention), Refresher (1 day at 6 months). Handbooks in **English and Arabic**.
Deliverables include integration point list (every Modbus register, BACnet object, API endpoint),
configuration templates, dashboard and rules-engine backups, historical data export, FAT/SAT reports, 72-hour
reliability run results, performance validation evidence, and all licences registered in the owner's name.

## Implementation roadmap (90 days)

Weeks 1–2 mobilisation and site survey → 2–4 design and procurement → 4–9 installation (A, B, C in parallel)
→ 9–12 integration and testing (FAT, pre-commissioning, SAT, 72-hour reliability run, KPI validation) → 12–13
training and handover with Taking-Over Certificate. Critical path: design approval → MCB procurement →
installation → testing.

## Recommended technology stack (from the document)

IoT OS "Dahua ICC or equivalent" with Modbus/BACnet/MQTT, CEP, historian on **TimescaleDB**, REST API;
PostgreSQL for master data, **Redis** for real-time alerting; Modbus gateway, BACnet router, **LoRaWAN network
server**, MQTT broker, optional Kong/WSO2 API gateway. Frontend React 18+ or **Angular 15+**, ApexCharts or
Chart.js, WebSocket, Nginx; mobile React Native or Flutter with Firebase push and SQLite offline. Dual ISP,
Palo Alto/Fortinet/Cisco NGFW, OT VLAN 10.0.x.x, WPA3 + RADIUS Wi-Fi, SSH keys, Kerberos/LDAP, annual
certificate rotation.

## Risk register highlights

Site quantities differ from baseline (±10% accepted); business disruption during installation (off-hours,
floor-by-floor, rollback); BMS integration issues (read-first shadow mode, vendor engaged early, custom
gateway fallback); cybersecurity findings (patch within 72 hours); long-lead equipment (early procurement,
approved alternates, 2-week buffer).

## Relevance to the new platform

This is the most natural fit for ThingsBoard: Modbus/BACnet/LoRaWAN ingestion through gateways, MQTT,
time-series storage, rule chains, alarms with acknowledgement and escalation, dashboards with drill-down,
scheduled reports and RPC commands to breakers. Gaps to note: bidirectional BACnet, ONVIF/CCTV playback
triggered from a rule, video-wall layouts, DoE and Estidama report templates, an Auditor role, and the
security posture items (HSM, 90-day rotation, SIEM, NESA compliance evidence).
