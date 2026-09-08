# Module Map

Root `pom.xml` reactor order (59 modules total). Paths are relative to repo root.

## Libraries — `common/`

| Module | Contents |
|--------|----------|
| `common/data` | All DTOs, entity classes, IDs (`id/`), enums, page/query models (`query/`), `kv/` attribute+timeseries values, `msg/` TbMsg types, `alarm`, `notification`, `rule`, `widget`, `security`, `edge`, `cf` (calculated fields), `ai`. No Spring. |
| `common/dao-api` | Service + DAO **interfaces** per entity (`DeviceService`, `TimeseriesService`, `AttributesService`, …). Depend on this, not on `dao`. |
| `common/message` | `TbMsg`, `TbMsgMetaData`, message types, callbacks used across queue and rule engine. |
| `common/queue` | Queue abstraction: `memory/` (default), `kafka/`, `provider/` factories, `discovery/` partition service, `settings/`, `scheduler`, `housekeeper`, `notification`, `edqs`. |
| `common/proto` | `queue.proto`, `transport.proto`, `jsinvoke.proto` — the wire format between services. Regenerate with `build_proto.sh` if editing. |
| `common/transport` | Transport-side API: `TransportService`, session management, rate limits, credential validation, shared by all transports. |
| `common/actor` | Minimal actor framework (`TbActor`, `TbActorSystem`, mailboxes, dispatchers) used by the rule engine. |
| `common/cache` | Caffeine (default) and Redis/Valkey cache implementations + `@Cacheable` config. |
| `common/cluster-api`, `common/discovery-api` | Cluster routing and service discovery (ZooKeeper) interfaces. |
| `common/script` | JS (`js-executor` remote or Nashorn-less local) and TBEL script engines used by rule nodes and widgets. |
| `common/edge-api` | Edge sync protocol and gRPC. |
| `common/edqs` | Entity Data Query Service client/api. |
| `common/version-control` | Git-based entity version control (used by `tb-vc-executor`). |
| `common/coap-server`, `common/stats`, `common/util` | Supporting libs. |
| `netty-mqtt` | Netty-based MQTT **client** (used by MQTT rule node, tests). |

## Rule engine — `rule-engine/`

- `rule-engine-api` — `TbNode`, `TbContext`, `@RuleNode` annotation, node config base classes.
- `rule-engine-components` — all built-in nodes, grouped by package: `action`, `filter`, `transform`, `telemetry`,
  `metadata`, `flow`, `rest`, `mqtt`, `kafka`, `rabbitmq`, `mail`, `sms`, `notification`, `rpc`, `math`, `geo`,
  `deduplication`, `delay`, `edge`, `profile`, `aws`, `gcp`, `ai`, `credentials`, `transaction`, `util`.
  Each node has a matching UI config component in `ui-ngx/src/app/modules/home/components/rule-node/` (rule node UI).

## Persistence — `dao/`

`dao/src/main/java/org/thingsboard/server/dao/`
- One package per entity (`device`, `asset`, `alarm`, `customer`, `dashboard`, `relation`, `attributes`, `timeseries`, …) containing `*ServiceImpl` and DAO interfaces.
- `sql/` — JPA implementations: `*Entity` classes in `model/sql`, Spring Data repositories, `JpaXxxDao`. `sqlts/` — timeseries on Postgres/Timescale. `nosql/` — Cassandra.
- `model/` — JPA entities and `ModelConstants` (all table/column names live here).
- `eventsourcing/` — entity lifecycle Spring events. `housekeeper/` — background cleanup tasks. `cache/` — cache keys.
- `resources/sql/` — `schema-entities.sql` (tables), `schema-entities-idx.sql`, `schema-entities-idx-psql-addon.sql`, `schema-views.sql`, `schema-functions.sql`, `schema-ts-psql.sql` (partitioned `ts_kv`), `schema-ts-latest-psql.sql`, `schema-timescale.sql`.
- `ThingsboardPostgreSQLDialect.java` — custom Hibernate dialect.

Timeseries on Postgres: `ts_kv` (partitioned by time, `SQL_POSTGRES_TS_KV_PARTITIONING`), `ts_kv_latest`, keys interned in `ts_kv_dictionary`.

## Transports — `transport/`

`mqtt`, `http`, `coap`, `lwm2m`, `snmp`. Each is a library used by the monolith **and** has a standalone
Spring Boot wrapper in `msa/transport/<name>`. Ports: MQTT 1883/8883, HTTP shares 8080 in monolith, CoAP 5683, LwM2M 5685/5686.

## Application — `application/`

The monolith. `src/main/java/org/thingsboard/server/`
- `ThingsboardServerApplication` — main. `ThingsboardInstallApplication` — DB install/upgrade (`install` profile).
- `controller/` — ~65 REST controllers (Device, Asset, Alarm, Dashboard, Telemetry, RuleChain, EntityQuery, Auth, OAuth2, Notification, Edge, Job, CalculatedField, AiModel, Trendz, …). `BaseController` has all permission/lookup helpers. OpenAPI UI at `/swagger-ui.html`, spec at `/v3/api-docs`.
- `service/` — `queue/` (consumers), `ruleengine/`, `subscription/` (WS), `telemetry/`, `state/` (device activity), `rpc/`, `security/` (JWT, OAuth2, 2FA, permissions), `install/` (`InstallScripts`, upgrade services), `edge/`, `notification/`, `cf/` (calculated fields), `entitiy/` (sic — entity save/delete orchestration `TbXxxService`), `sync/` (import/export, version control), `ota/`, `housekeeper/`, `ws/`, `mail/`, `sms/`, `ai/`, `edqs/`.
- `actors/` — `ActorSystemContext`, `app/`, `tenant/`, `ruleChain/`, `device/`, `calculatedField/`.
- `config/` — Spring configs, security filters, Swagger, WebSocket.
- `src/main/resources/thingsboard.yml` — the single config file (see configuration.md). `logback.xml`. `i18n` mail templates.
- `src/main/data/` — install data: `json/system/` (widgets, SCADA symbols, OAuth templates), `json/tenant/` (default rule chains, device profile template), `json/demo/` (demo dashboards), `upgrade/` (per-version SQL and JSON upgrade steps), `lwm2m-registry/`, `resources/`, `certs/`.
- `src/test/` — see testing.md.

## Other modules

| Module | Purpose |
|--------|---------|
| `ui-ngx` | Angular 20 frontend, built by frontend-maven-plugin (downloads Node 22 + yarn 1.22). Output is packaged into `application` as static resources. See `ui-ngx/structure.md`. |
| `edqs` | Entity Data Query Service — in-memory replica for fast entity queries, optional. |
| `msa/*` | Docker images and standalone wrappers: `tb-node`, `web-ui`, `js-executor` (Node), `transport/*`, `vc-executor`, `edqs`, `monitoring`, `black-box-tests` (docker-compose integration tests). |
| `rest-client` | Java `RestClient` covering the whole REST API — handy reference for endpoint names. |
| `tools` | Misc utilities (Cassandra migration, performance tools). |
| `monitoring` | Synthetic monitoring service. |
| `packaging` | deb/rpm/windows/docker packaging templates and scripts; `packaging/java/scripts/install/install_dev_db.sh` shows the DB install JVM flags. |
| `docker` | docker-compose for microservices mode (`docker-install-tb.sh`, `docker-start-services.sh`). Not needed for monolith dev. |

## Conventions

- Lombok everywhere (`@Data`, `@Slf4j`, `@RequiredArgsConstructor`); `lombok.config` at root.
- Apache 2.0 license header required on every source file (`license-header-template.txt`); `mvn license:format` adds them.
- Entity save/delete goes through `application/service/entitiy/Tb*Service` (handles audit log, notifications, edge sync), not directly through DAO services, when called from controllers.
- Table/column names only via `ModelConstants`. Schema changes need both `schema-entities.sql` and an upgrade step.
- Tenant-scoped everything: DAO methods take `TenantId` first.
