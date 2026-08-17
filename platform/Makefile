# ─────────────────────────────────────────────────────────────────────────────
#  Cross-Border Assisted Commerce Platform — one entry point for the whole stack.
#
#      make up        infrastructure → migrations → all five processes, verified
#      make verify    typecheck · unit tests · smoke checks · full order lifecycle
#      make down      stop everything, including strays left by earlier runs
#
#  Two things here are load-bearing and should not be "tidied":
#
#  1. Every process is launched with `.env` sourced into its environment. Nothing in the
#     codebase reads a dotenv file — `loadEnv()` parses `process.env` and refuses to boot
#     on anything missing — so the environment has to be exported by whoever starts the
#     process. That is this file.
#
#  2. The API and worker logs go to /tmp/xb-api.log and /tmp/xb-worker.log because
#     scripts/smoke.sh and scripts/lifecycle.sh read the development OTP out of the API
#     log. Change those paths and the test scripts stop being able to sign in.
# ─────────────────────────────────────────────────────────────────────────────

SHELL := /bin/bash
.DEFAULT_GOAL := help
MAKEFLAGS += --no-print-directory
.NOTPARALLEL:

ROOT := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
RUN  := $(ROOT)/.run

# Ports are deliberately off the defaults: 6379 and 3000 are usually already taken by a
# local Redis and Grafana. Keep these in step with docker-compose.yml and .env.
API_URL   ?= http://localhost:4000
WEB_URL   ?= http://localhost:3010
ADMIN_URL ?= http://localhost:3011
OG_URL    ?= http://localhost:4001

API_LOG    := /tmp/xb-api.log
WORKER_LOG := /tmp/xb-worker.log
WEB_LOG    := /tmp/xb-web.log
ADMIN_LOG  := /tmp/xb-admin.log
OG_LOG     := /tmp/xb-og.log

INFRA_SERVICES := postgres redis rabbitmq minio
PG_CONTAINER   := xb-platform-postgres-1
REDIS_CONTAINER:= xb-platform-redis-1

APP_PORTS := 4000 4001 3010 3011

# Variables that may be overridden per-invocation, after .env has been sourced:
#
#     make restart SMS_PROVIDERS=fake
#
# Without this, .env always wins and trying a different adapter means editing a file that is
# deliberately gitignored — which is exactly the thing you want to avoid doing casually.
OVERRIDABLE := NODE_ENV LOG_LEVEL SANDBOX_MODE SANDBOX_ALLOW_IN_PRODUCTION \
               SMS_PROVIDERS STORE_PROVIDERS FX_PROVIDERS PAYMENT_PROVIDERS CARRIER_PROVIDERS

# Sourced into every process we start. `set -a` exports each assignment.
ENV := set -a; . $(ROOT)/.env; \
       $(foreach v,$(OVERRIDABLE),$(if $($(v)),$(v)='$($(v))';)) set +a;

# Recursive tree kill. pnpm spawns node as a child, so killing only the pnpm wrapper
# orphans the real process — which is exactly how three worker processes ended up
# running at once against the same queues.
KILLTREE := kt() { for c in $$(pgrep -P $$1 2>/dev/null); do kt $$c; done; kill $$1 2>/dev/null || true; };

C_OK   := \033[32m
C_WARN := \033[33m
C_ERR  := \033[31m
C_DIM  := \033[2m
C_B    := \033[1m
C_0    := \033[0m

# ── help ─────────────────────────────────────────────────────────────────────

.PHONY: help
help: ## Show this help
	@printf "\n$(C_B)Cross-Border Assisted Commerce Platform$(C_0)\n"
	@printf "$(C_DIM)link-first · Amazon UAE → Iran · sandbox adapters behind every gated port$(C_0)\n\n"
	@awk 'BEGIN{FS=":.*?## "} \
	  /^##@/ {printf "\n$(C_B)%s$(C_0)\n", substr($$0,5); next} \
	  /^[a-zA-Z0-9_.-]+:.*?## / {printf "  $(C_OK)%-14s$(C_0) %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@printf "\n$(C_DIM)First run:  make up      Everything green:  make verify$(C_0)\n\n"

##@ Run the whole thing

.PHONY: up
up: preflight install env infra db services wait-api banner ## Start the entire platform and verify it answers

.PHONY: down
down: stop infra-down ## Stop every process and the Docker infrastructure

.PHONY: restart
restart: stop services wait-api banner ## Restart the application processes, leave infra alone

.PHONY: demo
demo: up lifecycle ## Bring the stack up, then drive one order from paste-a-link to DELIVERED

.PHONY: dev
dev: preflight install env infra db ## Foreground watch mode (turbo dev — api, worker, web, admin)
	@printf "$(C_DIM)Watch mode. The API log is not written to $(API_LOG), so smoke/lifecycle\n"
	@printf "cannot read the dev OTP — use 'make up' for those.$(C_0)\n\n"
	@$(ENV) cd $(ROOT) && pnpm dev

##@ Individual stages

.PHONY: preflight
preflight: ## Check Docker, Node >= 22 and pnpm are present
	@printf "$(C_B)Preflight$(C_0)\n"
	@command -v docker >/dev/null 2>&1 || { printf "  $(C_ERR)docker not found$(C_0)\n"; exit 1; }
	@docker info >/dev/null 2>&1 || { printf "  $(C_ERR)the Docker daemon is not running — start Docker Desktop$(C_0)\n"; exit 1; }
	@command -v node >/dev/null 2>&1 || { printf "  $(C_ERR)node not found (need >= 22)$(C_0)\n"; exit 1; }
	@node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' \
	  || { printf "  $(C_ERR)node >= 22 required, have $$(node -v)$(C_0)\n"; exit 1; }
	@command -v pnpm >/dev/null 2>&1 || { printf "  $(C_ERR)pnpm not found — run: corepack enable$(C_0)\n"; exit 1; }
	@printf "  $(C_OK)ok$(C_0)  docker · node $$(node -v) · pnpm $$(pnpm --version)\n"

.PHONY: env
env: $(ROOT)/.env ## Create .env from .env.example if it is missing
$(ROOT)/.env:
	@test -f $(ROOT)/.env.example || { printf "  $(C_ERR).env.example is missing — cannot build .env$(C_0)\n"; exit 1; }
	@cp $(ROOT)/.env.example $@
	@printf "  $(C_WARN)created .env from .env.example$(C_0)\n"

.PHONY: install
install: $(ROOT)/node_modules/.modules.yaml ## Install workspace dependencies
$(ROOT)/node_modules/.modules.yaml: $(ROOT)/pnpm-lock.yaml
	@printf "$(C_B)Dependencies$(C_0)\n"
	@cd $(ROOT) && pnpm install
	@touch $@

.PHONY: infra
infra: ## Start Postgres, Redis, RabbitMQ, MinIO and the OTel collector, then wait for health
	@printf "$(C_B)Infrastructure$(C_0)\n"
	@cd $(ROOT) && docker compose up -d >/dev/null
	@$(MAKE) wait-infra

.PHONY: wait-infra
wait-infra: ## Block until every infrastructure container reports healthy
	@for s in $(INFRA_SERVICES); do \
	  printf "  %-9s " $$s; \
	  ok=""; \
	  for i in $$(seq 1 60); do \
	    st=$$(docker inspect -f '{{.State.Health.Status}}' xb-platform-$$s-1 2>/dev/null || echo missing); \
	    if [ "$$st" = healthy ]; then ok=1; break; fi; \
	    printf "."; sleep 2; \
	  done; \
	  if [ -n "$$ok" ]; then printf "$(C_OK)healthy$(C_0)\n"; \
	  else printf "$(C_ERR)unhealthy$(C_0)\n"; \
	       docker compose -f $(ROOT)/docker-compose.yml logs --tail 20 $$s; exit 1; fi; \
	done

.PHONY: infra-down
infra-down: ## Stop the Docker infrastructure (volumes preserved)
	@printf "$(C_B)Infrastructure$(C_0)\n"
	@cd $(ROOT) && docker compose down >/dev/null 2>&1 && printf "  $(C_OK)stopped$(C_0)\n"

.PHONY: db
db: migrate seed ## Apply migrations and seed the back-office operator accounts

.PHONY: migrate
migrate: ## Apply pending SQL migrations (append-only ledger triggers included)
	@printf "$(C_B)Database$(C_0)\n"
	@$(ENV) cd $(ROOT) && pnpm --filter @xb/db migrate 2>&1 | sed 's/^/  /'

.PHONY: seed
seed: ## Seed operator accounts (idempotent — upserts on email)
	@$(ENV) cd $(ROOT) && pnpm --filter @xb/db seed 2>&1 | sed 's/^/  /'

##@ Processes

.PHONY: services
services: start-api start-worker start-web start-admin start-og ## Start api, worker, web, admin and og in the background

# $(1) name  $(2) package  $(3) script  $(4) logfile
define start_svc
	mkdir -p $(RUN); \
	if [ -f $(RUN)/$(1).pid ] && kill -0 $$(cat $(RUN)/$(1).pid) 2>/dev/null; then \
	  printf "  %-8s $(C_DIM)already running (pid %s)$(C_0)\n" "$(1)" "$$(cat $(RUN)/$(1).pid)"; \
	else \
	  : > $(4); \
	  ( $(ENV) cd $(ROOT) && exec nohup pnpm --filter $(2) $(3) >>$(4) 2>&1 ) & \
	  echo $$! > $(RUN)/$(1).pid; \
	  printf "  %-8s $(C_OK)started$(C_0) pid %-7s $(C_DIM)%s$(C_0)\n" "$(1)" "$$(cat $(RUN)/$(1).pid)" "$(4)"; \
	fi
endef

.PHONY: start-api
start-api: ## Start the API alone (NestJS/Fastify on :4000)
	@printf "$(C_B)Processes$(C_0)\n"
	@$(call start_svc,api,@xb/api,start,$(API_LOG))

.PHONY: start-worker
start-worker: ## Start the worker alone (AMQP consumers, outbox relay, tracking poller)
	@$(call start_svc,worker,@xb/worker,start,$(WORKER_LOG))

.PHONY: start-web
start-web: ## Start the front office alone (Persian RTL, :3010)
	@$(call start_svc,web,@xb/web,dev,$(WEB_LOG))

.PHONY: start-admin
start-admin: ## Start the back office alone (exception queue, :3011)
	@$(call start_svc,admin,@xb/admin,dev,$(ADMIN_LOG))

.PHONY: start-og
start-og: ## Start the OG meta service alone (crawler link previews, :4001)
	@$(call start_svc,og,@xb/og,start,$(OG_LOG))

.PHONY: stop
stop: ## Stop every application process, pidfile-tracked or orphaned
	@printf "$(C_B)Stopping$(C_0)\n"
	@$(KILLTREE) \
	 for f in $(RUN)/*.pid; do \
	   [ -e "$$f" ] || continue; \
	   pid=$$(cat $$f); name=$$(basename $$f .pid); \
	   if kill -0 $$pid 2>/dev/null; then kt $$pid; printf "  %-8s $(C_OK)stopped$(C_0) (pid %s)\n" "$$name" "$$pid"; fi; \
	   rm -f $$f; \
	 done
	@$(MAKE) sweep

.PHONY: sweep
sweep: ## Kill platform processes left behind by earlier runs (stale workers, held ports)
	@$(KILLTREE) \
	 found=""; \
	 for port in $(APP_PORTS); do \
	   for pid in $$(lsof -ti tcp:$$port -sTCP:LISTEN 2>/dev/null); do \
	     kt $$pid; found=1; printf "  $(C_WARN)freed port %s$(C_0) (pid %s)\n" "$$port" "$$pid"; \
	   done; \
	 done; \
	 for pid in $$(pgrep -f 'src/main.ts' 2>/dev/null) $$(pgrep -f 'pnpm --filter @xb/' 2>/dev/null) $$(pgrep -f 'next dev -p 301' 2>/dev/null); do \
	   kill -0 $$pid 2>/dev/null || continue; \
	   cwd=$$(lsof -a -d cwd -p $$pid -Fn 2>/dev/null | sed -n 's/^n//p' | head -1); \
	   case "$$cwd" in \
	     $(ROOT)*) kt $$pid; found=1; printf "  $(C_WARN)stopped stray$(C_0) pid %s $(C_DIM)%s$(C_0)\n" "$$pid" "$$cwd";; \
	   esac; \
	 done; \
	 [ -n "$$found" ] || printf "  $(C_DIM)nothing stray$(C_0)\n"

.PHONY: wait-api
wait-api: ## Block until the API answers /health and reports the database ready
	@printf "$(C_B)Readiness$(C_0)\n  api      "
	@for i in $$(seq 1 90); do \
	   if curl -sf $(API_URL)/health >/dev/null 2>&1; then \
	     db=$$(curl -s $(API_URL)/ready | grep -o '"database":true' || true); \
	     if [ -n "$$db" ]; then printf "$(C_OK)ready$(C_0) $(C_DIM)(database up)$(C_0)\n"; exit 0; fi; \
	   fi; \
	   printf "."; sleep 1; \
	 done; \
	 printf "$(C_ERR)timed out$(C_0)\n\n$(C_DIM)last 25 lines of $(API_LOG):$(C_0)\n"; \
	 tail -25 $(API_LOG); exit 1

.PHONY: banner
banner: ## Print the URLs and development credentials
	@printf "\n$(C_B)Running$(C_0)\n"
	@printf "  front office   $(C_OK)$(WEB_URL)$(C_0)   $(C_DIM)Persian, RTL — paste an Amazon UAE link$(C_0)\n"
	@printf "  back office    $(C_OK)$(ADMIN_URL)$(C_0)   $(C_DIM)exception queue first, never a list of healthy orders$(C_0)\n"
	@printf "  api            $(C_OK)$(API_URL)$(C_0)   $(C_DIM)/health · /ready · /v1$(C_0)\n"
	@printf "  og service     $(C_DIM)$(OG_URL)$(C_0)\n"
	@printf "  rabbit ui      $(C_DIM)http://localhost:15672  (xb / xb)$(C_0)\n"
	@printf "  minio console  $(C_DIM)http://localhost:9001   (xbminio / xbminio123)$(C_0)\n"
	@printf "\n  back-office sign-in $(C_DIM)ops@example.ir / ops-dev-password  ·  finance@example.ir / finance-dev-password  ·  admin@example.ir / admin-dev-password$(C_0)\n"
	@printf "\n  $(C_DIM)Nothing gated is live. Click حالت نمایشی in the front office to pick a sandbox\n"
	@printf "  scenario — same controllers, guards and state machine, simulated adapters only.$(C_0)\n\n"

##@ Verify

.PHONY: verify
verify: check smoke lifecycle ## Everything: typecheck, unit tests, smoke checks, full lifecycle

.PHONY: check
check: typecheck test ## Static and unit verification, no running stack needed

.PHONY: typecheck
typecheck: ## tsc --noEmit across the workspace graph
	@cd $(ROOT) && pnpm typecheck

.PHONY: test
test: ## Unit tests (vitest, whole workspace)
	@cd $(ROOT) && pnpm test

.PHONY: lint
lint: ## Lint the workspace
	@cd $(ROOT) && pnpm lint

.PHONY: build
build: install ## Production build of every package and app
	@cd $(ROOT) && pnpm build

.PHONY: smoke
smoke: require-api ## 20 end-to-end checks against the running API
	@API=$(API_URL) bash $(ROOT)/scripts/smoke.sh

.PHONY: lifecycle
lifecycle: require-api ## Drive one order: resolve → quote → OTP → pay → procure → ship → DELIVERED
	@API=$(API_URL) SCENARIO=$${SCENARIO:-HAPPY_PATH} bash $(ROOT)/scripts/lifecycle.sh

.PHONY: scenarios
scenarios: require-api ## Run the lifecycle through the three scenarios that branch the order
	@for s in HAPPY_PATH PRICE_CHANGED_BREACH OUT_OF_STOCK_AT_PROCUREMENT; do \
	  printf "\n$(C_B)── scenario %s ──$(C_0)\n" $$s; \
	  API=$(API_URL) SCENARIO=$$s bash $(ROOT)/scripts/lifecycle.sh || exit 1; \
	done

.PHONY: require-api
require-api:
	@curl -sf $(API_URL)/health >/dev/null 2>&1 || { \
	  printf "$(C_ERR)The API is not answering on $(API_URL).$(C_0)  Run: $(C_B)make up$(C_0)\n"; exit 1; }

##@ Inspect

.PHONY: status
status: ## What is running: containers, processes, ports
	@printf "\n$(C_B)Infrastructure$(C_0)\n"
	@for s in $(INFRA_SERVICES); do \
	  st=$$(docker inspect -f '{{.State.Health.Status}}' xb-platform-$$s-1 2>/dev/null || echo "not running"); \
	  case "$$st" in healthy) c="$(C_OK)";; *) c="$(C_ERR)";; esac; \
	  printf "  %-9s $$c%s$(C_0)\n" "$$s" "$$st"; \
	done
	@printf "\n$(C_B)Processes$(C_0)\n"
	@for n in api worker web admin og; do \
	  f=$(RUN)/$$n.pid; \
	  if [ -f $$f ] && kill -0 $$(cat $$f) 2>/dev/null; then \
	    printf "  %-8s $(C_OK)up$(C_0)   pid %s\n" "$$n" "$$(cat $$f)"; \
	  else printf "  %-8s $(C_DIM)down$(C_0)\n" "$$n"; fi; \
	done
	@printf "\n$(C_B)Ports$(C_0)\n"
	@for p in $(APP_PORTS); do \
	  pid=$$(lsof -ti tcp:$$p -sTCP:LISTEN 2>/dev/null | head -1); \
	  if [ -n "$$pid" ]; then printf "  %-6s $(C_OK)listening$(C_0) (pid %s)\n" "$$p" "$$pid"; \
	  else printf "  %-6s $(C_DIM)free$(C_0)\n" "$$p"; fi; \
	done
	@printf "\n$(C_B)API$(C_0)\n  "
	@curl -s -m 2 $(API_URL)/ready 2>/dev/null || printf "$(C_DIM)no answer$(C_0)"
	@printf "\n\n"

.PHONY: logs
logs: ## Follow every application log
	@tail -n 40 -F $(API_LOG) $(WORKER_LOG) $(WEB_LOG) $(ADMIN_LOG) $(OG_LOG) 2>/dev/null

.PHONY: logs-api
logs-api: ## Follow the API log
	@tail -n 80 -F $(API_LOG)

.PHONY: logs-worker
logs-worker: ## Follow the worker log
	@tail -n 80 -F $(WORKER_LOG)

.PHONY: logs-infra
logs-infra: ## Follow the Docker infrastructure logs
	@cd $(ROOT) && docker compose logs -f --tail 60

.PHONY: psql
psql: ## Open a psql shell on the platform database
	@docker exec -it $(PG_CONTAINER) psql -U xb -d xb

.PHONY: redis
redis: ## Open a redis-cli shell
	@docker exec -it $(REDIS_CONTAINER) redis-cli

.PHONY: ledger
ledger: ## Show ledger balances per account — they must net to zero
	@docker exec $(PG_CONTAINER) psql -U xb -d xb -c \
	  "SELECT account, currency, sum(debit_minor) AS debits, sum(credit_minor) AS credits, \
	          sum(debit_minor) - sum(credit_minor) AS balance \
	     FROM ledger_entry GROUP BY account, currency ORDER BY account;"

.PHONY: open
open: ## Open the front office, back office and RabbitMQ UI in a browser (macOS)
	@command -v open >/dev/null 2>&1 || { printf "$(C_ERR)'open' is macOS-only$(C_0)\n"; exit 1; }
	@open $(WEB_URL) $(ADMIN_URL) http://localhost:15672

##@ Reset

.PHONY: clean
clean: ## Remove build output, logs and pidfiles (dependencies and data untouched)
	@rm -rf $(RUN) $(ROOT)/.turbo $(ROOT)/apps/*/.next $(ROOT)/apps/*/out $(ROOT)/packages/*/dist
	@rm -f $(API_LOG) $(WORKER_LOG) $(WEB_LOG) $(ADMIN_LOG) $(OG_LOG)
	@printf "  $(C_OK)cleaned$(C_0)\n"

.PHONY: nuke
nuke: stop ## Destroy the Docker volumes too — every order, ledger entry and message is lost
	@printf "$(C_WARN)This deletes the Postgres, Redis, RabbitMQ and MinIO volumes.$(C_0)\n"
	@read -p "  Type 'yes' to continue: " a; [ "$$a" = yes ] || { printf "  aborted\n"; exit 1; }
	@cd $(ROOT) && docker compose down -v >/dev/null
	@printf "  $(C_OK)volumes destroyed$(C_0) — run 'make up' for a fresh stack\n"
