# Client Requirements — DCS IoT & Asset Management Platform

Summaries of the five Word documents the client sent in the email thread
*"RE: SmartDev — Let's talk — New Project Description"* (folder of the same name at repo root).
Written 2026-09-07 from a full read of every document. These files summarise; the `.docx` files remain the
source of truth for wording, and the client's priorities (Must / Should / Could) are reproduced as written.

## Who the client is and what they want

- **DCS** is a UAE-based systems integrator (Abu Dhabi references throughout: ADDC, Estidama PBRS, DoE energy
  reporting, NESA, AED pricing). They already sell a Fixed Asset Tracking System (**FATS**, product name
  *Xplore Asset Track*) built on Windows / IIS / SQL Server with an Android app. For CAFM they partner with
  **Urbanise**.
- They want one **multi-tenant, no-code IoT platform** that supersedes FATS and lets them sell into five
  verticals (Retail, Healthcare, Logistics & Ports, Oil & Gas, Manufacturing) plus facilities management,
  smart buildings and smart warehouses.
- Non-negotiables that appear in every document: **vendor-agnostic hardware** (RFID, BLE, GPS, barcode,
  Modbus, BACnet, LoRaWAN), **on-premise deployment with the same feature set as cloud**, **offline-first
  mobile**, **RBAC with immutable audit trail**, **ERP / AMS integration**, and **Arabic RTL localisation**.
- The **BRD is the master document**. The four "workflow" documents are generalised process blueprints for
  four product lines the platform must be able to deliver; they overlap heavily with the BRD modules.

## Document map

| Summary | Source document | What it is |
|---------|----------------|------------|
| [dcs-platform-brd.md](dcs-platform-brd.md) | `DCS_Platform_BRD_v2 SmartDev.docx` | **Master BRD v1.0.** 14 modules, ~120 prioritised features, NFRs, positioning, feasibility notes. Start here. |
| [asset-tracking-workflow.md](asset-tracking-workflow.md) | `Asset_Tracking_Software_Workflow(2).docx` | Their existing FATS product as a workflow blueprint: asset lifecycle, mobile audit/transfer/disposal, approvals, ERP staging sync. |
| [cafm-workflow.md](cafm-workflow.md) | `CAFM_Software_Workflow.docx` | Facilities management SaaS: reactive + planned maintenance, work orders, contractors, budgets, compliance, customer portal. |
| [smart-building-workflow.md](smart-building-workflow.md) | `Smart_Building_Solution_Workflow.docx` | Smart power (Modbus MCBs), smart water, command-and-control room, unified IoT integration platform. Explicitly names a "ThingsBoard-class" platform. |
| [smart-warehouse-workflow.md](smart-warehouse-workflow.md) | `Smart_Warehouse_Software_Integration_Only.docx` | Software-only RFID warehouse: stock receipt/issue/transfer, cycle counts, CEP rules, AMS/AD/MDM/SMS integration. |
| [thingsboard-fit-gap.md](thingsboard-fit-gap.md) | — | Our mapping of the requirements onto ThingsBoard CE: what exists, what is partial, what must be built. |

## Headline expectations to keep in view

1. **Real-time**: device read to dashboard under 500 ms (BRD) / under 3 s (warehouse); alert delivery 2–5 s.
2. **Scale and availability**: 10,000+ concurrent devices, horizontal scaling on Kubernetes, 99.9% uptime,
   multi-AZ HA/DR for cloud.
3. **Data retention**: 3 years at 15-minute granularity (smart building); 5+ years for warehouse audit data.
4. **Quality bar**: 80% unit-test coverage on business logic, integration tests for every ERP adapter,
   Playwright end-to-end tests, OpenTelemetry + Prometheus + structured JSON logs, WCAG 2.1 AA.
5. **Security**: TLS 1.3 in transit, AES-256 at rest, field-level encryption for PII, secrets in Vault or AWS
   Secrets Manager, MFA (TOTP + SMS), SSO (OAuth2 + SAML2), AD/LDAP sync, immutable audit log with
   before/after values, GDPR erasure/export, SOC 2 and ISO 27001 readiness.
6. **Differentiators DCS insists on**: external (non-registered) users booking assets, no-code rule / dashboard /
   report builders, Arabic RTL, five vertical modules behind per-tenant feature flags.

## Things to raise with the client early

- The BRD's *Implementation Feasibility Notes* assume a **Node.js + Redis** core, **schema-per-tenant PostgreSQL**,
  a **custom JSON rule tree**, **React Native** mobile and a **Python FastAPI** ML service. This repo is a
  ThingsBoard CE fork (Java / Spring / Angular). The Smart Building document, by contrast, explicitly asks for a
  ThingsBoard-class platform. Confirm the stack decision before estimating.
- The four workflow documents describe **four different technology stacks** (IIS/SQL Server, AWS SaaS with
  PowerBI, Dahua ICC on-prem, PostgreSQL+MongoDB+TimescaleDB). Treat them as functional requirements, not
  architecture mandates.
- Several Must items are **not IoT-platform features** and are large products in their own right: WMS
  (GRN, put-away, pick/pack, ASN, dock board), depreciation and capitalisation, multi-approver transfer /
  disposal workflows, contractor and budget management, a label designer, native mobile apps.
- ERP connectors are Must for SAP (REST, IDoc, RFC) and Microsoft Dynamics; Oracle and ServiceNow are Should.
  Each needs client system access to build and test.
