# DCS IoT & Asset Management Platform — Business Requirements Document (summary)

Source: `DCS_Platform_BRD_v2 SmartDev.docx` (footer says BRD v1.0, Confidential). This is the client's master
requirements document; everything else in this folder elaborates on parts of it.

## Purpose and positioning

DCS wants a multi-tenant, no-code IoT platform that turns RFID, BLE, GPS, barcode and sensor data into
dashboards, automated workflows and forecasts, and that replaces and extends their existing Fixed Asset
Tracking System (FATS). Requirements come from their product experience, market research and a competitive
feature analysis; the stated goal is feature parity or better versus the leading asset-tracking IoT platforms.

In scope: multi-tenant SaaS with white-label and on-premise options; ingestion from RFID/BLE/GPS/barcode/
environmental sensors; no-code rule engine and alerts; asset lifecycle from registration to disposal;
inventory and supply chain; mapping, indoor positioning and fleet; SAP/Oracle/Dynamics/WMS/ITSM integrations;
five vertical modules; native iOS and Android apps; reporting, dashboards and AI/ML forecasting.

Deployment options: cloud (AWS/Azure/GCP, HA + DR + auto-patching), on-premise (same feature set), hybrid
(edge processing on site, analytics in cloud).

Priority scale used below: **M** = Must, **S** = Should, **C** = Could. Where the source table has no priority
column the item is listed without one.

## Module 1 — Platform foundation and multi-tenancy

| Feature | Detail | Pri |
|---------|--------|-----|
| Schema-per-tenant isolation | Dedicated PostgreSQL schema per organisation plus row-level security | — |
| Tenant onboarding wizard | Self-service: org name, logo, timezone, currency, industry vertical, feature flags | — |
| White-label | Custom domain, colour theme, logo per tenant (reseller and enterprise branding) | — |
| Tenant feature flags | Enable/disable each vertical module per tenant | — |
| Hierarchical tenancy | Root → Tenant → Site with cascading config inheritance; site overrides tenant defaults | — |
| Email/password + MFA | bcrypt, TOTP and SMS OTP | M |
| SSO | OAuth 2.0 and SAML 2.0; Google and Microsoft social login | M |
| RBAC | Built-in roles Super Admin, Tenant Admin, Operations Manager, Field Operator, Read-Only Viewer; custom role builder with granular permission matrix | M |
| Session management and audit | JWT refresh tokens, per-device sessions, forced remote logout, immutable log of login and permission events | M |
| AD / LDAP sync | Automated provisioning and de-provisioning | S |
| User management | Email invitations with role at invite; profile (name, photo, department, language); CSV bulk import with role mapping; per-user activity feed and last-seen | — |

## Module 2 — Device and hardware management

- **Device registry**: onboarding wizard for RFID readers, GPS trackers, BLE beacons, barcode scanners,
  environmental sensors and gateways (type, location, serial, firmware). Status states Online / Offline /
  Warning / Maintenance with heartbeat, signal strength and battery. Device groups by floor, zone, building,
  warehouse bay. Bulk import by CSV or QR scan.
- **Vendor-agnostic hardware (core design principle)**: UHF RFID fixed readers (Zebra FX, Impinj Speedway,
  Alien) and handhelds (Zebra, Honeywell, TSL), tunnels and antenna arrays; iBeacon / Eddystone / BLE RTLS
  gateways; GPS trackers (Teltonika FMB, Queclink, Coban); temperature/humidity, CO₂, vibration, pressure,
  door sensors; 1D/2D scanners over USB/Bluetooth and camera scanning in the app; Modbus RTU/TCP and OPC-UA.
- **MQTT broker and ingestion**: built-in broker (Mosquitto or EMQX named as examples), topic hierarchy
  `{tenantId}/{locationId}/{deviceId}/telemetry`, QoS 0/1/2; mTLS device certificates; an **edge processing
  layer** that de-duplicates, adds location context and buffers offline; ingestion via MQTT, HTTP webhook,
  TCP socket, REST and SFTP file drop.
- **Tag and label management**: RFID tag registry (EPC, item link, write history, Active/Lost/Disposed); bulk
  tag encoding with auto-generated EPCs; tag-to-asset/personnel/vehicle linking; LPN generation with ZPL/EPL
  print queue and printer dashboard; drag-and-drop label designer for Zebra and Honeywell printers.

## Module 3 — Real-time data processing

Event streaming on Kafka or RabbitMQ with hot/warm/cold retention tiers per tenant; normalisation of
vendor protocols into one event schema with automatic enrichment (location name, item description, zone);
deduplication window for tag reads; WebSocket feed where clients subscribe by device, location or event type
with **target latency under 500 ms** and a 60-second replay buffer on reconnect; dead-letter queue for
unparseable messages.

## Module 4 — Rule engine and automation

- **No-code visual rule builder**: IF/THEN/ELSE with triggers for device events (tag read, zone transition,
  threshold), cron schedules, manual button and inbound webhook. Operators: equals, not equals, greater/less
  than, contains, in range, regex; AND/OR/NOT with nested groups. Actions: email, SMS, push, work order
  creation, webhook/REST call, ERP write, asset status update, report generation, rule chaining.
- Pre-built templates: geofence breach, reorder threshold, cold-chain exceedance, unauthorised exit, truck
  dock check-in, escalation chains, industry packs.
- Rule versioning (save, revert, duplicate) and **event simulation** before activation. Full execution log of
  every trigger, condition result and action.
- **Alert management**: four severities (Info, Warning, Critical, Emergency) routed by severity, location or
  asset category to user groups; acknowledge, comment, resolve; auto-escalation after timeout; MTTR, frequency
  trends and top-source analytics.

## Module 5 — Mapping and location intelligence

| Feature | Detail | Pri |
|---------|--------|-----|
| Multi-layer map | Leaflet.js, satellite and street tiles, indoor floor plan overlay (SVG/PNG) with alignment tools | — |
| Real-time pins | Icon/colour/label per category, clustering with click-to-expand | — |
| Zone / geofence engine | Polygon, circle, rectangle; rules on entry, exit, overstay | — |
| Heat maps and path replay | Density and dwell-time heatmaps; movement trail with timeline scrubber | — |
| Map reports | PDF/PNG snapshot export; shareable live links with optional password | — |
| BLE triangulation | Zone-level indoor positioning, ~3–5 m with anchors and tags | M |
| RFID zone detection | Occupancy counts from antenna placement and RSSI | M |
| Multi-floor tracking | Elevator and stairwell detection | C |
| Real-time vehicle map | Live GPS, fleet list with driver, last location, speed, ignition | M |
| Route playback and geofence alerts | Trip replay; entry/exit notifications for warehouses, ports, sites | M |
| Idle and over-speed alerts | Configurable thresholds | S |
| ETA calculation | Google Directions or OSRM, delay alerts | C |

## Module 6 — Asset lifecycle management

Registry and classification: asset master with **40+ attributes** (financials, purchase/service/calibration/
warranty/end-of-life dates, condition, criticality, cost centre, custom fields) **M**; Class → Type → Brand →
Model hierarchy with CSV/Excel import and mapping wizard **M**; Region → Site → Building → Floor → Room
location hierarchy matching FATS conventions **M**; Bill of Materials **S**; mobile RFID/barcode tagging at
receipt linking EPC to the golden record with optional ERP pull **M**.

Lifecycle operations: custodian/owner assignment with history **M**; permanent and temporary transfer with
**multi-approver workflow**, email at each stage, Gate Pass / Delivery Note generation and overdue-return
alerts **M**; configurable allocation workflow **M**; check-in/check-out with photo evidence and overdue
flags **M**; **external / non-registered user booking** of equipment for a period without a full account
(called out as the key FATS differentiator) **M**; disposal with reasons Sell/Scrap/Write-off/Donation and
value-based multi-tier approval **M**; **Find-It** Geiger-counter-style proximity locate on handheld **S**.

Financial and compliance: straight-line and accelerated depreciation with monthly/yearly book value **M**;
warranty and calibration reminders **M**; vendor and contract master with end-date alerts **S**; unified
asset calendar **S**; journals, hashtags, attachments **C**; **ERP capitalisation** posting receipt/transfer/
disposal to SAP, Oracle or Dynamics via REST, IDoc or RFC **M**; ServiceNow approvals, incidents, CMDB **S**.

Audit and count: stock-take audit jobs by location/department/category with mobile scanning and live
Found / Missing / Misplaced status **M**; self-audit by email confirmation with reminders and escalation **S**;
cycle count with accuracy, overage, shortage and out-of-stock analytics **M**.

## Module 7 — Inventory and supply chain

| Area | Must | Should |
|------|------|--------|
| Inventory operations | SKU master with variants, photos, barcode/QR generation; receiving (GRN) with PO match and discrepancy flags; put-away and pick/pack with scan-to-confirm; dispatch with packing lists, shipping labels and ERP sales-order update; transfers, returns and write-off with reason codes | Stock ageing and ABC analysis |
| Inbound/outbound logistics | ASN via EDI or API with auto-GRN | Dock board and appointment scheduling; outbound load planning with gate check-in by RFID/QR; proof of delivery signature |
| Track and trace | End-to-end scan history and LPN-level tracking; signed chain of custody; recall management across sites | Cold-chain temperature log linked to shipments |

## Module 8 — Dashboards and reporting

- **Dashboard builder** (M): drag-and-drop responsive grid, resize, auto-refresh 5 s to 1 h; widgets: KPI card,
  line/area/bar/pie/donut, gauge, sortable table, map, alert feed, recent events, countdown, image/logo;
  per-dashboard RBAC, public links with optional password, multi-tab. Pre-built vertical dashboards (S).
- **Report builder** (M): pick entity, filters, columns, sort, grouping; tabular, summary, matrix/pivot, chart,
  combined. Standard templates: GRN, Stock Count Variance, Asset Movement, Shipment Manifest, Cycle Count
  Summary, Category Financials. Scheduled email delivery (daily/weekly/monthly) as PDF or Excel. Exports:
  PDF, XLSX, CSV, JSON. Map report engine with status-coloured pins (S).
- **AI/ML**: separate Python FastAPI service using Prophet and scikit-learn for demand forecasting and
  replenishment (S); anomaly detection on movements and access patterns (S); utilisation, velocity and ABC
  widgets (M).

## Module 9 — Enterprise integrations

SAP via REST, IDoc and RFC for capitalisation, depreciation, WMS stock events and ITSM incidents (**M**);
Microsoft Dynamics bi-directional item and transfer sync with a dedicated plugin (**M**); Oracle and generic
WMS via REST/SOAP with field mapping, retries and outbound queuing (**S**); ServiceNow (**S**).

Open API: full CRUD REST with OpenAPI 3.0 and Swagger UI (**M**); API keys with rotation, rate limits and IP
allowlists (**M**); inbound and outbound webhooks with retry and delivery guarantee (**M**); GraphQL (**C**).

## Module 10 — Mobile application

React Native / Expo iOS and Android with biometric login and role-based UI (**M**); camera barcode/QR plus
Bluetooth RFID sled (**M**); field workflows Stock Count, Receiving with GRN auto-fill, Asset Check-Out with
photo, Work Order completion with photo, Alerts Inbox, Map View with nearby navigation (**M**); **offline
queue with auto-sync** (**M**); ZPL printing to Bluetooth/network Zebra and Honeywell printers (**S**); MDM
support (**S**).

## Module 11 — Industry vertical modules (per-tenant feature flags)

| Vertical | Must | Should | Could |
|----------|------|--------|-------|
| Retail | Smart stock count with POS variance and real-time availability for eCommerce; product recall | Loss prevention combining EAS and RFID with POS deactivation (partner hardware) | Floor and fitting-room analytics |
| Healthcare | Medical asset tracking; patient wristband and staff badge RTLS; medication expiry, controlled-substance log, cold-storage temperature/humidity compliance | Sterilisation cycle and linen tracking | |
| Logistics & Ports | RFID gate, truck check-in, bay assignment, departure; cold chain and hazmat flags | Customs documents (packing lists, bills of lading, HS codes) | |
| Oil & Gas | Ex-rated device support with permit-to-work gating; RFID personnel mustering | Inspection checklists, HSE incident links, ISO 55000 reporting | |
| Manufacturing | WIP and production-order tracking by stage | Machine OEE from sensor data; Kanban replenishment and tool tracking | |

## Module 12 — Security and compliance

Must: TLS 1.3 in transit, AES-256 at rest, field-level encryption for PII and credentials; secrets in
HashiCorp Vault or AWS Secrets Manager with quarterly rotation; per-tenant IP allowlisting, idle timeout
(default 30 min), concurrent session limits; password policy with breach check; immutable platform-wide
audit log (user, time, IP, before/after values, CSV export); GDPR erasure and export; lockout after five
failed logins with admin notification.

Should: SOC 2 Type II readiness, ISO 27001 controls dashboard, regional data residency, login and API
anomaly detection with rate limiting.

## Module 13 — Platform administration

- **Super admin portal**: create/suspend/delete tenants and control feature flags (M); platform health
  dashboard with service status, queue depth, error rate, latency, tenant count, event volume (M); billing with
  plans, usage-based calculation and invoices (S).
- **Tenant admin portal**: org settings and GDPR tools (M); users, roles, devices, groups, ERP/WMS connections
  (M); notification routing, email templates, SMS credits, channels email/SMS/push/WhatsApp (M); usage versus
  plan limits (S).
- **System configuration**: lookup tables, number sequences for GRN/ASN/work orders, units, currency (M);
  SMTP, SMS gateway, map API key (Mapbox/Google), printer registration (M); **multilingual with Arabic RTL**
  and locale-aware formatting (S).

## Module 14 — Developer and extensibility

Plugin/extension SDK and marketplace (S); React-based custom widget framework (C); sandboxed JavaScript for
rule actions with shared utility libs (C); full REST API with OpenAPI 3.0 docs, versioning and tiered rate
limits (M).

## Non-functional requirements

| Area | Requirement |
|------|-------------|
| Performance | Under 500 ms from device read to dashboard update |
| Scalability | Horizontal scaling on Kubernetes; 10,000+ concurrent device connections |
| Availability | 99.9% uptime SLA for cloud; multi-AZ HA and DR |
| Offline resilience | Edge layer buffers events; mobile queues transactions and auto-syncs |
| Test coverage | 80% unit coverage of business logic; integration tests for all ERP adapters; Playwright E2E for critical journeys |
| Observability | OpenTelemetry traces, Prometheus metrics, structured JSON logs |
| Accessibility | WCAG 2.1 Level AA on all web UIs |

## Positioning claims (section 7)

DCS positions the platform on: multi-vendor hardware, external-user asset booking (not seen in competitors),
no-code rule/dashboard/report tools, connectors for SAP/Dynamics/Oracle/ServiceNow, first-class Arabic RTL,
a dedicated forecasting service, five verticals, and identical features across cloud/on-prem/hybrid.

## Feasibility notes (section 8) — the client's own assumptions

- Sub-500 ms WebSocket latency "achievable using **Node.js with Redis pub/sub**"; MQTT broker scales ingestion
  independently of the API layer.
- Schema-per-tenant PostgreSQL is the intended isolation model.
- No-code rule engine as a **custom JSON-serialised rule tree evaluated server-side**, no third-party dependency.
- BLE 3–5 m accuracy must be validated in site surveys before commitments.
- ML forecasting as an independent FastAPI service so Python stays out of the "Node.js core".
- EAS + RFID loss prevention is a partner-hardware dependency scoped to Retail only.
- GraphQL and JS scripting engine deferred; conversational natural-language analytics explicitly out of scope.

These notes describe a greenfield Node.js stack. See [thingsboard-fit-gap.md](thingsboard-fit-gap.md) for how
the same functional requirements map onto this ThingsBoard fork, and [README.md](README.md) for the stack
question to raise with the client.

## Glossary (from the document)

ASN, BLE, CEP, EAS, EPC, ERP, FATS (DCS's existing Fixed Asset Tracking System that this platform supersedes),
GRN, LPN, MFA, MQTT, mTLS, OEE, RBAC, RFID, RTLS, UHF, WMS, ZPL.
