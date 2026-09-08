# Computer-Aided Facilities Management (CAFM) System — workflow blueprint (summary)

Source: `CAFM_Software_Workflow.docx`, "Generalized Technical Workflow Documentation". Describes a cloud-native
multi-tenant facilities-management SaaS. Implementation options name **DCS & Urbanise** as the delivery team,
so this is the FM product line DCS sells with a partner. It maps to BRD items on work orders, asset lifecycle,
approvals, contracts/vendors, calendars and the customer-facing portal.

## Platform components

Operations Portal (dispatch, compliance), Workforce Mobile App (GPS, offline, photos), Customer Service Portal
(raise and track requests), Supplier/Contractor Portal (jobs, quotes, invoices, performance), Financial
Integration (budgets, invoicing).

Stated stack: native Android 8+ and iOS 14+ apps; React/Vue/Angular SPA; Node.js/Java/.NET REST services;
custom workflow engine; AWS RDS PostgreSQL/MySQL multi-tenant DB; **PowerBI/Tableau embedded** analytics;
Azure AD / Okta SSO; AWS hosting (ELB, auto-scaling EC2, multi-AZ RDS, S3 + CloudFront, WAF, SNS/SQS).

## Works management

### Reactive maintenance

1. **Request intake** from web portal, customer mobile app, inbound email gateway (auto-parsed), phone/in-person
   by staff, or third-party API. Capture description, location/building, asset, priority, contact,
   attachments, instructions.
2. **Validate** and assign request ID; **apply SLA rules** (response and completion targets, critical flag,
   escalation rules).
3. **Auto-route** to internal team or external contractor by skill or site; create work order (NEW/OPEN),
   assign, audit, notify technician, contractor, customer and supervisor.
4. **Execution** on mobile: accept → travel with GPS and ETA → **pre-work safety checks** (site induction,
   pre-start assessment, JSA) → clock in, scan asset QR, follow instructions → capture photos/video, parts,
   time, notes, condition, GPS → handle parts wait (ON_HOLD), remote supervisor help, scope-change
   authorisation → post-work inspection, checklist, customer digital signature → COMPLETE.
5. **Post-completion**: invoice/quote, cost data, final report, sync, customer notification with rating
   request.

### Planned preventative maintenance (PPM)

- Maintenance types: time-based, usage-based (hours/cycles), condition-based. Group assets/locations for bulk
  scheduling.
- **Maintenance template**: instructions, parts, duration, pre/post checks, JSA, skills/tools, checklist.
- Automation: auto-generate jobs on frequency, **12-month planner view**, blackout dates, reminders, conflict
  review and approval.
- Execution mirrors reactive with condition rating, issue documentation, replacement flagging, automatic
  corrective work order when issues are found, completion report to asset history, financial sync, trigger
  of next occurrence.

### Work order approval and escalation

Route by value and priority → manager checks scope, resources, budget, contractor qualification → Approved /
Changes requested / Rejected with audit → **SLA timers** with at-risk notifications and BREACHED critical alerts
and recovery plan.

State machines: Work order NEW → ASSIGNED → IN_PROGRESS → COMPLETE with ON_HOLD, CANCELLED, and a
PENDING_APPROVAL → APPROVED/REJECTED pre-stage. Job CREATED → SCHEDULED → DISPATCHED → ACCEPTED → IN_PROGRESS →
COMPLETE with ON_HOLD.

## Asset management

- Lifecycle: Acquisition → Registration (Category/Type/Brand/Model, location, custodian, condition, documents)
  → Active → Maintenance → **Monitoring & trending** (degradation, predicted replacement, capex planning) →
  End-of-life planning (replacement forecast, cost, procurement) → Disposal.
- Asset record: IDs and QR/barcode; classification with custom tags; acquisition date, cost, useful life,
  warranty, install and decommission dates; Site/Building/Floor/Room location with movement history;
  custodian, department, cost centre; condition Good/Fair/Poor with assessment history, repairs, defects;
  **unlimited client-defined custom fields**; depreciation schedule; audit trail.
- **Asset booking** for rotatable/shared assets (safety equipment, pumps, vehicles): availability calendar,
  period, purpose → conflict check → reserve and notify → transfer custodian → return inspection and calendar
  update. (Same concept as the BRD's external booking differentiator.)

## Mobile workforce app

Layers: UI (dashboard, job list, job detail, scanning, photo/evidence, forms/checklists, GPS map,
communication); logic (job engine, offline manager, GPS handler, photo, signature, validation,
notifications, sync); data (SQLite, cached assets, offline queue, attachment storage); device (camera, GPS,
barcode/QR, microphone for notes, connectivity, biometrics, push).

**Offline-first**: cache masters and assigned jobs, buffer completed work and media, perform full job workflow
offline, auto-sync on reconnect with **server-wins** conflict resolution and retry; UI shows offline indicator,
queue count, storage warnings, sync progress.

## Back-office operations centre

Dashboard sections: executive (jobs active/pending/overdue, SLA %, utilisation, cost vs budget YTD,
satisfaction score), job management (queue, filters, bulk assign/reassign/close), assets (list/grid/map,
condition, next maintenance), workforce (technician map with live GPS, dispatch, attendance, performance,
skills matrix), financial (budget, actuals, invoices, POs, supplier costs), compliance (building compliance,
overdue items, certificate expiry, safety), analytics (custom dashboards, trends, exports).

## Customer engagement portal

Dashboard (open/closed requests, SLA status, activity, announcements, scheduled maintenance), request
management (status, progress, technician, ETA), communication (comments, photos, chat), feedback (1–5
rating, comments), scheduled maintenance (view, confirm, reschedule), documents (completion reports,
invoices, certificates, export).

## Supply chain: suppliers and contracts

- **Supplier onboarding**: company details, type (maintenance contractor, parts, rental, specialised),
  services, certifications, geographic coverage, segments, pricing tier, capacity; **compliance documents with
  expiry alerts** (licence, insurance, certifications, safety, background checks); rate cards (service rates,
  markup, travel, call-out, discounts, terms); work restrictions (locations, services, max job value,
  approvals); portal access.
- **Service contracts**: services, SLAs, scope, period, payment schedule, KPIs; link to PPM and corrective
  maintenance and invoicing with invoice frequency decoupled from job frequency; automated AP; performance
  monitoring (SLA, response, completion, first-time fix, cost) and scorecards with 360 feedback; renewal or
  termination.

## Compliance and safety

- **Building compliance**: define requirements per building/asset (fire, electrical, HVAC, elevator,
  emergency exits, certifications) with frequency and responsible party; **rule-based auto-allocation** by
  geography, regulation, building type, age; compliance dashboard On-Track / At-Risk / Overdue; reminders and
  escalation; upload inspection reports and certificates; regulator-ready exports.
- **Job Safety Assessment**: pre-start questionnaire (induction, PPE, conditions, tools, hazards, emergency
  contact) that blocks work until resolved; in-work incident and near-miss logging; post-work closure
  questionnaire; incident management with root cause, corrective action, HSE notification; safety trend
  reporting.

## Budget and financial management

Budgets by fiscal year across service type, site, supplier, cost centre, project with a hierarchy
(organisation → department → service → supplier → location). Controls: preventive blocking when exceeded,
**warning at 80%**, mid-year adjustments, approval workflows. Cost tracking per work order: estimate (labour ×
rate, materials, travel, call-out) → actuals during execution → quote to customer when over threshold →
invoice with markup and documents → post to finance (AP/AR, cost centre, variance) and close financially.
Quote management (request, compare, approve, PO, budget lock) and invoice matching to POs.

## Reporting

Standard suite: Work Order Summary/List, Job Summary/List, Reactive and Planned Maintenance, Quote and
Invoice Summary, Asset Register / by Location / by Custodian, Compliance Status, Safety Incidents, SLA
Compliance, Contractor and Technician Performance, Budget vs Actual, **Capital Replacement Forecast**.
Dashboards for operations, assets, financial, compliance and performance; ad-hoc via embedded BI; exports
Excel/PDF/CSV.

## Security and roles

SSO (Azure AD, Okta, SAML 2.0, OAuth 2.0); MFA (email OTP, SMS OTP, authenticator, mobile biometric); RBAC with
predefined and custom roles and **location-scoped access**; session timeout, device management, concurrent
limits. Roles: System Administrator, Facility Manager, Operations Manager, Technician, Contractor, Customer,
Viewer, with a 19-row permission matrix (e.g. only Admin deletes assets, manages users, configures system;
Customers can create work orders and view portal/reports; Contractors accept/complete work, export and
generate reports). TLS 1.2+, AES-256 including backups, bcrypt; GDPR, ISO, SOC 2, pen-testing.

## Integration framework

APIs for assets, work orders, financials, users, compliance, reporting, plus webhooks. Patterns: financial
system (quotes, POs, invoices, budgets, accruals), ERP (SAP/Oracle asset sync, cost allocation, GL, AP),
**BMS** (asset exchange, maintenance alerts, sensor data, equipment status), HR/payroll (employees,
timesheets, leave), email (inbound parsing to work orders), document management. Integrations are scoped and
**quoted separately from the platform** through a five-phase process (discovery, development, testing,
deployment, support).

## Implementation and support model

Bronze (client-led, train-the-trainer), Silver (design workshops + train-the-trainer), Gold (full service,
client does UAT). Eight phases totalling **9–14 weeks**: planning, process design, configuration, data
migration, UAT, training, go-live with hypercare, post-go-live. Support: 24/7 knowledge base, business-hours
chat/email/phone across **AU, SA, UAE, UK** time zones, optional premium tier, three support tiers.

## Relevance to the new platform

Adds to the BRD: work-order and PPM engine with SLA timers, maintenance templates and 12-month planner;
contractor onboarding, rate cards and compliance-document expiry; budgets with blocking and 80% warnings;
quote → PO → invoice chain; building compliance auto-allocation; JSA safety gate; a customer portal role; a
capital-replacement forecast. Several of these (budgets, invoicing, contractor performance) are far outside
an IoT platform's core and should be scoped as separate modules or integrations.
