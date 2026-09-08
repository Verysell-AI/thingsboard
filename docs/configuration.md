# Configuration

Single source: `application/src/main/resources/thingsboard.yml`. Every value is `${ENV_VAR:default}`, so configure
via environment variables (or `-D` system properties / `--key=value`). Spring profiles: none for the server,
`install` for the installer, `openapi` for spec generation.

## Most-used variables

| Area | Variable | Default | Notes |
|------|----------|---------|-------|
| HTTP | `HTTP_BIND_PORT` | 8080 | UI, REST, WebSocket and HTTP transport (monolith) |
| DB | `SPRING_DATASOURCE_URL` | `jdbc:postgresql://localhost:5432/thingsboard` | local machine uses **5433** |
| DB | `SPRING_DATASOURCE_USERNAME/PASSWORD` | postgres / postgres | |
| DB | `SPRING_DATASOURCE_MAXIMUM_POOL_SIZE` | 16 | Hikari |
| Timeseries | `DATABASE_TS_TYPE` | sql | `sql`, `timescale`, or `cassandra` (hybrid) |
| Timeseries | `DATABASE_TS_LATEST_TYPE` | sql | |
| Timeseries | `SQL_POSTGRES_TS_KV_PARTITIONING` | MONTHS | ts_kv partition size |
| Timeseries | `SQL_TTL_TS_ENABLED`, `SQL_TTL_TS_TS_KEY_VALUE_TTL` | true / 0 | retention |
| Cassandra | `CASSANDRA_URL`, `CASSANDRA_KEYSPACE_NAME` | 127.0.0.1:9042 / thingsboard | only for hybrid |
| Queue | `TB_QUEUE_TYPE` | in-memory | `in-memory` or `kafka`; Kafka mandatory for microservices/cluster |
| Queue | `TB_KAFKA_SERVERS` | localhost:9092 | |
| Cache | `CACHE_TYPE` | caffeine | `caffeine` or `redis` (Valkey/Redis); redis needed for cluster |
| Cache | `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | localhost / 6379 | |
| Service | `TB_SERVICE_TYPE` | monolith | `monolith`, `tb-core`, `tb-rule-engine` |
| Service | `TB_SERVICE_ID` | hostname | unique node id in cluster |
| Cluster | `ZOOKEEPER_ENABLED`, `ZOOKEEPER_URL` | false / localhost:2181 | |
| Security | `JWT_TOKEN_SIGNING_KEY` | random at install | persisted in DB since 3.4.2; change via UI (SYS_ADMIN) |
| Security | `JWT_TOKEN_EXPIRATION_TIME` | 9000 s | access token lifetime |
| Security | `SECURITY_USER_LOGIN_CASE_SENSITIVE` etc. | | see `security:` section |
| MQTT | `MQTT_ENABLED`, `MQTT_BIND_PORT`, `MQTT_SSL_ENABLED` | true / 1883 / false | |
| CoAP | `COAP_ENABLED`, `COAP_BIND_PORT` | true / 5683 | |
| LwM2M | `LWM2M_ENABLED`, `LWM2M_BIND_PORT` | true / 5685 | |
| SNMP | `SNMP_ENABLED` | true | |
| HTTP transport | `HTTP_ENABLED` | true | `/api/v1/{token}/telemetry` etc. |
| JS execution | `JS_EVALUATOR` | local | `local` (GraalJS in-process) or `remote` (tb-js-executor) |
| Mail/SMS | configured in UI (System settings), not env | | |
| Edge | `EDGES_ENABLED`, `EDGES_RPC_PORT` | true / 7070 | gRPC for Edge |
| Install | `install.data_dir`, `install.load_demo`, `install.upgrade` | | installer only |
| Actors | `ACTORS_SYSTEM_*`, `ACTORS_RULE_*` | | dispatcher thread pools, throughput |
| Rate limits | mostly **tenant profile** settings stored in DB (REST, transport, WS, rule engine per tenant/device); yml only has a few (grep `RATE_LIMIT`/`LIMITS` in thingsboard.yml, e.g. `MAIL_PER_TENANT_RATE_LIMITS`) | | |

Full list: grep `\${` in `thingsboard.yml` (~1000 knobs). `docker/*.env` files show production-oriented values for microservices.

## Where settings live at runtime

- **Environment / yml** — infrastructure (DB, queue, ports).
- **`admin_settings` table** (SYS_ADMIN UI → Settings) — mail server, SMS, JWT key, general UI settings, notification providers, OAuth2.
- **Tenant profile** (SYS_ADMIN UI) — per-tenant limits, queues, rate limits, max devices/assets/etc.
- **Device profile** — transport config, provisioning, alarm rules, default rule chain per device type.

## Logging

`application/src/main/resources/logback.xml`. Override with `-Dlogging.config=/path/logback.xml` or
`-Dlogging.level.org.thingsboard=DEBUG` (Spring relaxed binding also accepts `LOGGING_LEVEL_ORG_THINGSBOARD=DEBUG` as an env var). Rule chain debug output is stored in `rule_node_debug_event` (enable "debug mode" per node in UI).
