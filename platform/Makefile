# Platform stack: ThingsBoard CE (unmodified) + Node API/worker/simulator + React web, on Docker Compose.
# Run `make help` for targets. Requires Docker with Compose v2, Node 22+ and pnpm 11 (corepack) for tests.

SHELL := /bin/bash
.DEFAULT_GOAL := help

COMPOSE ?= docker compose
TENANT  ?= alpha
DATASET ?= office-demo
WEEKS   ?= 12
API_HEALTH ?= http://localhost:4000/health
TB_HEALTH  ?= http://localhost:8090/api/auth/login

CLI = $(COMPOSE) run --rm --no-deps api node dist/cli.js

.PHONY: help env up down stop logs ps build provision dataset user backfill test lint typecheck e2e ui-audit backup restore

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'
	@echo
	@echo "Variables: TENANT=$(TENANT) DATASET=$(DATASET) WEEKS=$(WEEKS) RESET= (set RESET=1 to reset a dataset)"

env: ## Create .env from .env.example when missing
	@test -f .env || (cp .env.example .env && echo "created .env from .env.example (local credentials, edit as needed)")

up: env ## Build and start everything, wait for ThingsBoard and the API to be healthy
	$(COMPOSE) up -d --build
	@echo "waiting for ThingsBoard at $(TB_HEALTH) ..."
	@for i in $$(seq 1 120); do \
	  code=$$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"username":"probe","password":"probe"}' $(TB_HEALTH) || true); \
	  if [[ "$$code" =~ ^(200|401)$$ ]]; then echo "ThingsBoard up (login endpoint answered $$code)"; break; fi; \
	  sleep 5; \
	  if [ $$i -eq 120 ]; then echo "ThingsBoard did not become healthy"; exit 1; fi; \
	done
	@echo "waiting for API at $(API_HEALTH) ..."
	@for i in $$(seq 1 60); do \
	  if curl -fs $(API_HEALTH) >/dev/null; then echo "API up"; break; fi; \
	  sleep 3; \
	  if [ $$i -eq 60 ]; then echo "API did not become healthy"; $(COMPOSE) logs --tail=50 api; exit 1; fi; \
	done
	@echo "web: http://alpha.localhost:$${WEB_PORT:-8081}  api docs: http://localhost:4000/docs  mail: http://localhost:8025"

down: ## Stop and remove containers, networks and volumes (full reset)
	$(COMPOSE) down -v --remove-orphans

stop: ## Stop containers, keep data
	$(COMPOSE) stop

logs: ## Follow logs (SERVICE=api to filter)
	$(COMPOSE) logs -f --tail=200 $(SERVICE)

ps: ## Show container status
	$(COMPOSE) ps

build: ## Build all images without starting
	$(COMPOSE) build

provision: env ## Provision a tenant in ThingsBoard and the API (TENANT=alpha [DATASET=office-demo])
	$(CLI) provision --tenant $(TENANT) $(if $(DATASET),--dataset $(DATASET))

dataset: env ## Load a dataset into a tenant (TENANT=alpha DATASET=office-demo [RESET=1])
	$(CLI) dataset --tenant $(TENANT) --dataset $(DATASET) $(if $(RESET),--reset)

user: env ## Create/update a user in a tenant (TENANT=gamma EMAIL=admin@gamma.demo [ROLE=TENANT_ADMIN] [PASSWORD=...] [NAME=...])
	$(CLI) user --tenant $(TENANT) --email $(EMAIL) --role $(or $(ROLE),TENANT_ADMIN) $(if $(PASSWORD),--password '$(PASSWORD)') $(if $(NAME),--name '$(NAME)')

admin: env ## Create/update a platform admin for /admin (EMAIL=admin@platform.local [PASSWORD=...] [NAME=...])
	$(CLI) admin --email $(EMAIL) $(if $(PASSWORD),--password '$(PASSWORD)') $(if $(NAME),--name '$(NAME)')

backfill: env ## Backfill history for a tenant (TENANT=alpha WEEKS=12)
	$(CLI) backfill --tenant $(TENANT) --weeks $(WEEKS)

test: ## Run unit tests in every package
	pnpm test

lint: ## ESLint across the workspace
	pnpm lint

typecheck: ## TypeScript checks across the workspace
	pnpm typecheck

e2e: ## Playwright tests against the running stack
	pnpm --filter @platform/e2e e2e

e2e-live: ## Live checks against a deployed platform (LIVE_PLATFORM_HOST, LIVE_TENANT, PLATFORM_ADMIN_*, DATASET_USER_PASSWORD)
	cd e2e && npx playwright test -c playwright.live.config.ts $(ARGS)

ui-audit: ## Visit every route at four viewport sizes and report layout defects (BASE_URL=http://alpha.localhost:8081)
	cd e2e && node tools/ui-audit.mjs --base $(or $(BASE_URL),http://alpha.localhost:8081) --out ./audit

backup: env ## Dump the platform database and the IoT core volumes to a tarball (FILE=backups/....tar.gz)
	./deploy/backup.sh $(FILE)

restore: env ## Restore a backup made by make backup (FILE=backups/....tar.gz)
	./deploy/restore.sh $(FILE)
