# Technical & Product Blueprint — v1.0

## Cross-Border Assisted Commerce Platform

**Covers:** Phase 1 (Product Definition) + Phase 4 (Technical Architecture) — front and back.
**Builds on:** v0.1 (feasibility), v0.2 (AI + business lines), v0.3 (logistics).
**Scope of this pass:** Consumer PWA + Admin ops console as primary surfaces; shared engine designed so the Merchant Panel drops in without rework.
**Date:** August 2026
**Reading note:** **DECISION** = locked choice · **GATE** = external dependency, build interface-first · **BUILD** = to implement · **RULE** = enforced business/product rule.

---

## 0. Build philosophy (the one idea that makes this safe to start now)

Three things are still gated externally (foreign payment/banking, procurement method per marketplace, logistics/carrier + customs). Everything else is ours to build. The architecture resolves this with **ports & adapters (hexagonal)**: the core domain talks to **interfaces**; each gated dependency is an **adapter** behind that interface, shipped first as a **stub/mock**, later swapped for the real provider with zero core rework.

> **DECISION:** Build the core + all internal surfaces now against stubbed adapters. The gates decide *which adapter goes live*, never *whether the system works*.

This lets front-end, internal back-end, and UX proceed at full speed today.

---

# PART 1 — PRODUCT DEFINITION

## 1.1 Personas & Jobs-to-be-Done

| Persona | Job-to-be-done | Success signal |
|---|---|---|
| **Consumer (Sara, 28, Tehran)** | "I found something abroad I can't buy from Iran — get it to me, in Toman, without me touching a foreign card, and let me see it's really coming." | Completes checkout in one session; checks tracking without contacting support |
| **Ops operator (internal)** | "Clear the orders that actually need me, fast, and never touch the healthy ones." | Low HSPO; works a ranked exception queue only |
| **Merchant (Instagram shop owner)** | "Let me resell cross-border fulfillment under my brand without running the ops." *(later phase)* | Tops up wallet, submits orders, relays branded tracking |
| **Finance/treasury (internal)** | "Every rial and dirham reconciles; I can see FX exposure and float need." | Reconciliation match rate high; no unmatched money |

## 1.2 MVP scope — locked

**IN (MVP):**
- **DECISION:** Link-first only. No catalog/search/merchandising. One paste-a-link flow.
- One source lane: **Amazon UAE → Iran** (adapter pattern ready for Turkey/DE/UK).
- **Assisted procurement** with AI copilot (operator confirms the pay step).
- Quote engine with live FX refresh + max-procurement-price tolerance.
- Iranian OTP auth (phone), IRR payment via one gateway (adapter for more).
- Unified multi-leg tracking with a normalized customer lifecycle.
- Admin ops-by-exception console.
- Ledger-first finance model + reconciliation (internal; real card adapter gated).
- Value-density category allowlist + minimum-order-value gate (from v0.3).
- Persian-first, RTL, mobile-first PWA.

**OUT (post-MVP):** merchant panel/white-label, enterprise desk, catalog/discovery, native apps, crowdship/traveler network, agentic-native procurement, ACP/UCP distribution, pickup-point network, instant-SKU. All have a designed seam but are not built in MVP.

## 1.3 Core user flow — consumer (happy path)

```
Landing → Paste product URL → [Resolve] product card (title, image, price, variant)
   → Select variant/qty → [Request quote] → Quote screen (transparent breakdown, TTL countdown)
   → Confirm → OTP/login → [Fresh revalidation: offer+availability+FX] → Pay (IRR gateway)
   → PAYMENT_CONFIRMED → order tracking page (live lifecycle) → ... → DELIVERED
```

**RULE (revalidate at checkout):** immediately before the payment gateway, refresh product offer, availability, and FX; lock the final quote for its TTL. A successful payment means `PAYMENT_CONFIRMED`, **not** `PURCHASED`.

## 1.4 Order state machine

```
DRAFT → QUOTING → QUOTED → AWAITING_PAYMENT → PAID
 → PROCUREMENT_PENDING → PURCHASED → SELLER_PROCESSING
 → LOCAL_TRANSIT → WAREHOUSE_RECEIVED → INTERNATIONAL_TRANSIT
 → CUSTOMS → DOMESTIC_TRANSIT → DELIVERED
```

**Exception states (branch from any node):**
`PRICE_CHANGED · OUT_OF_STOCK · PAYMENT_FAILED · PROCUREMENT_FAILED · CUSTOMER_ACTION_REQUIRED · SHIPMENT_EXCEPTION · CUSTOMS_EXCEPTION · REFUND_PENDING · REFUNDED · CANCELLED`

**RULE:** every transition is an **event** appended to an immutable order timeline (source of truth for tracking, audit, and support).

## 1.5 Exception matrix (ops policy)

| Exception | Trigger | Auto-action | Operator action |
|---|---|---|---|
| PRICE_CHANGED | actual > max-procurement-price | Pause procurement; recompute | Approve reprice or refund |
| OUT_OF_STOCK | resolver/procurement finds unavailable | Hold order | Offer alternative or refund |
| PAYMENT_FAILED | gateway decline | Retry/notify | None unless repeated |
| PROCUREMENT_FAILED | purchase step fails | Retry queue | Manual purchase or refund |
| SHIPMENT_EXCEPTION | tracking stalled > SLA | Flag + notify | Contact carrier |
| CUSTOMS_EXCEPTION | held at customs | Flag | Provide docs / decide |
| CUSTOMER_ACTION_REQUIRED | address/ID missing | Request from customer | Follow up |

**RULE (manage-by-exception):** the admin console default view is the **AI-ranked exception queue** (margin-at-risk × urgency), never a list of healthy orders.

## 1.6 Customer-facing unified tracking

Normalize all carrier/warehouse/marketplace statuses into one lifecycle the customer understands:

```
✓ Order confirmed  ✓ Purchased  ✓ Dispatched by seller  ✓ At foreign warehouse
● International transit  ○ Arrived in Iran  ○ Out for delivery  ○ Delivered
```

## 1.7 Metrics instrumented from day one

Activation: resolution success, quote acceptance. Commerce: checkout conversion, AOV, **Contribution Margin/order**. Ops: **STP, HSPO**, procurement latency, exception rate, on-time delivery. Finance: payment success, **reconciliation match rate**, FX slippage, working-capital days. (Full list in v0.2 §70.)

---

# PART 2 — TECHNICAL ARCHITECTURE

## 2.1 System context

```
        ┌───────── CLIENTS ─────────┐
        │ Consumer PWA   Admin SPA  │   (Merchant PWA — later)
        └──────────┬─────────┬──────┘
                   │  HTTPS/REST + WebSocket (tracking)
             ┌─────▼─────────▼─────┐
             │     API Gateway     │  auth (OTP/JWT), rate-limit, routing
             └─────────┬───────────┘
                       │
        ┌──────────────▼───────────────────────────────┐
        │        MODULAR MONOLITH (core domain)         │
        │  Identity · ProductRequest · Resolver ·       │
        │  Pricing/Quote · FX · Order · Payment ·        │
        │  Procurement · Treasury · Ledger · Recon ·     │
        │  Shipment/Tracking · Refund · Notification ·   │
        │  Support · Ops · Audit                         │
        │        (in-process event bus between modules)  │
        └───┬───────────┬───────────┬───────────┬────────┘
            │           │           │           │  PORTS (interfaces)
        ┌───▼───┐   ┌───▼───┐   ┌───▼───┐   ┌───▼────┐
        │ Store │   │  FX   │   │Payment│   │Carrier │   ADAPTERS
        │adapter│   │adapter│   │adapter│   │adapter │   (stub → real)
        └───────┘   └───────┘   └───────┘   └────────┘
   Async workers: procurement tasks · FX refresh (3-min) · tracking poll · recon
   Stores: PostgreSQL (orders, ledger)  ·  Redis (cache/FX snapshot/queues)  ·  Object store (package photos)
```

**DECISION (modular monolith, not microservices):** one deployable with strict internal module boundaries and an in-process event bus. It gives DDD separation without distributed-systems overhead at MVP scale; any module can be extracted into a service later because it already communicates via events + interfaces.

## 2.2 Stack — DECISIONS

| Layer | Choice | Why |
|---|---|---|
| Consumer + Merchant client | **Next.js (React) + TypeScript, Tailwind, PWA** | Mobile-first, installable, fast, SSR for share/SEO from Instagram/Telegram, first-class RTL |
| Admin console | **React (Vite) SPA + TypeScript** | Data-dense internal tool; no SEO need |
| Backend | **NestJS (TypeScript) modular monolith** | Shared TS types with front end; DI + module system fits DDD boundaries; strong ecosystem |
| Data | **PostgreSQL** (primary, incl. ledger) · **Redis** (cache, FX snapshot, queues) | ACID for money; Redis for hot FX + job queues |
| Async | **BullMQ (Redis)** workers | Procurement tasks, FX refresh, tracking polls, recon |
| Events | **In-process bus (MVP)** → NATS/Kafka later | Start simple; interface stable for later extraction |
| Realtime | **WebSocket / SSE** | Live tracking + ops queue updates |
| Auth | **OTP (phone) + JWT**, refresh tokens | Iran-appropriate; no foreign identity dependency |
| Files | **S3-compatible object store** | Warehouse package photos, docs |
| AI | **Vision-LLM resolver adapter · landed-cost model · exception ranker · Persian support copilot** | Behind the same port pattern; swappable models |
| Infra | **Docker + IaC**, single-region, staged | Keep ops simple; data residency per compliance gate |

**RULE (money is TypeScript-typed & DB-constrained, never AI):** all monetary values are a `Money { amount, currency }` value object; the ledger is double-entry and deterministic. AI never writes financial records.

## 2.3 Bounded contexts → modules (and their public events)

| Module | Owns | Emits (examples) |
|---|---|---|
| Identity | customers, OTP, sessions | `CustomerRegistered` |
| ProductRequest | inbound URL requests | `ProductRequested` |
| Resolver (Store port) | normalize external product | `ProductResolved`, `ResolutionFailed` |
| Pricing/Quote | landed cost, quote lifecycle | `QuoteCreated`, `QuoteExpired` |
| FX | rate snapshots, pricing FX | `FxUpdated` |
| Order | order aggregate + state machine | `OrderPaid`, `OrderStateChanged` |
| Payment (port) | IRR customer payments | `PaymentConfirmed`, `PaymentFailed` |
| Procurement (port) | procurement orders, tasks | `ProcurementPurchased`, `ProcurementFailed` |
| Treasury | foreign float, payment instruments | `FloatLow` |
| Ledger | double-entry entries | `LedgerPosted` |
| Reconciliation | match money ↔ orders | `Unmatched`, `Reconciled` |
| Shipment/Tracking (Carrier port) | legs, tracking events | `LegUpdated`, `ShipmentException` |
| Refund | refund policy + execution | `RefundIssued` |
| Notification | Persian push/SMS/in-app | — |
| Support | cases, order context | — |
| Ops | exception queue, ranking | — |
| Audit | immutable event log | — |

## 2.4 Data model — core aggregates

```
Customer(id, phone, name, addresses[])
ProductRequest(id, customerId, sourceUrl, marketplace, externalProductId, variant, qty)
QuoteProductSnapshot(externalProductId, title, variant, seller, price, currency, availability, observedAt)
Quote(id, customerId, snapshot, productPrice, currency, fxRate, shippingEst, customsEst,
      serviceFee, riskReserve, finalPrice(Money), createdAt, expiresAt, status)
Order(id, customerId, quoteId, state, timeline[Event], maxProcurementPrice(Money))
CustomerPayment(id, orderId, amount(Money-IRR), gatewayRef, status)
ProcurementOrder(id, orderId, marketplace, items[], externalOrderId, status)   // 1 order → N procurement orders
Shipment(id, orderId, legs[ Leg(carrier, tracking, origin, dest, status, weight, cost, events[]) ])
Refund(id, orderId, amount(Money), reason, fxPolicy, status)
LedgerEntry(id, account, debit, credit, currency, refType, refId, postedAt)   // double-entry
Money(amount, currency)   // value object — mandatory everywhere
```

**RULE:** `Order` and `ProcurementOrder` are distinct aggregates (one customer order may split across marketplaces). Every external marketplace order links back to its `ProcurementOrder` for audit, refunds, and reconciliation.

## 2.5 Ports & adapters (the gated seams)

| Port (interface) | MVP adapter (ship now) | Real adapter (gated) |
|---|---|---|
| `StoreAdapter.resolve(url)` | AmazonAE (API + **vision-LLM fallback**) | Turkey/DE/UK/Trendyol/Noon |
| `FxProvider.getRate(pair)` | 1 Iranian provider + manual fallback | multi-provider normalization |
| `PaymentGateway.charge(IRR)` | 1 IRR gateway sandbox | production gateway(s) |
| `ProcurementExecutor.purchase(po)` | **Assisted** (operator copilot) | agentic-supervised → API/ACP-UCP |
| `CarrierAdapter.track(leg)` | forwarder stub + manual updates | real forwarder + Iran last-mile (AloPeyk/Snapp) |
| `CustomsEstimator.estimate(item)` | category-prior model | validated duty engine (GATE) |

**GATE:** Payment, real Procurement, Carrier, and Customs adapters go live only after their feasibility gate clears. The core and both surfaces are fully functional on the MVP adapters before then.

## 2.6 Key API surface (REST, versioned `/v1`)

```
POST /v1/product-requests            {url} → {requestId}
GET  /v1/product-requests/:id        → resolved product card | resolution status
POST /v1/quotes                      {requestId, variant, qty} → Quote (with TTL)
POST /v1/quotes/:id/refresh          → revalidated Quote (offer+availability+FX)
POST /v1/orders                      {quoteId} → Order (AWAITING_PAYMENT)
POST /v1/orders/:id/pay              → gateway redirect / status
GET  /v1/orders/:id                  → order + unified timeline
GET  /v1/orders/:id/tracking (WS)    → live lifecycle events
--- admin ---
GET  /v1/admin/exceptions            → AI-ranked queue
POST /v1/admin/procurements/:id/confirm  → operator confirms purchase
POST /v1/admin/orders/:id/transition     → guarded state change
GET  /v1/admin/finance/unmatched     → reconciliation breaks
```

## 2.7 Async workflows

- **FX refresh worker** — every ~3 min updates the Redis FX snapshot; checkout uses on-demand fresh fetch.
- **Procurement worker** — on `OrderPaid`, creates `ProcurementOrder`(s), revalidates, prepares copilot context, enqueues operator task; on confirm → `PURCHASED`.
- **Tracking worker** — polls carrier adapters / ingests webhooks; normalizes into unified lifecycle; raises `ShipmentException` on stalls.
- **Reconciliation worker** — matches payments/refunds/procurement to orders (deterministic rules + LLM-proposed fuzzy matches, human-confirmed).

## 2.8 Front-end architecture

- **Consumer PWA:** Next.js app router; installable; offline-tolerant tracking page; push notifications where supported; RTL/Persian via i18n; deep-link friendly (arrive from Instagram/Telegram → paste link in seconds). Talks only to `/v1` REST + WS.
- **Admin SPA:** exception-first dashboard, procurement copilot screen (expected vs current price, max authorized, one-click confirm), order timeline, finance/recon views. Role-based.
- **Shared:** a generated TypeScript API client + shared domain types from the backend (single source of truth), so front and back never drift.

## 2.9 Security, compliance & audit (design-level)

- OTP auth, JWT with refresh; RBAC for admin.
- **Every state transition and money movement is an immutable audit event.**
- PII minimization; secrets in a vault; least-privilege service creds.
- **RULE:** no architecture path depends on concealment, account sharing, or bypassing marketplace/AML controls (v0.1 §65). Compliance gate remains the master switch before production.

## 2.10 Environments & delivery

Local (docker-compose: Postgres/Redis/stubs) → Staging (all stub adapters) → Pilot (real adapters per cleared gate, controlled volume). CI runs unit + contract tests against adapter interfaces so a real adapter can replace a stub only when it passes the same contract.

---

# PART 3 — WHAT TO BUILD FIRST (execution order)

| Sprint theme | Deliverable | Depends on |
|---|---|---|
| **S1 Skeleton** | Monolith scaffold, module boundaries, event bus, Money type, Postgres/Redis, OTP auth, API gateway | — |
| **S2 Resolve→Quote** | ProductRequest + Store stub/vision resolver + FX snapshot + Quote engine + consumer paste→quote screens | S1 |
| **S3 Order→Pay** | Order aggregate + state machine + payment stub + checkout revalidation + ledger entries | S2 |
| **S4 Procure→Track** | Procurement copilot + admin exception queue + carrier stub + unified tracking + consumer tracking page | S3 |
| **S5 Finance** | Double-entry ledger + reconciliation worker + finance admin views | S3 |
| **S6 Harden** | Contract tests, metrics dashboards, notifications (Persian), pilot readiness | S1–S5 |
| **Gate swaps** | Replace payment/procurement/carrier/customs stubs with real adapters as gates clear | respective gates |
| **Then** | Merchant panel (reuses engine; adds wallet + per-leg configurator from v0.3 §5) | post-MVP |

**The clickable prototype (`prototype.html`) demonstrates the S2–S4 surfaces** — consumer resolve→quote→pay→track and the admin exception/procurement console — so UX can be validated before implementation.

---

## Appendix — how this maps to prior phases
- v0.1 domain model (§66–67) → Part 2.3 modules & 2.4 aggregates.
- v0.2 AI substrate → resolver/exception-ranker/support adapters (2.5) and copilot (2.8).
- v0.3 logistics → CarrierAdapter + CustomsEstimator ports (2.5) and min-order gate (1.2).
- Compliance gate (v0.1 §65) → 2.9 and the gated adapters (2.5).
