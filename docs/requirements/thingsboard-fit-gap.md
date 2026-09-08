# Fit / gap: client requirements versus ThingsBoard CE (this fork)

Maps the requirements in this folder onto what ThingsBoard Community Edition 4.4.0-SNAPSHOT provides, using
[../architecture.md](../architecture.md) and [../ce-vs-pe-gaps.md](../ce-vs-pe-gaps.md) as the platform
baseline. "Exists" means CE has it out of the box; "Partial" means CE has a primitive that needs configuration
or a thin extension; "Build" means new code (entity, service, UI) in this fork; "External" means a separate
service or product that integrates with the platform.

This is an engineering assessment, not a commitment. Priorities in brackets are the client's from the BRD.

## Platform foundation and tenancy

| Requirement | CE status | Notes |
|-------------|-----------|-------|
| Multi-tenant SaaS | Exists | Tenant → Customer → User. Isolation is enforced in services, shared schema. |
| Schema-per-tenant PostgreSQL + RLS | Gap by design | CE uses a shared schema keyed by `tenant_id`. Changing this is a rewrite; propose CE isolation model (or separate deployments for on-prem tenants) and confirm with client. |
| Root → Tenant → Site hierarchy with config inheritance | Partial | Tenant → Customer gives two levels; "Site" can be modelled as Asset with relations. Cascading config inheritance is Build. Sub-customers are absent in CE. |
| Tenant onboarding wizard, feature flags per tenant | Build | Tenant profiles hold limits, not feature flags. Wizard is new UI. |
| White-label per tenant [M-tier expectation] | Build | Absent in CE (PE feature). Needs settings hierarchy, theming pipeline, mail templates. |
| Email/password login, JWT refresh tokens | Exists | |
| MFA TOTP / SMS [M] | Exists | CE 4.x has two-factor auth providers (TOTP, SMS, email, backup codes). |
| OAuth 2.0 SSO, Google/Microsoft [M] | Exists | System-level OAuth2 with domain mapping. Per-tenant branded login is Build. |
| SAML 2.0 [M] | Build | Not in CE. |
| AD / LDAP sync [S] | Build | Not in CE. |
| RBAC with custom roles and permission matrix [M] | Build | CE has three fixed authorities. Custom roles and entity groups are PE features. Largest cross-cutting gap. |
| Session tracking, forced remote logout | Partial | JWT invalidation exists per user; per-device session list is Build. |
| Immutable audit of logins and permission events [M] | Partial | CE `AuditLog` records entity actions and logins; before/after values, hash chaining and immutability guarantees are Build. |
| User invitations, profiles, CSV bulk import, activity feed | Partial | Activation-by-email exists; profile photo/department/language, bulk import and activity feed are Build. |

## Devices, hardware and ingestion

| Requirement | CE status | Notes |
|-------------|-----------|-------|
| Device registry with type, location, serial, firmware, status, battery | Exists | Device + DeviceProfile + attributes; OTA packages track firmware. Status states beyond active/inactive are rule-chain + attributes. |
| Device groups by floor/zone | Partial | Relations to Asset hierarchy; entity groups (PE) absent. |
| Bulk device import CSV / QR | Partial | UI bulk import exists for devices; QR onboarding is mobile Build. |
| MQTT, HTTP, CoAP ingestion, QoS 0/1/2 | Exists | Built-in MQTT transport; `{tenant}/{location}/{device}` custom topic scheme needs gateway or transport tweak. |
| mTLS device certificates | Exists | X.509 device credentials. |
| TCP socket, SFTP file drop, raw reader protocols (LLRP, Zebra, Impinj) | External / Build | ThingsBoard IoT Gateway (Python) has connectors incl. Modbus, OPC-UA, BLE, request/socket; RFID reader protocols need custom gateway connectors. |
| Modbus RTU/TCP, OPC-UA, BACnet/IP, LoRaWAN, Zigbee | External | Via IoT Gateway (Modbus, OPC-UA, BACnet, BLE) or a LoRaWAN network server publishing MQTT. PE "Integrations" are absent in CE. |
| Edge buffering and offline replay | Exists | ThingsBoard Edge (CE) syncs to cloud; IoT Gateway also buffers. |
| Tag registry, EPC → asset link, tag lifecycle | Build | New entity or Asset-type with attributes; "asset" here is a business asset, not TB `Asset`. |
| Bulk tag encoding, ZPL/EPL print queue, label designer | Build / External | Printing is mobile/gateway side; label designer is a new UI module. |

## Real-time processing and rules

| Requirement | CE status | Notes |
|-------------|-----------|-------|
| Kafka streaming, per-tenant queues | Exists | Kafka queue in microservices mode; tenant profile queue config. |
| Hot/warm/cold retention tiers | Partial | TTL per tenant profile; tiering to cold storage is Build/External. |
| Normalisation and enrichment | Exists | Rule nodes (script, enrichment, originator attributes/relations). |
| Deduplication window | Exists | Deduplication rule node. |
| WebSocket feed < 500 ms, 60 s replay | Partial | Telemetry WebSocket exists; replay buffer is Build; latency depends on deployment. |
| Dead-letter queue | Partial | Rule-chain failure routing + queue failure strategies; explicit DLQ UI is Build. |
| Visual rule builder [M] | Exists | Rule chain editor is a developer-grade visual tool; the client wants a business-user IF/THEN/ELSE builder. Consider a simplified builder that generates rule chains: Build. |
| Triggers: device event, cron, manual, webhook | Exists | Generator node for cron; REST/HTTP nodes; manual trigger is UI Build. |
| Actions: email, SMS, push, webhook, ERP write, work order | Partial | Email, SMS, Slack/Teams, REST call, notifications exist; ERP write and work order creation are Build actions. |
| Rule versioning and simulation | Partial | Version control (git) exists; test-with-sample-message exists per node; end-to-end simulation UI is Build. |
| Execution log | Partial | Debug mode events per node (time-limited). Permanent audit of every evaluation is Build and costly. |
| Alerts: four severities, ack/comment/resolve, escalation, MTTR | Exists / Partial | Alarms have five severities, ack/clear, comments, assignment; escalation timers via notification rules; MTTR analytics is Build. |
| Scheduled rules over data sets (daily expiry scan) | Partial | Generator + entity query nodes; PE scheduler absent. |
| Rule actions that create approval tasks | Build | No task/workflow entity in CE. |

## Mapping and location

| Requirement | CE status | Notes |
|-------------|-----------|-------|
| Leaflet map, tiles, image/floor-plan map, pins, clustering | Exists | Map widgets support OSM/Google/HERE/Tencent tiles, image maps, markers, clustering. |
| Geofences: polygon/circle/rectangle, entry/exit/overstay | Exists | GPS geofencing rule nodes + map polygon/circle drawing. |
| Heat maps, path replay with scrubber | Partial | Trip animation widget exists; density/dwell heatmaps are Build. |
| PDF/PNG map export, password-protected public link | Partial | Public dashboards exist; password on link and image export are Build. |
| BLE triangulation, RFID zone detection [M] | External / Build | Positioning algorithms run in gateway or a positioning service; zone occupancy from RSSI is rule-chain + Build. |
| Fleet map, route playback, idle/over-speed [M/S] | Exists / Partial | Trip animation, telemetry rules; fleet list widget is configuration. |
| ETA via Google Directions / OSRM [C] | Build | External API call from rule node. |

## Asset lifecycle, inventory, supply chain

These are business applications, not IoT primitives. CE gives storage (assets, attributes, relations,
custom entity views) and APIs, but every workflow below is **Build**:

- Asset master with 40+ attributes, Class/Type/Brand/Model, Region→Site→Building→Floor→Room: model as TB
  `Asset` with `AssetProfile` and relations, or as new JPA entities for proper search and reporting.
- Custodian assignment, permanent/temporary transfers with multi-approver workflow, gate pass, overdue
  alerts, check-in/out with photos, external-user booking, disposal with value-tier approvals, Find-It,
  depreciation, warranty/calibration calendar, vendor/contract master, stock-take with Found/Missing/
  Misplaced, self-audit, cycle counts with variance approval.
- SKU catalogue, GRN with PO match, put-away, pick/pack, dispatch, returns, ASN, dock board, POD, LPN
  traceability, chain of custody, recall, cold-chain log.
- CAFM: work orders with SLA timers, PPM templates and planner, JSA safety gate, contractors, rate cards,
  budgets, quotes/POs/invoices, building compliance, customer portal.

Recommendation: a new set of modules (own packages, entities, controllers, Angular feature modules) behind
clear interfaces, following the "add an entity" recipe in architecture.md, so upstream merges stay possible.
Consider whether inventory/WMS and CAFM should be separate services integrated via the REST API and rule
engine instead of living inside the ThingsBoard JVM.

## Dashboards, reporting, analytics

| Requirement | CE status | Notes |
|-------------|-----------|-------|
| Drag-and-drop dashboard builder, widget library, auto-refresh, tabs (states) | Exists | Covers KPI cards, charts, gauges, tables, maps, alarm tables, images. |
| Per-dashboard RBAC | Partial | Assign dashboards to customers; role-level control needs RBAC Build. |
| Public link with password | Partial | Public dashboards exist; password is Build. |
| Pre-built vertical dashboards | Build | Content work on top of existing widgets. |
| No-code report designer, pivot, templates | Build | Not in CE. |
| Scheduled PDF/Excel email reports [M] | Build | PE "Reports" service absent. Needs headless rendering or a reporting service. |
| Exports PDF/XLSX/CSV/JSON | Partial | CSV/XLS export from table widgets; PDF is Build. |
| AI/ML forecasting, anomaly detection [S] | External | Separate Python service as the BRD proposes; CE 4.x has an "AI models" integration hook and Trendz hook that could front it. |

## Integrations and API

| Requirement | CE status | Notes |
|-------------|-----------|-------|
| REST API with OpenAPI 3.0 / Swagger UI [M] | Exists | Swagger UI ships in CE. Client's WMS/asset endpoints are Build. |
| API keys with rotation, rate limit, IP allowlist [M] | Partial | JWT and per-tenant rate limits exist; API-key entity, IP allowlist and per-key limits are Build. |
| Inbound/outbound webhooks with retry [M] | Partial | REST API call rule node with retries; inbound webhook via HTTP integration is PE, so a small controller is Build. |
| SAP REST/IDoc/RFC, Dynamics, Oracle, ServiceNow | Build / External | REST parts via rule nodes; IDoc/RFC need SAP JCo and a dedicated connector service. Each requires client system access. |
| AD/LDAP, SMS gateway, MDM, AMS | Build / Exists / External / Build | SMS via notification providers (Twilio, SMPP, AWS SNS) exists. |
| GraphQL [C] | Build | Deferred by client. |

## Mobile

| Requirement | CE status | Notes |
|-------------|-----------|-------|
| iOS/Android app, biometric login, role-based UI | Partial | ThingsBoard Mobile App (Flutter) and mobile app bundles exist in CE for dashboards; the client wants React Native/Expo with field workflows. Field workflows (stock count, receiving, check-out, work orders, alerts, map) are Build. |
| Camera barcode/QR, Bluetooth RFID sled | Build | Vendor SDKs (Zebra, TSL) on device. |
| Offline queue with sync | Build | Server needs idempotent transaction endpoints and conflict handling. |
| ZPL printing, MDM | Build / External | |

## Security, compliance, administration

| Requirement | CE status | Notes |
|-------------|-----------|-------|
| TLS 1.3, AES-256 at rest | Deployment | TLS termination and disk/DB encryption are infrastructure; field-level PII encryption is Build. |
| Vault / AWS Secrets Manager, rotation | Deployment / Build | Spring config can read from Vault; rotation policy is ops. |
| IP allowlist per tenant, idle timeout, concurrent session limit | Partial / Build | JWT expiry configurable; the rest is Build. |
| Password policy, breach check, lockout after 5 failures | Exists / Build | Password policy and lockout exist in security settings; breach check is Build. |
| Platform-wide immutable audit with before/after and CSV export | Partial | AuditLog exists (entity actions); extend to all API calls, before/after diff, hash chain, export. |
| GDPR erasure/export | Build | |
| SOC 2, ISO 27001 dashboard, data residency | Process / Build / Deployment | |
| Super admin tenant management, feature flags | Exists / Build | SYS_ADMIN manages tenants and tenant profiles; feature flags and billing are Build. |
| Platform health dashboard | Partial | Prometheus metrics endpoint exists; a dashboard is configuration plus Grafana or TB widgets. |
| Notification channels email/SMS/push/WhatsApp | Exists / Build | Email, SMS, Slack, Teams, web, mobile push exist; WhatsApp is Build. |
| Lookup tables, number sequences, printers, SMTP, SMS, map key | Partial | SMTP, SMS, map keys exist in admin settings; lookups, sequences and printers are Build. |
| Multilingual with Arabic RTL [S] | Partial | UI is i18n-ready with many locales, and an `ar_AE` locale file already exists (roughly three quarters the size of `en_US`, so incomplete). Full RTL layout across Angular Material components is Build and testing-heavy. |
| WCAG 2.1 AA | Gap to audit | Not a stated upstream target; needs an accessibility audit. |
| Observability: OpenTelemetry, Prometheus, JSON logs | Partial | Prometheus metrics and Logback exist; OTel tracing and JSON log layout are configuration/Build. |
| 80% unit coverage, Playwright E2E | Process | Upstream tests exist (see ../testing.md); coverage targets apply to new code. |

## Developer extensibility

Plugin SDK and marketplace [S]: Build; CE's extension points are rule nodes, widgets (JS, not React) and
Spring beans. Custom React widgets [C]: CE widgets are Angular/JS; a React bridge is Build. Sandboxed JS in
rule actions [C]: Exists (script nodes, `tb-js-executor`, TBEL).

## Summary of the largest gaps to plan for

1. **RBAC with custom roles and location-scoped access**: touches every controller and UI page.
2. **White-label and per-tenant branding** including login and mail templates.
3. **Asset lifecycle, approvals, booking, depreciation, audits**: the FATS replacement, all new.
4. **Inventory / WMS and CAFM modules**: consider separate services.
5. **Report designer with scheduled PDF/Excel delivery**.
6. **Native mobile field app with offline sync** and RFID sled support.
7. **Business-user rule builder** on top of rule chains, plus permanent execution logs and simulation.
8. **ERP connectors** (SAP IDoc/RFC, Dynamics) and SAML/LDAP.
9. **Hash-chained immutable audit log** with before/after values and long retention.
10. **Arabic RTL** and accessibility.

Confirm with the client early whether the ThingsBoard base is accepted, since their BRD feasibility notes
assume Node.js, schema-per-tenant PostgreSQL and a custom rule tree (see [README.md](README.md)).
