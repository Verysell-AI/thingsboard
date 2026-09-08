# Community Edition — Feature Gaps to Know Before Scoping

Verified against this source tree (grep of `common/data`, `dao`, `application`, `ui-ngx`) on 2026-09-07.
These are Professional Edition features that **do not exist in CE** and would have to be built in a fork.

| Capability | CE status | Evidence / implication |
|------------|-----------|------------------------|
| White labeling (logo, colours, domain, mail templates per tenant/customer) | Absent | No `whiteLabel*` classes, no per-tenant UI theming beyond a global "UI settings" admin page. Requires new entity, admin settings hierarchy, UI theming pipeline, and mail template resolution. |
| Customer hierarchy (sub-customers) | Absent | `Customer` has only `tenantId`; no `parentCustomerId`, no hierarchy queries or permission propagation. Multi-level resale (vendor → customer → sub-customer) needs data model, permission, dashboard-assignment and UI changes. |
| Role-based access control / custom roles | Absent | Only fixed authorities `SYS_ADMIN`, `TENANT_ADMIN`, `CUSTOMER_USER`; permissions hard-coded in `application/service/security/permission`. |
| Entity groups | Absent | Assignment is per-entity to one customer. |
| Integrations (OPC-UA, LoRaWAN NS, Azure/AWS IoT Hub, Sigfox, HTTP/MQTT integrations, converters) | Absent | No `Integration` entity/type. `application/service/iot_hub` is a narrower feature. Workarounds: external gateway (ThingsBoard IoT Gateway, custom services) publishing via MQTT/HTTP. |
| Scheduler (scheduled RPC/reports) | Absent | Rule-engine "generator" node is the only timer primitive. |
| Reporting (PDF/scheduled dashboard export) | Absent | Needs `web-report` service (PE). |
| Platform (multi-tenant) SSO with per-tenant OAuth2 | Partial | OAuth2 exists (`OAuth2Controller`, `domain/`) at system level with domain mapping; per-customer branding of login is not there. |
| Self-registration of customers | Absent | |
| Advanced dashboards: drill-down / state navigation | Present | Dashboard *states* + entity aliases + relations provide hierarchical drill-down in CE; drag-and-drop dashboard editor is CE. |
| Edge, Version control, Notifications, Calculated fields, EDQS, Trendz hook, Mobile app bundles, AI models | Present in CE (4.x) | |

## Implications for a CE-based multi-tenant product

- Tenancy today = one **Tenant per customer organisation**, with ThingsBoard *Customers* as their end-clients (one level). A third level requires the customer-hierarchy work above.
- Every CE fork feature raises the cost of following upstream (`master` moves fast: 4.2 → 4.4 within this repo's recent history). Keep custom code in new packages/modules and behind clear interfaces; avoid editing core services in place where a Spring `@Primary` override or event listener works.
- License: Apache 2.0 — forking and on-prem redistribution are allowed; PE features cannot be copied.
- Upstream REST API is broadly stable but 4.x changed several DTOs vs 3.x; external clients built for 3.5 (e.g. community .NET wrappers) need re-validation.
