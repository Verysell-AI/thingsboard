# Smart Warehouse Management System — software-only integration blueprint (summary)

Source: `Smart_Warehouse_Software_Integration_Only.docx`, "Generalized Software Workflow & Integration
Architecture (Software Only)", v1.0, 3 September 2026, status "Ready for Development", scope
"Integration-Only (RFID Data Processing — No Hardware Specifications)". Currency examples are AED and phone
numbers are UAE. It overlaps BRD Modules 2–4 (ingestion, processing, rules), 6.4 (audit/count) and 7
(inventory), and is the clearest statement of the **real-time RFID event pipeline** the client expects.

## Objectives and KPIs

- Ingest RFID/barcode reads from any reader brand; real-time inventory and location visibility; automated
  stock movements, cycle counts and notifications; integration with **AMS, Active Directory, MDM and an SMS
  gateway**; dashboards, audit trails, compliance reports; RBAC, encryption, audit logging.
- Multi-tenant support with a **"fractal hierarchy"**; offline-first mobile; container-based scalable
  deployment; on-premises with no mandatory cloud.

| KPI | Target |
|-----|--------|
| Scan-to-dashboard latency | ≤3 s (ingestion 2–5 s) |
| Critical alert delivery | 2–5 s |
| Inventory accuracy | >99.5% via automated reconciliation |
| Availability | 99.9% |
| Data retention | ≥5 years with archival |
| DR | RPO < 1 hour, RTO < 4 hours (hybrid replica: RPO < 1 s) |

## Four-layer model

Data sources (fixed/handheld/dock/tunnel RFID readers, barcode scanners, mobile devices, IoT sensors,
external APIs; over TCP/IP raw socket, MQTT, REST, webhooks, CSV/Excel file import, database connectors) →
**Middleware** (device adapter framework for reader protocols, normalisation, CEP, rule engine and workflow
orchestration, notification service, event logger) → **Application** (inventory, asset tracking, stock cards,
movements and transfers, cycle count automation, reporting, users and access) → **Presentation** (web
dashboard, mobile app, handheld UI, reports/export, admin console) over REST and WebSocket.

## Ingestion pipeline (what the platform must do to every read)

1. **Raw capture**: EPC, RSSI, antenna ID, timestamp, device ID, reader location.
2. **Normalise**: validate EPC syntax, filter noise reads, **deduplicate within a window (e.g. 1 s)**, enrich
   with device metadata, translate EPC → asset ID, add geolocation context.
3. **Correlate (CEP)**: same-tag multi-reads, reader **zone transitions**, stationary vs in-transit, expected vs
   unexpected patterns, time-series anomalies → business events such as "Item left Zone-A".
4. **Trigger workflows**: business rules (dock-door read updates receipt), notifications (expiry near), integration
   (asset moved → sync AMS), financial (item issued → allocate cost), audit logging.
5. Push to UI over WebSocket (web, mobile, handheld).

## Data model

Asset/inventory entity with tag ID (EPC), category (Equipment/Consumable/Tool), location
(warehouse → zone → bin plus coordinates), details (serial, part number, manufacturer, quantity, unit, lot,
expiry, batch, condition, cost, currency), metadata (status, custodian, project), attachments (invoice,
certificate, warranty) and an embedded audit trail (action, user, scanner, location, previous/new value).

**Digital stock card**: auto-created on first scan/receipt, updated on every movement, full movement history,
expiry alerts, lot/serial/batch, unit and total cost, attachments, condition, audit trail.

Suggested stores: PostgreSQL (items, stock cards, movements, cycle counts, users, roles, audit logs, alerts),
MongoDB (attachments, raw RFID events, dashboard and alert configurations), TimescaleDB (reader connectivity,
system performance, inventory-level snapshots, user action volume).

## Inventory workflows

| Workflow | Steps |
|----------|-------|
| **Stock receipt (inbound)** | Dock-door reader detects tagged items; app records delivery and source; match to PO, flag discrepancies → handheld count confirmation, quality/condition check, documents, optional approval → stock card create/update, location, "In-Stock", cost and quantity, audit → SMS/email, dashboard, AMS sync |
| **Stock issuance (outbound)** | Request with asset, quantity, purpose, project/cost centre → approval → locate bin, handheld tag read confirms match, availability check → dispatch photo, recipient signature, optional dock exit read, delivery notes → quantity reduced, "Issued"/"Out-of-Stock", custodian transfer, audit → confirmation, cost allocation, AMS and finance notification |
| **Inter-warehouse transfer** | Scan items, group by destination, packing list → tunnel/gate exit read, optional GPS tracking with route alerts → arrival tunnel read, expected vs actual, handheld reconciliation, condition check, discrepancies → update both warehouses' stock cards, custodian, expiry → notify both sides, AMS location sync |
| **Cycle count** | Scope (zone, category, full), schedule, team, expected list, optional issuance freeze → handheld read of all tags with real-time comparison and immediate discrepancy highlight → optional tunnel bulk pass → overages, shortages, variances, root-cause log → **supervisor approval with reason codes**, variance transactions, cost impact, audit → final and management reports, AMS sync, unfreeze |

## Rule engine requirements (CEP)

Rule types with expected actions:

1. **Item movement**: scanned at new location → update stock card, movement workflow, SMS/email, log, sync AMS.
2. **Expiry**: expiry < 30 days → flag "Expiring Soon", SMS storekeeper, daily report, recommend disposal.
3. **Stock below minimum**: → "Low Stock", replenishment alert, notify procurement, purchase recommendation.
4. **Cycle count discrepancy > 5%**: → flag, SMS supervisor, approval workflow, cost impact, **block
   auto-adjustment**, audit with root cause.
5. **Unauthorised movement** (scan outside expected workflow): → CRITICAL alert, SMS security, capture
   device/user/time, security incident, investigation workflow, audit exception.

Worked configuration example (`RULE-EXPIRY-ALERT-30`): daily scheduler at 08:00, filter Active and expiry within
30 days, actions = status update, templated SMS with placeholders, report entry, conditional admin email when
quantity > 100, and creation of an **approval task** assigned to the warehouse manager due in 7 days with
Approve Disposal / Extend / Investigate outcomes. Rules therefore need: scheduled triggers, data-set filters,
templated multi-channel messages, conditional actions and task/workflow creation.

## System integrations

- **AMS (Asset Management System)**: bidirectional REST or DB sync. Inbound: asset master, status, location
  hierarchy, custodian, depreciation. Outbound: real-time location, status (In-Stock / Issued / Transferred /
  Disposed), movement events, expiry alerts, cost allocation, audit trail. Real-time for critical, hourly/daily
  batch reconciliation, event-triggered. Sample endpoint `POST /api/v1/assets/location-update`.
- **Active Directory**: LDAP/SAML SSO; group → role mapping (e.g. Storekeeper group → storekeeper role); JWT
  sessions; auto-deactivation when removed from AD; AD password policy; MFA for privileged operations.
- **MDM**: enrol RFID handhelds, enforce encryption/PIN, install certificates, push reader configuration, app
  and firmware updates, remote wipe, compliance monitoring.
- **SMS gateway** (HTTP API): immediate SMS for unauthorised movement, critical shortage, expiry within 7
  days, count discrepancy > 5%, system outage; email plus optional SMS for routine receipts, transfers, weekly
  summary, monthly audit report. Message includes a deep link to the asset.

## Dashboards and reports

Executive dashboard: total inventory value split In-Stock / Issued / Disposal queue; active alerts by severity
(expiring, below minimum, unauthorised movements, count discrepancies); 24-hour transaction counts; system
status (dashboard latency, data freshness, readers online, DB uptime). Drill-down warehouse → zone → bin → item
with empty-bin alerts, movement history, documents and audit trail.

Reports: Daily Inventory Summary, Stock Movement, Cycle Count (expected vs actual, root cause, variance %,
cost, approval), Compliance (audit trail, approvals, attachment verification, ISO 27001 checklist), Financial
(valuation FIFO/LIFO/weighted average, cost allocation, disposal gain/loss, depreciation). PDF, Excel, CSV.

## Security and compliance

- Device layer: certificate TLS, OAuth 2.0 for APIs, reader fingerprinting, OT VLAN.
- User layer: AD SSO, MFA for privileged users, **15-minute idle timeout**, AD password policy.
- Application: RBAC permission matrix, dynamic roles from AD groups.
- Data: **row-level security (see own warehouse only)**, field-level PII encryption, masking, conditional access
  by location and device type.
- Roles: Storekeeper (own zone only), Supervisor (approvals, all transactions), Warehouse Manager (no
  financial approvals), Administrator, Auditor (read-only audit trails), Finance (financial reports only).
- Encryption AES-256 at rest including backups; TLS 1.2+ everywhere; mobile certificate pinning; HSM master
  keys, annual rotation, per-environment keys.
- Retention: active data indefinite; > 1 year archived for 5+ years; secure purge after 7 years; PII deletion per
  GDPR; test data purged weekly.
- **Immutable audit log**: user, UTC millisecond timestamp, action (CREATE/READ/UPDATE/DELETE/APPROVE),
  resource, before/after, device, IP, result, business context; append-only with **cryptographic hash chain**
  and integrity verification.
- Standards: ISO 27001, OWASP Top 10, NIST CSF, GDPR, **UAE Federal Data Protection Law**, data localisation.

## Mobile app

Native iOS/Android, offline-first, SQLite cache, bidirectional sync with server-wins conflicts, queued
operations, REST + WebSocket, certificate pinning, retry with exponential backoff; RFID via hardware API,
1D/2D barcode, camera. Workflows: offline receipt scanning with later sync and conflict detection; "Find
Item" lookup showing location, quantity, expiry, last movement, custodian, map and navigation to bin, last
10 movements.

## Deployment

On-premises recommended: 3 app servers (16 cores, 64 GB), 2 DB servers (16 cores, 32 GB, 2 TB), cache server,
load balancer, 4 TB backup, dual ISP, NGFW, warehouse mesh Wi-Fi, PoE switches. Optional hybrid: cloud
read-only replica, dashboard mirror and DR instance over VPN with real-time replication and automatic
failover.

## Relevance to the new platform

Strong overlap with ThingsBoard's ingestion, rule engine, alarms and dashboards. Specific expectations to
design for: sub-second dedup window on tag reads, EPC → asset resolution as an enrichment step, zone-transition
events from reader/antenna topology, scheduler-driven rules over entity data sets (expiry scans), rule actions
that create approval tasks, row-level scoping to a warehouse or zone, an Auditor role, a hash-chained audit
log, 5-year retention with archival, and connectors for AD/LDAP, SMS and an external AMS.
