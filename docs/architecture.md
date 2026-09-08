# Architecture

## What ThingsBoard is

A multi-tenant IoT platform: devices send telemetry over MQTT/HTTP/CoAP/LwM2M/SNMP, a rule engine
processes messages, data lands in PostgreSQL (or Cassandra/TimescaleDB for timeseries), and an Angular UI
renders dashboards built from widgets. Everything is exposed over a REST API plus a telemetry WebSocket.

Stack: Java 25, Spring Boot 3.5, Hibernate/JPA, PostgreSQL 16, optional Kafka + Valkey (Redis) for clustering,
Netty for transports, protobuf for internal messages, Angular 20 + Angular Material for the UI.

## Domain model (essential entities)

- **Tenant** — top-level isolation unit. Owns everything below. `TenantProfile` holds limits/rate limits/queues.
- **Customer** — belongs to a tenant; entities can be *assigned* to a customer so customer users see them.
  CE has exactly one customer level (no sub-customers).
- **User** — authorities `SYS_ADMIN`, `TENANT_ADMIN`, `CUSTOMER_USER`. JWT auth (`/api/auth/login`).
- **Device / Asset / EntityView / Edge** — the "things". `DeviceProfile` / `AssetProfile` define transport type,
  provisioning, alarm rules and the default rule chain.
- **Attributes** (client/server/shared scope key-values) and **Timeseries** (timestamped key-values) hang off any entity.
- **Relation** — typed directed edges between entities (`Contains`, `Manages`, custom), used for hierarchies.
- **Alarm**, **Event**, **AuditLog**, **Notification** — operational records.
- **RuleChain / RuleNode** — the processing graph. Each tenant has a root rule chain.
- **Dashboard / WidgetsBundle / WidgetType** — UI. Dashboards are JSON configs of widgets bound to entity aliases.
- **TbResource / Image / OtaPackage** — binary/blob-like resources.
- **Queue** — named rule-engine queues (Main, HighPriority, SequentialByOriginator) with per-tenant-profile config.

Entity IDs are UUID wrappers in `common/data/.../id/` (`DeviceId`, `TenantId`, …); `EntityType` enumerates all kinds.

## Message flow (monolith)

```
device --MQTT/HTTP/CoAP/LwM2M/SNMP--> transport (transport/*, common/transport)
   -> TransportService validates credentials via transport API (queue, protobuf transport.proto)
   -> publishes TbMsg to rule-engine queue (common/queue: in-memory or Kafka)
   -> TbRuleEngineConsumerService (application/service/queue) hands msg to actor system
   -> TenantActor -> RuleChainActor -> RuleNodeActor (application/actors, common/actor)
   -> rule nodes (rule-engine/rule-engine-components) e.g. "Save Timeseries" -> DAO (dao/) -> PostgreSQL
   -> subscription service (application/service/subscription) pushes updates over WebSocket (/api/ws) to UI
```

Core-side work (device state, RPC, alarms, notifications, calculated fields, housekeeper) uses the
`core` queue and `TbCoreConsumerService`. Cluster mode partitions queues by tenant/entity hash
(`common/discovery-api`, ZooKeeper for service discovery) so several `tb-node`s share load.

## Deployment shapes

- **Monolith** (`TB_SERVICE_TYPE=monolith`, default) — one JVM runs core + rule engine + all transports + UI. This is what `./run.sh` starts.
- **Microservices** (`docker/` compose, `msa/*` images) — `tb-node` (core/rule-engine), separate transport
  containers, `tb-web-ui` (Node serving the Angular build), `tb-js-executor` (Node, runs user JS), `tb-vc-executor`
  (git version control), `tb-edqs` (entity data query service), Kafka, Valkey, Postgres, HAProxy.
- **Edge** — `common/edge-api` + `application/service/edge` sync entities to remote ThingsBoard Edge instances.

## Extension points (how the platform is normally customised)

| Want to… | Do this |
|----------|---------|
| Add server-side processing | New rule node in `rule-engine-components` (annotate with `@RuleNode`, implement `TbNode`), plus its UI config in `ui-ngx` rule-node components |
| Add a REST endpoint | Controller in `application/controller` extending `BaseController`; permission checks via `accessControlService` |
| Add an entity | DTO in `common/data`, `Dao`+`Service` interface in `common/dao-api`, JPA entity + repository + service impl in `dao`, SQL in `dao/src/main/resources/sql/schema-entities.sql` **and** an upgrade script under `application/src/main/data/upgrade/`, controller, UI http service + pages |
| Add a widget | Widget bundle JSON in `application/src/main/data/json/system/widget_types/` or via UI widget editor |
| Add a transport | New module under `transport/`, register with `common/transport` service API |
| Custom UI | `ui-ngx` (Angular). Route/page map is in `ui-ngx/structure.md` |
| React to entity changes | Spring `ApplicationEvent`s in `dao/eventsourcing` (`SaveEntityEvent`, `DeleteEntityEvent`) |

## Security notes

- JWT signing key is persisted in DB at install (`security.jwt.tokenSigningKey`), rotatable by SYS_ADMIN in UI.
- Device credentials: access token, X.509, MQTT basic, LwM2M PSK/RPK. Validated through the transport API, not directly against DAO.
- Tenant isolation is enforced in services (`checkEntityId`, `accessControlService`) — every controller method must resolve the tenant from `SecurityUser`, never trust IDs from the request alone.
