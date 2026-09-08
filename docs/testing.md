# Testing

## Layout

| Where | What | Infra |
|-------|------|-------|
| `common/*`, `rule-engine/*`, `transport/*` `src/test` | Unit tests, Mockito | none |
| `dao/src/test` | DAO/JPA tests (`AbstractJpaDaoTest`, `@DaoSqlTest` service tests) | **Testcontainers** Postgres 18 via `jdbc:tc:postgresql:18:///thingsboard` (`dao/src/test/resources/sql-test.properties`); Timescale and Cassandra variants in sibling property files |
| `application/src/test` | Controller tests (`AbstractControllerTest` → MockMvc + real Spring context), rule engine, transport (MQTT/CoAP/LwM2M end-to-end against embedded servers), edge, actors, queue | Spring Boot test context with `application-test.properties`; DB via Testcontainers; `**/nosql/**` need Cassandra container |
| `msa/black-box-tests` | docker-compose based integration tests (`ContainerTestSuite`), REST + WS + MQTT against real images | Docker, built images |
| `ui-ngx` | `ng test`/`ng lint` (few unit tests; lint is the real gate) | Node |

Test base classes to extend: `AbstractControllerTest` (logs in as sysadmin/tenant/customer, helper `doPost/doGet` with JSON),
`AbstractRuleEngineControllerTest`, `AbstractNotifyEntityTest` (asserts audit/notification side effects), `AbstractJpaDaoTest`.

## Running

Requires Docker running (Testcontainers). Always build first so `~/.m2` has current module jars:

```bash
source .claude/env.sh          # or use make; JDK 25 is mandatory
mvn clean install -T6 -DskipTests -Dpkg.skip=true

# fast tier (no DB)
mvn test -pl='!application,!dao,!ui-ngx,!msa/js-executor,!msa/web-ui' -T4
# dao
mvn test -pl dao -Dparallel=packages -DforkCount=4
# application, by area (see TEST_FAST.md for the full matrix and flake retries)
mvn test -pl application -Dtest='!**/nosql/**,org.thingsboard.server.controller.**' -DforkCount=6 -Dparallel=classes
# single test
mvn test -pl application -Dtest=DeviceControllerTest -DfailIfNoTests=false
```
`make test` runs the fast tier. `SUREFIRE_JAVA_OPTS="-Xmx1200m -Xss256k -XX:+ExitOnOutOfMemoryError"` is exported by the Makefile / env.sh.

## Gotchas

- Docker 29 vs Testcontainers 1.21: if containers fail to start with an API-version error, set `"min-api-version": "1.32"` in the Docker daemon config (see `TEST_FAST.md`). OrbStack on this machine worked without it during setup (not yet exercised under test load).
- Delete `~/.testcontainers.properties` if Testcontainers cannot find Docker.
- Controller tests are slow to start (full context); run one class at a time while iterating.
- Never point tests at the dev DB on 5433; they create their own containers.
