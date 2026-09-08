# ThingsBoard local dev helper. Run `make help` for targets.
# Requires: Homebrew openjdk@25, maven, docker (see .claude/env.sh for the same settings).

SHELL := /bin/bash
.DEFAULT_GOAL := help

TB_VERSION   := $(shell grep -m1 '<version>' pom.xml | sed -E 's/.*<version>(.*)<\/version>.*/\1/')
BOOT_JAR     := application/target/thingsboard-$(TB_VERSION)-boot.jar
DATA_DIR     := application/target/data

# Toolchain
export JAVA_HOME   := /opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home
export PATH        := $(JAVA_HOME)/bin:$(PATH)
export MAVEN_OPTS  := -Xmx1024m
export NODE_OPTIONS := --max_old_space_size=4096
export SUREFIRE_JAVA_OPTS := -Xmx1200m -Xss256k -XX:+ExitOnOutOfMemoryError

# Dedicated Postgres (5432 is used by another project)
PG_CONTAINER := tb-postgres
PG_PORT      := 5433
export SPRING_DATASOURCE_URL      := jdbc:postgresql://localhost:$(PG_PORT)/thingsboard
export SPRING_DATASOURCE_USERNAME := postgres
export SPRING_DATASOURCE_PASSWORD := postgres

INSTALL_FLAGS := -Dloader.main=org.thingsboard.server.ThingsboardInstallApplication \
                 -Dinstall.data_dir=$(DATA_DIR) \
                 -Dinstall.load_demo=true \
                 -Dspring.jpa.hibernate.ddl-auto=none
LAUNCHER      := org.springframework.boot.loader.launch.PropertiesLauncher

.PHONY: help build build-backend bootjar db-up db-down db-reset db-install db-upgrade run ui test clean status

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

build: ## Full build of all modules (skips tests and deb/rpm/zip), then boot jar
	mvn clean install -T6 -DskipTests -Dpkg.skip=true
	$(MAKE) bootjar

build-backend: ## Build only application + its Java deps (no UI rebuild), then boot jar
	mvn install -T6 -DskipTests -Dpkg.skip=true -pl application -am -Dmaven.javadoc.skip
	$(MAKE) bootjar

bootjar: ## Package the executable boot jar (-Ppackaging is required with pkg.skip.* flags)
	mvn -pl application package -Ppackaging -DskipTests -Dpkg.skip.deb=true -Dpkg.skip.rpm=true -Dpkg.skip.zip=true

$(BOOT_JAR):
	$(MAKE) build

db-up: ## Start (or create) the tb-postgres container on port 5433
	@docker start $(PG_CONTAINER) >/dev/null 2>&1 || \
	 docker run -d --name $(PG_CONTAINER) --restart unless-stopped -p $(PG_PORT):5432 \
	   -e POSTGRES_DB=thingsboard -e POSTGRES_PASSWORD=postgres \
	   -v tb-postgres-data:/var/lib/postgresql/data postgres:16 >/dev/null
	@until docker exec $(PG_CONTAINER) pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
	@echo "postgres ready on localhost:$(PG_PORT)"

db-down: ## Stop the tb-postgres container (data is kept)
	docker stop $(PG_CONTAINER)

db-reset: ## DESTRUCTIVE: drop the thingsboard database and reinstall schema + demo data
	docker exec $(PG_CONTAINER) psql -U postgres -c "DROP DATABASE IF EXISTS thingsboard;" -c "CREATE DATABASE thingsboard;"
	$(MAKE) db-install

db-install: $(BOOT_JAR) db-up ## Install schema + system + demo data (fresh DB only)
	java -cp $(BOOT_JAR) $(INSTALL_FLAGS) -Dinstall.upgrade=false $(LAUNCHER)

db-upgrade: $(BOOT_JAR) db-up ## Run DB upgrade scripts (after pulling a newer version)
	java -cp $(BOOT_JAR) $(INSTALL_FLAGS) -Dinstall.upgrade=true $(LAUNCHER)

run: $(BOOT_JAR) db-up ## Start the ThingsBoard server on http://localhost:8080
	java -jar $(BOOT_JAR)

ui: ## Start the Angular dev server on http://localhost:4200 (proxies to :8080)
	cd ui-ngx && yarn install && yarn start

test: ## Fast unit tests outside application/dao (see TEST_FAST.md for the rest)
	mvn test -pl='!application,!dao,!ui-ngx,!msa/js-executor,!msa/web-ui' -T4

clean: ## mvn clean
	mvn clean -T6

status: ## Show toolchain, DB and port status
	@echo "java:    $$(java -version 2>&1 | head -1)"
	@echo "mvn:     $$(mvn -v 2>/dev/null | head -1)"
	@echo "bootjar: $$( [ -f $(BOOT_JAR) ] && echo present || echo missing ) ($(BOOT_JAR))"
	@echo "db:      $$(docker ps --filter name=$(PG_CONTAINER) --format '{{.Status}}' | grep . || echo stopped)"
	@echo "8080:    $$(lsof -nP -iTCP:8080 -sTCP:LISTEN -t >/dev/null 2>&1 && echo in use || echo free)"
