# Asset Tracking & Management System — workflow blueprint (summary)

Source: `Asset_Tracking_Software_Workflow(2).docx`, "Generalized Technical Workflow Documentation", v1.0,
September 2026, scope "Software Workflow Architecture Only". The product is referred to as **Xplore Asset
Track**; this is DCS's current FATS offering written up as a generic blueprint. It is the most detailed
description of the asset-lifecycle behaviour that BRD Module 6 asks for.

## What the current product is

- Three tiers: **Android app** (SQLite, native RFID/barcode scanning, offline capture) → **back-office web app
  on IIS / ASP.NET** with REST/WebSocket API, workflow engine and report generator → **SQL Server 2019+**
  (PostgreSQL listed as alternative) including ERP staging tables.
- Selling points: dual RFID + barcode, online/offline mobile, GPS and timestamp stamping of every scan,
  bi-directional ERP sync, **on-premise with no cloud dependency**, **perpetual flat licence** (no per-asset or
  per-user fees).

## Master data

- **Asset creation**: capture name/type/category, serial, brand, model, acquisition date and cost, department,
  cost centre → duplicate check and mandatory-field validation → sequential asset ID and RFID/barcode tag
  allocation → save with initial status and audit entry → export to ERP staging and ERP fixed-assets module.
- **Asset update**: find by ID, scan or lookup; show history and ERP sync status; change location, custodian,
  department, condition, photos/documents; approval check; old-vs-new change log.
- **Classification**: Class (FF&E, IT, MEP, Vehicles, Other) → Type → Brand → Model.
- **Location**: Region → Site → Building → Floor → Room, each with generated codes and printable
  barcode/RFID location labels.
- **Organisation**: Department (code, cost centre, approvers) → custodians/employees (default location, roles,
  notification prefs) → cost-centre hierarchy.

## Mobile workflows (all work offline, then sync)

| Workflow | Key steps |
|----------|-----------|
| Verification / audit | Pick cycle and location, download expected list, scan each tag, optional photo, GPS + timestamp, live Found / Missing / Surplus, local summary report, upload when online |
| Transfer | Scan asset(s), choose source and destination, optional new custodian / department / cost centre, notes, photo, GPS, optional digital signature, local validation, "Pending Sync" transaction with receipt |
| Disposal | Scan, reason (Damaged, End of Life, Lost/Stolen, Other), method (Scrap/Recycling, Donation, Sale, Return to Vendor), photos, optional video, signature, "Awaiting Approval" request |
| Sync engine | Detect connectivity and API health; upload new assets, transfers, verifications, disposals, media, GPS; download approval statuses, master updates, config; merge, conflict check, integrity verification, cleanup, user summary |

Offline UX requirements: offline indicator, queue count, storage-limit warnings.

## Back-office workflows

- **Asset master dashboard**: search/filter by ID, category, location, custodian, status, date; list / grid /
  card / **map** views; quick actions (edit, history, download QR/RFID, create transfer, mark for disposal,
  print labels); bulk edit / export / approve / import.
- **Transfer approval**: pending queue with filters; review from/to, custodian change, mobile photo, GPS,
  timestamp; validate approver authority, custodian permissions, location access, business rules; decision
  **Approve** (update location, audit, flag for ERP sync), **Reject** (reason, notify, allow resubmit) or
  **Request more info**.
- **Disposal approval**: review photos, reason, justification, salvage value, compliance, insurance and
  environmental implications, approval authority level; Approve (set method, create work order, flag ERP
  retirement, generate disposal certificate), Reject (return to active), or Request revision.
- **Reports**: Asset Master, Asset Movement, Asset Tracking (scan results), Discrepancy, Disposal, Location
  Summary, Custodian Accountability, Cost Centre Analysis, Age Analysis, Exception. Builder flow: type →
  parameters (date, filters, grouping, columns, sort) → preview (summary stats, count, first 10 rows) →
  generate → export XLSX / PDF / CSV / XML / screen → one-time or recurring schedule with email and archive.
- **Dashboard**: executive summary (total assets, value, verification %, pending approvals), distribution by
  category/location/custodian/department, movement analytics (transfers this month, approval rate, processing
  time), audit metrics (verification % by location, missing count, discrepancy trend), system health (last
  sync, ERP queue, errors, user activity).

## Asset lifecycle and states

Stages: Creation/Acquisition → Assignment → Active Use → Transfer/Movement → Maintenance & Updating →
Auditing & Verification → End-of-Life → Disposal/Retirement.

State machine: CREATED → ASSIGNED → ACTIVE, with side transitions ACTIVE ⇄ TRANSFERRED, ACTIVE ⇄ REPAIR,
ACTIVE → MISSING → RECOVERED, ACTIVE → FLAGGED FOR DISPOSAL → APPROVED FOR DISPOSAL → RETIRED (posted to
ERP), ACTIVE ⇄ INACTIVE.

## ERP integration framework

- Architecture: local staging tables ↔ ERP fixed-assets module over REST API, XML or database link.
- **Imports (ERP → local)**: asset master daily/weekly; category weekly; location, department, cost centre
  monthly; custodian/employee weekly.
- **Exports (local → ERP), real-time via REST**: tag assignment, location update, transfer, verification,
  disposal.
- Import job: schedule → extract active and retired assets with depreciation data → map and standardise →
  detect new/modified/retired → load staging → integrity checks → promote to production, refresh caches, push to
  mobile sync queue → summary email.
- Export job: build payload on approval → queue with priority and retry policy → transmit → capture ERP
  transaction ID → on failure exponential backoff, admin alert, manual-review or correction queue; timeouts
  escalate to support.
- Sync modes: full, incremental, real-time, batch.

## Data model (core tables)

ASSETS, LOCATIONS (self-referencing hierarchy with level, lat/long), ASSET_TRANSFERS (from/to location,
custodian, department, approval, photo, GPS), ASSET_DISPOSAL (reason, method, approval, ERPRetirementID),
ASSET_AUDIT (cycle, scan status Found/Missing/Surplus, photo, coordinates, mobile user, device),
ASSET_CATEGORIES, AUDIT_LOG (table, record, action, old/new value, user, time, IP), ERP_SYNC_STATUS
(entity, direction, status, error, retry count). Plus APPROVAL_WORKFLOWS, AUDIT_CYCLES, AUDIT_DISCREPANCIES,
DISPOSAL_APPROVALS, USER_ROLES, ROLE_PERMISSIONS, LOCATION_ACCESS.

## Security and roles

- Auth: Windows AD, Azure AD, SSO, local fallback; optional MFA (OTP email or time-based token); JWT session
  with login event logging.
- Roles **Admin → Supervisor → Verifier → User → Viewer**. Permission matrix: only Admin creates/deletes assets
  and manages users/config; Admin and Supervisor edit assets and approve transfers/disposals; Admin, Supervisor
  and User create transfers/disposals; Admin, Supervisor and Verifier perform audits and export; everyone
  generates reports. Location-scoped access (LOCATION_ACCESS table).
- Encryption TLS 1.2+, AES-256 at rest, bcrypt/PBKDF2 passwords, encrypted API keys with rotation. Audit trail
  covers user activity, data changes, approvals, ERP sync results, import/export jobs, errors, backups.

## Public API shape (v1)

`/api/v1/assets` CRUD with soft delete; `/api/v1/transfers` create, get, `/approve`, `/reject`;
`/api/v1/audits/start`, `/audits/{id}/scans`, `/audits/{id}/summary`; `/api/v1/erp/sync/assets`,
`/erp/sync/status`, `/erp/import/assets`.

## Deployment expectations

Windows Server 2019/2022 app server (8 cores, 32–64 GB), SQL Server or PostgreSQL DB server (16 cores,
64 GB, 1 TB SSD, 15-minute log backups, daily full, RTO 1 hour), Android 8+ rugged devices with RFID/barcode,
GPS, 4G, 5000 mAh. Seven-phase rollout: infrastructure, database, application, integration, mobile
distribution (signed APK), testing (SIT, UAT, performance, security, ERP), go-live.

## Relevance to the new platform

Everything here is restated in BRD Module 6 (lifecycle), 6.4 (audit), 9.1 (ERP) and 10 (mobile). Behaviour
that is more specific here than in the BRD and should be treated as expected: GPS-stamped scans, photo and
signature evidence on transfers and disposals, three-way approval decisions (approve / reject / request more
info), disposal certificates and ERP retirement IDs, location-scoped permissions, and the staged ERP
import/export with retry queues.
