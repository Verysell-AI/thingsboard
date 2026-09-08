# Local Development Setup (this machine, verified 2026-09-06)

## Toolchain

| Tool | Version / location | Notes |
|------|--------------------|-------|
| JDK | OpenJDK 25.0.4 — `/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home` | Homebrew keg-only. System `java` is still Temurin 19 (other projects rely on it). `pom.xml` sets `maven.compiler.source/target=25`, so Java 19 fails. |
| Maven | 3.9.16 — `/opt/homebrew/bin/mvn` | Uses whatever `JAVA_HOME` points at. |
| Node / yarn | Node 24 (nvm), yarn 1.22.22 (global npm) | Only needed for `yarn start` in `ui-ngx`. The Maven build downloads its own Node 22.22.2 + yarn into `ui-ngx/node/`. |
| Docker | OrbStack, Docker 29.4, Compose 5.1 | Testcontainers work against it. |
| Postgres | container `tb-postgres`, image `postgres:16`, host port **5433** | See below. |

Two equivalent ways to get the environment:

1. `make <target>` — the root `Makefile` exports `JAVA_HOME`, `MAVEN_OPTS`, `NODE_OPTIONS` and the datasource variables itself.
2. `source .claude/env.sh` — same variables for ad-hoc `mvn`/`java` commands. (`.claude/` is gitignored in this repo.)

## Database

Port 5432 on this machine belongs to another project's container (`nora-compliance-be-db-1`). **Do not use it.**
ThingsBoard uses its own container:

```
docker run -d --name tb-postgres --restart unless-stopped -p 5433:5432 \
  -e POSTGRES_DB=thingsboard -e POSTGRES_PASSWORD=postgres \
  -v tb-postgres-data:/var/lib/postgresql/data postgres:16
```
`make db-up` does this (or just starts it). Connection: `jdbc:postgresql://localhost:5433/thingsboard`, `postgres` / `postgres`.
Schema, system data and demo data are already installed. `make db-reset` drops and reinstalls (destructive).

## Build

```bash
make build           # mvn clean install -T6 -DskipTests -Dpkg.skip=true  (+ bootjar). ~26 min cold, incl. Angular build
make build-backend   # only application + Java deps (-pl application -am), reuses the last UI build from ~/.m2
make bootjar         # repackage application/target/thingsboard-4.4.0-SNAPSHOT-boot.jar (~1 min)
```

### Packaging trap (important)

`-Dpkg.skip=true` or **any** `-Dpkg.skip.<x>=true` flag activates a `skip-*` profile in the root pom. Maven then
deactivates the `activeByDefault` profile named `packaging`, which is where the `spring-boot:repackage` execution,
the `copy-resources` of `dao` SQL into `application/target/data`, and the deb/rpm/zip plugins live. Result: the build
reports SUCCESS but produces **no `-boot.jar`** and no `target/data/sql`. Fix: pass `-Ppackaging` explicitly:

```bash
mvn -pl application package -Ppackaging -DskipTests -Dpkg.skip.deb=true -Dpkg.skip.rpm=true -Dpkg.skip.zip=true
```
`make bootjar` does exactly this. The gradle plugin still runs (`build` task only, ~30 s) — that is expected.

## Install / upgrade the database

The installer is a second Spring Boot main class inside the boot jar:

```bash
java -cp application/target/thingsboard-4.4.0-SNAPSHOT-boot.jar \
  -Dloader.main=org.thingsboard.server.ThingsboardInstallApplication \
  -Dinstall.data_dir=application/target/data \
  -Dinstall.load_demo=true -Dspring.jpa.hibernate.ddl-auto=none -Dinstall.upgrade=false \
  org.springframework.boot.loader.launch.PropertiesLauncher
```
`make db-install` / `make db-upgrade` wrap this. Notes:
- `install.data_dir` must be `application/target/data` (contains `sql/` copied from `dao`). `application/src/main/data` lacks `sql/` and fails with `NoSuchFileException: .../sql/schema-entities.sql`.
- Install on a non-empty DB fails; use `make db-reset`. After pulling a newer version run `make db-upgrade` (`-Dinstall.upgrade=true`).
- Running from an IDE: use main class `ThingsboardInstallApplication`, working dir = repo root, same `-D` flags.

## Run

```bash
./run.sh              # == make run: db-up, build bootjar if missing, java -jar ...-boot.jar
```
- UI + REST: http://localhost:8080 (starts in ~15–20 s). Swagger: http://localhost:8080/swagger-ui.html
- MQTT 1883, CoAP 5683, LwM2M 5685; HTTP device API under `/api/v1/` on 8080.
- Logins: `sysadmin@thingsboard.org/sysadmin`, `tenant@thingsboard.org/tenant`, `customer@thingsboard.org/customer`.
- From IDE: run `org.thingsboard.server.ThingsboardServerApplication` with working dir = repo root (needed for data dir lookup) and env `SPRING_DATASOURCE_URL=jdbc:postgresql://localhost:5433/thingsboard`.
- Logs go to stdout with `logback.xml`; set `-Dlogging.level.org.thingsboard=DEBUG` for verbose.

## UI development

```bash
make ui               # cd ui-ngx && yarn install && yarn start  -> http://localhost:4200
```
`ui-ngx/proxy.conf.js` proxies `/api`, `/api/ws`, `/static/*`, `/oauth2` to `localhost:8080`, so the backend must be running.
Path aliases (`@core`, `@shared`, `@home`, …) are in `ui-ngx/tsconfig.json`; page/route map in `ui-ngx/structure.md`.
Lint: `cd ui-ngx && yarn lint`. Production build happens through Maven (`ng build`), output copied into the `application` jar.

## Housekeeping

- Only stop processes you started. `tb-postgres` is meant to stay up (`--restart unless-stopped`).
- Build logs from the initial setup are in the session scratchpad, not in the repo.
- `.claude/rules/thingsboard-dev.md` mirrors the key commands for Claude Code sessions.
