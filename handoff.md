# Handoff — Cross-Border Assisted Commerce Platform

## 1. Goal

Build a **link-first commerce platform** that lets Iranian consumers paste a foreign marketplace URL (Amazon UAE at MVP), see a fully itemized landed cost in IRR/Toman, pay, and track delivery to Iran. The system uses a **modular monolith with hexagonal architecture** so that three gated dependencies (foreign payment, procurement, logistics) can be swapped from sandbox stubs to real providers with zero core rework.

Key product constraints: no catalog/search (paste-a-link only), Persian-first RTL mobile-first UI, bilingual (fa/en) error messages, manage-by-exception back office, unified carrier-agnostic tracking, and strict compliance — no architecture path depends on concealment or AML bypass.

---

## 2. Current State

**Working and verified:**
- Full API (NestJS/Fastify) with 24-state order state machine, quote engine, OTP auth, RBAC, idempotency, sandbox system
- Worker process with AMQP consumers, outbox relay, tracking poller, FX refresh, stall detector
- Front office (Next.js static export, Persian RTL) — paste link → quote with breakdown → OTP login → address → pay → track
- Back office (Next.js static export, English LTR) — exception queue, procurement copilot, manual transitions, ledger/finance
- OG meta service for crawler link previews
- 12 sandbox scenarios with virtual clock, deterministic seeding, Redis-shared sessions
- Simulated payment gateway (HTML page driving the real settlement path)
- 120 unit tests passing, 20 smoke checks, full lifecycle script reaching DELIVERED
- Docker Compose infrastructure: Postgres, Redis (port 6380), RabbitMQ, MinIO, OTel collector

**Not running right now:**
- API server (`apps/api`) — needs `pnpm dev` to start (was stopped when context expired)
- Worker process (`apps/worker`) — same

**Not yet built (gated on external providers):**
- Real payment gateway integration (behind `PaymentPort`)
- Real procurement/purchasing integration (behind `ProcurementPort`)
- Real logistics/carrier integration (behind `LogisticsPort`)
- Production deployment configuration

---

## 3. Active Files

### Apps
| Path | Description |
|---|---|
| `apps/api/src/main.ts` | Fastify bootstrap, custom JSON parser for empty bodies, CORS |
| `apps/api/src/app.module.ts` | Root NestJS module |
| `apps/api/src/infrastructure.module.ts` | Global port bindings with sandbox-aware routing |
| `apps/api/src/modules/auth.module.ts` | OTP auth, JWT, refresh rotation, operator login |
| `apps/api/src/modules/commerce.module.ts` | Catalog, quotes, orders, payment start/settle |
| `apps/api/src/modules/admin.module.ts` | Exception queue, procurement copilot, finance/ledger |
| `apps/api/src/modules/sandbox.module.ts` | Sandbox sessions, simulated payment gateway |
| `apps/api/src/common/http.ts` | Middleware, guards, interceptors, decorators |
| `apps/api/src/composition/adapters.ts` | Proxy chain wiring (cache→breaker→retry→timeout) |
| `apps/api/src/composition/sandbox-routing.ts` | Context-aware adapter routing |
| `apps/api/src/domain/order-state-machine.ts` | 24-state transition table, timeline projection |
| `apps/api/src/domain/quote-engine.ts` | Quote with viability gate, max-procurement price |
| `apps/web/app/page.tsx` | Paste-a-link flow |
| `apps/web/app/checkout/page.tsx` | Login → address → pay |
| `apps/web/app/checkout/return/page.tsx` | Post-gateway polling |
| `apps/web/app/track/page.tsx` | Order tracking with timeline |
| `apps/web/app/orders/page.tsx` | Order list |
| `apps/web/lib/api.ts` | API client with token refresh, sandbox routing, Money formatting |
| `apps/admin/app/page.tsx` | Exception queue dashboard |
| `apps/admin/app/order/page.tsx` | Order detail + procurement copilot |
| `apps/admin/app/finance/page.tsx` | Ledger + balances |
| `apps/worker/src/main.ts` | AMQP consumers, tracking poller, outbox relay |
| `apps/og/src/main.ts` | OG meta service |

### Packages
| Path | Description |
|---|---|
| `packages/core` | Money value object, Result, DomainEvent, error taxonomy |
| `packages/contracts` | Zod schemas + inferred types (single source of truth) |
| `packages/validation` | Bilingual (fa/en) Zod error map |
| `packages/observability` | pino logger, OTel, correlation-id propagation |
| `packages/cache` | Cache-aside with single-flight, TTL jitter |
| `packages/messaging` | RabbitMQ topology, transactional outbox, DLQ |
| `packages/resilience` | Circuit breaker, retry, timeout proxy decorators |
| `packages/db` | Drizzle schema, migrations, repositories, seed |
| `packages/storage` | MinIO adapter |
| `packages/sandbox` | Sandbox adapters, Redis session store, 12 scenarios |
| `packages/commerce` | Resolution pipeline with checkOffer |

### Scripts
| Path | Description |
|---|---|
| `scripts/smoke.sh` | 20 end-to-end smoke checks |
| `scripts/lifecycle.sh` | Full lifecycle: resolve → quote → OTP → address → order → pay → settle → procure → confirm → ship → deliver |

---

## 4. Changes Made

### Major bugs fixed (chronological)
1. **Failover proxy `then` bug** — Proxy synthesized callable for every property including `then`, making ports look like promises to NestJS DI. Fixed with `anyProviderImplements()` allowlist in `packages/resilience/src/failover.ts`.
2. **Money JSONB rehydration** — Money stored in JSONB lost methods on deserialization. Added `hydrateProduct()` at 7 deserialization sites in `apps/api/src/modules/commerce.module.ts`.
3. **HttpException 500 collapse** — Exception filter turned framework 404/413 into 500. Added `PassthroughHttpError` in `apps/api/src/common/http.ts`.
4. **Public routes requiring auth** — Product requests and quotes needed `@Public()` decorators.
5. **pino-pretty crash** — Missing dependency crashed boot. Added `prettyTransportAvailable()` fallback in `packages/observability/src/logger.ts` + installed pino-pretty.
6. **Port conflicts** — Redis remapped to 6380, web to 3010, admin to 3011.
7. **Sandbox sessions in-memory only** — Worker couldn't see API's sessions. Created `RedisSandboxSessionStore` in `packages/sandbox/src/redis-store.ts`.
8. **`store.checkOffer` missing** — ResolutionPipeline didn't implement `checkOffer`. Added to `packages/commerce/src/resolution.ts`.
9. **Empty JSON body 400** — Fastify rejects `content-type: application/json` with no body. Added custom content-type parser in `apps/api/src/main.ts`; also fixed client in `apps/web/lib/api.ts` to only set content-type when body exists.
10. **Sandbox breach timing** — Price multiplier applied too early. Changed to use `bump(ctx, 'offerChecks')` counter so first call returns original price, second applies multiplier.
11. **Unknown ASINs** — Added `syntheticProduct()` with ASIN-derived price/weight in `packages/sandbox/src/adapters.ts`.

### Architectural decisions (deliberate deviations from blueprint)
- **No SSR** — static export + OG meta service instead
- **RabbitMQ, not BullMQ** — real DLQ topology; Redis only for cache/FX
- **Back office is Next.js**, not React+Vite — one toolchain

---

## 5. Failed Attempts

1. **Lifecycle script log-grepping** — `scripts/lifecycle.sh` originally grepped the shared worker log (`/tmp/xb-worker.log`) for order state, which picked up results from previous runs. Changed to query the database for the specific order's state.
2. **Sandbox test assertion** — Unit test asserted `sandbox=1` in the gateway redirect URL, but the gateway redirect changed to `/v1/sandbox/gateway`. Updated the assertion.
3. **Verification script after empty-body fix** — A bash one-liner to verify the fix used `node -e` to parse an empty string, which threw. The fix itself was correct; only the verification script had a bug.
4. **Dev OTP log reading** — Logger redacted the `code` key. Changed the log key to `devOtp` so smoke tests can grep it.

---

## 6. Next Steps

### Immediate (to verify the current build works)
1. Start the API and worker: `cd platform && pnpm dev`
2. Run smoke tests: `bash scripts/smoke.sh`
3. Open http://localhost:3010, paste an Amazon UAE link, and walk through checkout → payment → tracking
4. Open http://localhost:3011, log in as `ops@example.ir` / `ops-dev-password`, verify exception queue

### Short-term
- **Browser-test the checkout flow end-to-end** — the empty-body fix was applied and typechecks clean, but wasn't verified in a browser before context expired
- **framer-motion** — installed in `apps/web` but not yet used for animations; add page transitions and micro-interactions
- **Admin order detail** — verify procurement copilot flow works with sandbox scenarios (PRICE_CHANGED_BREACH, PROCUREMENT_DELAY, etc.)

### Medium-term (gated on external providers)
- Integrate a real Iranian payment gateway (e.g., Zarinpal, Sadad) behind `PaymentPort`
- Integrate procurement method behind `ProcurementPort`
- Integrate logistics/carrier API behind `LogisticsPort`
- Production deployment (Docker images, CI/CD, domain, SSL)
- Compliance gate review before going live

### Operator credentials (dev seed)
| Email | Password | Role |
|---|---|---|
| `ops@example.ir` | `ops-dev-password` | ops |
| `finance@example.ir` | `finance-dev-password` | finance |
| `admin@example.ir` | `admin-dev-password` | admin |
