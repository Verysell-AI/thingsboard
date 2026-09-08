# Presales questions — what the documents already answer, and the six that are still open

Companion to the "DCS IoT & Asset Management Platform — Presales Q&A" sheet (35 rows as of 2026-09-08).
Checked against the sheet and against the client documents summarised in this folder. What remains: one new
row and five sharpening sentences for existing rows, all of them decisions that change the architecture.
`presales-questions.tsv` holds all six as full sheet rows (Category, Question, Guidance) for pasting.
Section 1 lists sheet topics the documents already answer, so the response column can be pre-filled and DCS
only confirms.

## 1. Pre-fill from the documents instead of asking

| Topic | What the documents say | Source |
|-------|------------------------|--------|
| Tenancy model | Root → Tenant → Site with cascading configuration; white-label (domain, theme, logo) per tenant "to support reseller and enterprise branding"; per-tenant feature flags; super-admin portal manages tenants | BRD Module 1.1, 13.1 |
| Data isolation | Schema-per-tenant PostgreSQL with row-level security, restated in the feasibility notes | BRD 1.1, section 8 |
| Proposed core stack | Node.js + Redis core, custom JSON rule tree, React Native/Expo mobile, Python FastAPI ML service; the Smart Building document instead asks for a "ThingsBoard-class" platform | BRD section 8; Smart Building conclusion |
| Inventory / WMS scope | Receiving, put-away, pick/pack, dispatch, transfers, ASN, track and trace are **Must features built into the platform**; connectors to external WMS are Should | BRD Module 7, 9.1 |
| ITSM and work orders | ServiceNow integration (Should); work orders exist inside the platform as a rule action and a mobile workflow | BRD 6.3, 9.1, 4.1, 10 |
| Volumes and retention | 10,000+ concurrent devices, Kubernetes horizontal scaling; hot/warm/cold retention tiers; 3 years at 15-min granularity (smart building); 5+ years with archival and a raw RFID event store (warehouse) | BRD 3, NFR; Smart Building; Warehouse 2.2, 7.2, 10.3 |
| Deployment options | Cloud, on-premise with identical features, hybrid with edge; on-premise sized as dedicated servers per site; operated by customer staff trained by DCS | BRD 4.2; Warehouse 11; Smart Building 2.2, 8.1, Package E |
| Latency and availability | Under 500 ms device to dashboard; ≤3 s scan to dashboard (warehouse); 99.9 % uptime with multi-AZ HA/DR for cloud | BRD NFR; Warehouse KPIs |
| Reader hardware and protocols | Zebra FX, Impinj Speedway, Alien; Zebra, Honeywell, TSL handhelds; ingestion via MQTT, HTTP, TCP socket, REST, SFTP; edge layer for dedup, enrichment, offline buffering | BRD 2.2, 2.3 |
| Mobile | React Native/Expo, Bluetooth RFID sled, camera scanning, offline queue with auto-sync (Must); current app is Android 8+ rugged with SQLite offline | BRD Module 10; Asset Tracking 4 |
| Indoor positioning | BLE triangulation 3–5 m and RFID zone detection (Must); accuracy to be validated in site surveys | BRD 5.2, section 8 |
| Approval workflows | Multi-approver transfer, value-tiered disposal, configurable allocation; no workflow designer requested | BRD 6.2 |
| Identity and roles | MFA (TOTP, SMS), OAuth2 and SAML2 SSO, AD/LDAP sync (Should), five built-in roles plus custom role builder (Must) | BRD 1.2 |
| Compliance | TLS 1.3, AES-256, Vault or AWS Secrets Manager, immutable audit with before/after, GDPR tooling (Must); SOC 2 and ISO 27001 readiness, data residency (Should); NESA and UAE PDPL in the smart building and warehouse documents | BRD Module 12; Smart Building 5.6; Warehouse 12 |
| Arabic RTL | Should in the BRD; English and Arabic handbooks for smart building | BRD 13.3; Smart Building Package E |
| DCS's current stack | Xplore Asset Track: IIS/ASP.NET, SQL Server, Android; ERP staging tables with REST/XML/DB-link sync | Asset Tracking 2, 6 |

## 2. New row

| Category | Question | SmartDev guidance |
|----------|----------|-------------------|
| F. Security, Compliance, and Localisation | The BRD specifies schema-per-tenant PostgreSQL with row-level security. Is physical isolation a requirement from customers or regulators, or a design assumption? Would logical isolation on shared infrastructure for cloud tenants, with dedicated instances for on-premise customers, be acceptable? | Recommended position: logical isolation for cloud, dedicated instances on premise. ThingsBoard CE isolates logically by tenant; a hard physical-isolation requirement means one deployment per tenant, which changes provisioning, upgrades, cost and the multi-tenant SaaS model. The most structure-changing open point on the sheet. |

## 3. Sentences to fold into existing rows

| Existing row | Add to the question | Why it matters |
|--------------|---------------------|----------------|
| B. Must all functions be implemented inside ThingsBoard? | The BRD feasibility notes describe a Node.js core with a custom rule tree; the Smart Building document asks for a ThingsBoard-class platform. Which is intended, and does DCS accept ThingsBoard CE as the IoT core? | Decides whether the estimate is months or years. |
| B. What level of white-labelling is required? | In Root → Tenant → Site, where does a reseller sit: the reseller is the tenant with its customers as sites, or a reseller owns several tenants, each with its own brand and data? | A reseller-above-tenants model needs a hierarchy level ThingsBoard CE does not have. |
| C. Which deployment model is required for the MVP? | The BRD requires Kubernetes scaling; the warehouse and smart building documents size on-premise as fixed servers. Is Kubernetes available at customer sites, or must on-premise run on VMs and Docker? | Decides packaging, HA design and operations tooling for every on-premise sale. |
| D. Is 3–5 m BLE accuracy a contractual requirement? | Who supplies the positioning engine: a vendor RTLS server we integrate, or SmartDev? | Building one is research-grade; integrating one is an adapter. |
| E. Which system is the source of truth for master data? | Is the CAFM document (maintenance, contractors, budgets, delivered with Urbanise) in scope for this platform, or does it stay Urbanise's product that we integrate with? | A product-sized module in or out of scope. |

## Answer before estimating

ThingsBoard versus the BRD's Node.js core (B), physical versus logical isolation (F, new), PE benchmark
(existing B row), deployment model including Kubernetes at customer sites (C), first integration (existing E row).
