# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

Working directory for the **Cross-Border Assisted Commerce Platform** — a link-first service that lets Iranian consumers paste a foreign marketplace URL (Amazon UAE at MVP) and receive the item in Iran, paying in IRR, with unified multi-leg tracking.

Two layers live here: the **phase deliverables** that specify the product, and the **`platform/` monorepo** that implements it.

### Phase deliverables (specification)

`.md` files are the source of truth; the `.docx`/`.pdf`/`.xlsx` twins are exports of them.

- `technical-blueprint-v1.md` — **the governing spec.** Product definition + technical architecture. Read before any design or implementation decision.
- `feasibility-revalidation-v0.2.md` — feasibility, AI substrate, business lines
- `phase-0.3-logistics-feasibility.md` — logistics/customs economics
- `build_logistics_model.py` — regenerates `Logistics-Economics-v0.3.xlsx` (openpyxl). Blue font = hardcoded input, black = formula. Editing the workbook by hand is wrong; edit the script and re-run.
- `prototype.html` — single-file clickable UX prototype. No build step; open it directly.
- `platform-scaffold/` — the original zero-dependency proof that the core domain works on stub adapters. **Superseded by `platform/`**; kept as the reference implementation of the domain rules.

Loose `.jpg`, `.tmp`, `unpk/`, and `~$`/`.~lock` files are throwaway artifacts of document rendering — ignore them.

Blueprint status markers are load-bearing: **DECISION** = locked choice, **GATE** = external dependency (build interface-first), **BUILD** = to implement, **RULE** = enforced business rule. Don't silently override a DECISION or downgrade a RULE.

## Commands

```bash
# --- platform/ monorepo (pnpm + Turborepo, Node >= 22) ---
cd platform
pnpm install
docker compose up -d          # Postgres, Redis, RabbitMQ, MinIO, OTel collector
pnpm db:migrate               # apply Drizzle migrations
pnpm db:seed                  # seed dev data
pnpm dev                      # api + worker + web + admin, all watched

pnpm build                    # turbo build, all packages
pnpm typecheck                # tsc --noEmit across the graph
pnpm lint
pnpm test                     # vitest, whole workspace
pnpm test -- path/to/file.test.ts        # single file
pnpm test -- -t "name of the test"       # single test by name
pnpm --filter @xb/api test               # one package only

pnpm db:generate              # regenerate migrations after editing schema

# --- legacy scaffold ---
cd platform-scaffold && npm run demo

# --- regenerate the economics workbook ---
python3 build_logistics_model.py
```

## Stack — locked

| Layer | Choice |
|---|---|
| Backend | **NestJS** (TypeScript) modular monolith + separate worker process |
| Frontend | **Next.js**, **static export only** (`output: 'export'`) — front office + back office |
| Data | **PostgreSQL** via **Drizzle ORM** (SQL-first, plain-SQL migrations) |
| Cache | **Redis** — cache-aside with single-flight + TTL jitter |
| Messaging | **RabbitMQ** — topic exchanges, DLQ, retry-with-backoff |
| Storage | **MinIO** (S3-compatible) |
| Auth | **JWT** access + refresh, multi-provider identity |
| Validation | **Zod** with a bilingual (fa/en) error map |
| Logging | **pino** structured logs + **OpenTelemetry** traces/metrics |

### Deviations from `technical-blueprint-v1.md` — deliberate

These override blueprint DECISIONs. Do not "fix" them back.

1. **No SSR.** The blueprint chose SSR for Instagram/Telegram link previews. We use static export plus a small dedicated **OG meta service** (`apps/og`) that serves crawler-facing meta tags for shareable routes. That recovers the preview benefit without a Node runtime for the app itself.
2. **RabbitMQ, not BullMQ.** Real dead-letter topology, per-queue routing, and backoff exchanges. Redis remains, but only for cache and the FX snapshot — never as a queue.
3. **Back office is Next.js**, not React+Vite. One toolchain, one generated API client.

## Architecture — the rules that matter

The blueprint locks a **modular monolith with ports & adapters (hexagonal)**. The reason is specific and drives everything: three dependencies are still gated externally (foreign payment/banking, procurement method, logistics/customs). Each sits behind an **interface**, shipped first as a stub, later swapped for a real provider **with zero core rework**.

```
platform/
  packages/
    core           Money, Result, DomainEvent, error taxonomy — zero deps
    contracts      Zod schemas + inferred types shared by API, workers, and both frontends
    validation     Zod bilingual (fa/en) error map + validation pipe
    observability  pino logger, OTel setup, correlation-id propagation
    cache          cache-aside with single-flight, TTL jitter, negative caching
    messaging      RabbitMQ topology, transactional outbox, DLQ, retry
    resilience     circuit breaker, retry, timeout — composed as proxy decorators
    db             Drizzle schema, migrations, repositories, unit of work
    storage        MinIO adapter
  apps/
    api            NestJS modular monolith (HTTP + WS)
    worker         NestJS RabbitMQ consumers
    web            Next.js front office (static export, Persian-first RTL)
    admin          Next.js back office (static export)
    og             OG meta-tag service for crawlers
```

### Non-negotiable invariants

- **`Money` is a value object** (`{amount, currency}`), mandatory for every monetary value. Arithmetic throws on currency mismatch rather than coercing. **AI never produces or writes a financial record** — the ledger is deterministic and double-entry.
- **Every order state change goes through the transition table.** Illegal transitions throw. Each transition appends to an immutable timeline, the single source of truth for tracking, audit, and support.
- **Payment ≠ purchased.** A successful gateway charge yields `PAID`, never `PURCHASED`. Collapsing them is a correctness bug.
- **Max-procurement-price guard.** If the marketplace price at purchase time exceeds the quote's `maxProcurementPrice`, the order branches to `PRICE_CHANGED` — never a silent negative-margin purchase.
- **Viability gate.** Orders whose logistics overhead exceeds the threshold are blocked at creation (the v0.3 minimum-order-value rule).
- **Revalidate at checkout.** Immediately before the payment gateway, refresh offer + availability + FX and lock the quote for its TTL.
- `Order` and `ProcurementOrder` are **distinct aggregates** — one customer order can split across marketplaces.

### Structural rules

- **The composition root is the only place that knows which adapter is live.** If swapping an adapter requires touching the core, the change is wrong.
- **Every outbound third-party call goes through a port, and every port is wrapped in the proxy chain** (`cache → circuit breaker → retry → timeout → instrumentation → adapter`). Never call an SDK or `fetch` directly from a service.
- **Multi-provider by default** for payment, identity, FX, and SMS: a provider registry plus a failover chain behind one port. Adding a provider means adding one adapter and one registry entry — nothing else.
- **Events cross module boundaries; direct cross-module calls do not.** Domain events are written to the **outbox in the same transaction** as the state change, then relayed to RabbitMQ. This is what makes later extraction into services possible.
- **Every mutating endpoint that touches money or a third party takes an idempotency key.**
- Reads that hit a third party or an expensive join go through **cache-aside** in the `cache` package — not ad-hoc Redis calls.

## Product rules that constrain implementation

- **Link-first only.** No catalog, search, or merchandising. One paste-a-link flow.
- **Manage-by-exception.** The back office default view is the ranked exception queue (margin-at-risk × urgency), never a list of healthy orders.
- **Persian-first, RTL, mobile-first.** Customer-facing strings are Persian; the UI is RTL by default. Validation errors are returned in **both fa and en** — the client picks.
- Unified tracking **normalizes** every carrier/warehouse/marketplace status into one customer-legible lifecycle — never leak raw carrier statuses to the customer.
- No architecture path may depend on concealment, account sharing, or bypassing marketplace/AML controls. The compliance gate is the master switch before production.

## Conventions

- TypeScript strict, ESM. `import type` for type-only imports.
- Package names are scoped `@xb/*` and imported by that name, never by relative path across package boundaries.
- Errors are a typed taxonomy in `@xb/core`, surfaced through one global exception filter into a single error envelope. Services return `Result` for expected failures and throw only for programmer errors.
- Log through the `@xb/observability` logger only — never `console.*`. Every log line carries the correlation id automatically.
- Schemas live in `@xb/contracts` and are the single source of truth: request/response validation, generated types, and the frontend client all derive from them.
