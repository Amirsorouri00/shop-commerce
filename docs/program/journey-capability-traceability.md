# Journey → Capability Traceability

> Phase 11 of `docs/program/MASTER-PROMPT.md`. **Canonical cross-phase map.** No implementation.
>
> **Evidence rule:** every claim about existing behaviour carries a `file:line` citation from source opened in this phase. Design documents are never cited as evidence that implementation exists.
>
> **Enumeration rule (Phase 11 §2):** where a claim concerns a closed set, the complete set is enumerated. **This rule was itself violated in §5 of the first draft** — the event enumeration counted constants rather than emissions and produced three errors; corrected below, and recorded because the rule is worthless if its failures are hidden. Sets enumerated here: all 24 order states and all 51 edges; **6** state-keyed presentation maps (an earlier draft said 4, omitting `CARRIER_STATUS_MAP` and `STEP_LABELS`); all 3 settlement entry points; all 11 `@Public()` decorators; all 24 event constants; all 8 `AdapterSet` members; all sandbox-exclusion sites; all tables contributing to balances.
>
> Companions: `gap-register.md` (severity/classification), `dependency-graph.md` (ordering), `test-coverage-map.md`, `verified-defect-register.md` (Phase 10 root causes).

## Status vocabulary

`IMPLEMENTED` · `IMPLEMENTED-BUT-DEFECTIVE` · `PARTIAL` · `ORPHANED` (code exists, unreachable) · `DESIGN-TARGET` (designed, not built) · `EXTERNAL-GATE` · `MISSING` · `BLOCKED`

**No "supported" or "mostly done" appears in this document.**

---

## 1. The two facts that govern every row

**1. The Phase 7 permission model is `DESIGN-TARGET` in its entirety.** Enforcement today is role-string equality (`apps/api/src/common/http.ts:251-256`) against an enum of exactly three values — `ops | finance | admin` (`packages/contracts/src/schemas.ts:90`). Every permission named in Phases 7–10 (`resolution:complete`, `ledger:read`, `refund:issue`, `sandbox:use`, …) exists in **no** code. Rows below therefore carry **two** authorization columns: CURRENT (role string) and TARGET (permission).

**2. Executable sandbox parity does not exist.** **CORRECTED.** `apps/admin` does contain sandbox references — `app/orders/page.tsx:71-125,298-306` is a full "Demo orders" filter (`exclude|only|include`). The real defect is narrower and unchanged in effect: **`apps/admin/lib/api.ts` never sends `X-Sandbox-Session`** (0 references), so the admin can *filter* sandbox rows it cannot *create or enter*. No operator journey can run inside a sandbox session. Architecture exists; execution does not.

---

## 2. Customer journeys — Line A

Format: step → screen → API → use case → domain → transition → authz → persistence → event → port → sandbox → test → status.

| # | Step | Screen | API | Use case | Domain effect | Authz (CURRENT / TARGET) | Event | Port | Sandbox | Test | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| C1 | Paste URL | `/` | `POST /v1/product-requests` `commerce.module.ts:453` | resolve | `productRequest.status` | `@Public` / — | `product.requested` **dead** | `StorePort` | `RES-01` | `commerce.test.ts` | **IMPLEMENTED** |
| C2 | Marketplace ID | `/` | (same) | `marketplaceRegistry.parse` | — | `@Public` / — | — | — | — | yes | **IMPLEMENTED** |
| C3 | Resolution ladder | `/` | (same) | `ResolutionPipeline.resolve` | `RESOLVED\|NEEDS_REVIEW\|FAILED` | `@Public` / — | `product.resolved` **dead** | `StorePort` | `RES-01/02` | yes | **IMPLEMENTED-BUT-DEFECTIVE** — in production `buildStoreStrategies` registers **nothing** (`adapters.ts:288-295` refuses the stub); api/structured/vision are commented out |
| C4 | Variant confirm | `/` | — | — | — | — / — | — | — | — | no | **MISSING** — no `selectableVariations` field |
| C5 | **NEEDS_REVIEW** | `/` — Persian "some info is uncertain" banner (`apps/web/app/page.tsx:138`) | — | — | `productRequest.status` only; **no order state** | — | — | `ManualResolutionStrategy` **never registered** | `RES-03` stops here | no | **PARTIAL — CORRECTED.** A customer-facing surface *does* exist; what is missing is the operator queue, the review command, and any exit. Full vertical trace §6 |
| C6 | Quote | `/` | `POST /v1/quotes` `:470` | quote engine | `QUOTING→QUOTED` | `@Public` / — | `quote.created` **producer, no consumer** | `FxPort`,`CustomsPort` | `QUO-01` | partial | **IMPLEMENTED** |
| C7 | Quote expiry | `/` | `POST /v1/quotes/:id/refresh` `:481` | refresh | — | `@Public` / — | `quote.expired` **no consumer** | — | `QUO-04` **unrunnable** (real `Date.now()`) | no | **PARTIAL** |
| C8 | Auth (OTP) | `/checkout` | `auth.module.ts:382-403` | OTP | session | `@Public` / — | `customer.registered` **dead** | `SmsPort` | — | `auth.otp.test.ts` 12 tests | **IMPLEMENTED** |
| C9 | Address | `/checkout` | `POST /v1/addresses` | create | — | bearer / `address:write` | — | — | — | no | **PARTIAL** — no update/delete |
| C10 | Checkout | `/checkout` | `POST /v1/orders` `:491` | create order | `DRAFT→QUOTING…` | bearer / `order:write` | `order.created` | — | — | no | **IMPLEMENTED-BUT-DEFECTIVE** — copies client `x-sandbox-session` unvalidated (`:493-499`) |
| C11 | Payment start | `/checkout` | `POST /v1/orders/:id/payments` `:530` | `startPayment` | `→AWAITING_PAYMENT` | bearer + `Idempotency-Key` / `payment:initiate` | `payment.initiated` **dead** | `PaymentPort` | `PAY-01` | no | **IMPLEMENTED** |
| C12 | **Payment callback** | — | **3 routes — see §3** | `settlePayment` `:339` | `→PAID→PROCUREMENT_PENDING` (same txn) | **see §3** | `order.paid` | `PaymentPort` | `PAY-01` | **none** | **IMPLEMENTED-BUT-DEFECTIVE** |
| C13 | Payment decline | `/checkout/return` | — | — | `PAYMENT_FAILED` | — | `payment.failed` **no producer** | — | `PAY-02` | no | **MISSING** — **nothing transitions to `PAYMENT_FAILED`** |
| C14 | Payment retry | `/checkout` | reuse C11 | — | `PAYMENT_FAILED→AWAITING_PAYMENT` | bearer / — | — | — | — | no | **BLOCKED** by C13 |
| C15 | Async settlement | `/checkout/return` | poll `orders.get` | — | — | bearer / — | — | — | `PAY-04` | no | **PARTIAL** |
| C16 | Order confirmation | `/orders` | `GET /v1/orders` | list | — | bearer, owner-scoped / `order:read`@SELF | — | — | — | no | **IMPLEMENTED** |
| C17 | Procurement | — | worker `main.ts:121` | purchase | `→PURCHASED` | system / `system` principal | `procurement.purchased` | `ProcurementPort` | `PRO-01` | `commerce.test.ts` guard | **IMPLEMENTED** |
| C18 | **Price-change decision** | `/orders/:id` **absent** | **none** | — | `PRICE_CHANGED→…` legal | — / `order:decide` | — | — | `PRO-02` | no | **MISSING** — backend edges exist, no customer API |
| C19 | Out-of-stock | `/track` banner | — | — | `OUT_OF_STOCK` | — | — | — | `PRO-03` | no | **IMPLEMENTED-BUT-DEFECTIVE** — state overloaded pre/post-payment |
| C20 | Customer-action-required | `/track` banner | **none for the customer**; operator can set/clear via generic transition | — | `CUSTOMER_ACTION_REQUIRED` | — / `order:decide` | — | — | `FUL-05` | no | **MISSING (customer)** — operator path exists via `transition` |
| C21 | Customs exception | `/track` banner | **none** | — | `CUSTOMS_EXCEPTION` | — | — | `CustomsPort` | `FUL-02` | no | **MISSING** (customer action) |
| C22 | Tracking | `/track?id=` | `GET /v1/orders/:id` | get | timeline projection | bearer, owner-scoped / — | `shipment.leg_updated` | `CarrierPort` | `FUL-01` | no | **IMPLEMENTED-BUT-DEFECTIVE** — see §4 |
| C23 | Delivery | `/track` | — | — | `→DELIVERED` terminal | — | — | `CarrierPort` | `FUL-01` | no | **IMPLEMENTED** |
| C24 | Support | — | **none** | — | — | — / `support:*` | — | — | `SUP-01` fails | no | **MISSING** — no table, route, or service |
| C25 | Refund | — (customer) | **operator-only** via generic `transition` to `REFUND_PENDING`; no `REFUNDED` producer | — | `REFUND_PENDING→REFUNDED` **never performed** | — / `refund:request` | — | `PaymentPort.refund` **no callers** | `REF-01` | no | **MISSING** — lifecycle is table-only |
| C26 | Cancellation | — (customer) / operator `/order/` | **operator-only**: `POST /v1/admin/orders/:id/transition` | — | 7 inbound edges to `CANCELLED` | `ops\|admin` / `order:transition` | `order.cancelled` **dead** | — | none | no | **PARTIAL — CORRECTED.** An earlier draft said "no cancel command." An operator *can* cancel via the generic transition endpoint, offered as a one-click target in the admin UI (`apps/admin/app/order/page.tsx:314`). What is missing is a **customer** command and a *specific* cancel command rather than a raw target-state transition |
| C27 | Notifications | — | — | — | — | — | `notification.requested` **dead constant** | `NotificationPort` **no adapter** | none | no | **MISSING** — §7 |
| C28 | Terminal states | `/track` | — | — | `DELIVERED`,`REFUNDED`,`CANCELLED` | — | — | — | — | no | **PARTIAL** — 2 of 3 have no customer copy |

### The eight questions, applied

Per Phase 11 §4, no step is complete because a domain transition exists. Steps failing question 1 (customer can reach it): **C5, C18, C20, C21, C24, C25, C26.** Failing question 3 (system can leave it): **C5** (no exit from review), **C19** pre-payment. Failing question 8 (automated test): **all but C1–C3, C8, C17.**

---

## 3. Payment settlement — complete enumeration

**Exactly three call sites** invoke `OrderService.settlePayment` (`commerce.module.ts:339`). Enumerated, not sampled:

| Route | Auth | Provider verification | Idempotency | Amount check | Prod-gated | Status |
|---|---|---|---|---|---|---|
| `POST /v1/webhooks/payments/:provider` `commerce.module.ts:549` | **none — `@Public()` absent** despite docstring claiming it (`:536-540`) | `verifyWebhook` → 401 | `settleOnce` `:345` | **none** | n/a | **IMPLEMENTED-BUT-DEFECTIVE — unreachable.** Default-deny requires a bearer token no gateway can supply |
| `POST /v1/sandbox/gateway/settle` `sandbox.module.ts:188` | **none** — class `@Public()` `:111` | **skipped by design** | `settleOnce` | none | **NO** | **IMPLEMENTED-BUT-DEFECTIVE** — the only settlement path that works in production, and it is unauthenticated |
| `POST /v1/dev/gateway/settle` `dev-gateway.module.ts:74` | **none** — class `@Public()` `:27` | skipped | `settleOnce` | none | **YES** — 404 outside dev (`:42-44`) | **IMPLEMENTED** — correct pattern; provider name hard-coded *because* unauthenticated |

**Shared effects** (all three, `commerce.module.ts:340-382`): `settleOnce` idempotency → `assertTransition` → `PAID` → ledger post (cash debit / prepayment credit) → `PROCUREMENT_PENDING` in the **same transaction** → outbox.

**Consequences of the enumeration:**
- **`PAID` is never observable** — both transitions commit together, so no query ever sees it. It is a ledger checkpoint, not a status.
- **No route verifies the settled amount** against the order total.
- `StubPaymentAdapter.verifyWebhook()` returns `true` unconditionally, so verification is a no-op under the stub regardless.

---

## 4. State machine — complete enumeration

**24 states, 51 edges**, re-enumerated from source (not from earlier summaries).

**Terminal (3):** `DELIVERED`, `REFUNDED`, `CANCELLED`. **No inbound (1):** `DRAFT` — correct, it is the entry.

**Inbound to `REFUND_PENDING` (6):** `PRICE_CHANGED`, `OUT_OF_STOCK`, `PROCUREMENT_FAILED`, `CUSTOMER_ACTION_REQUIRED`, `SHIPMENT_EXCEPTION`, `CUSTOMS_EXCEPTION`.
→ **Two are reachable pre-payment:** `QUOTING→OUT_OF_STOCK→REFUND_PENDING` and `QUOTED→PRICE_CHANGED→REFUND_PENDING`.

**Inbound to `CANCELLED` (7):** `DRAFT`, `QUOTED`, `AWAITING_PAYMENT`, `PRICE_CHANGED`, `OUT_OF_STOCK`, `PAYMENT_FAILED`, `CUSTOMER_ACTION_REQUIRED`.
→ **Three terminate a *paid* order with no refund and no money movement:** `PRICE_CHANGED`, `OUT_OF_STOCK`, `CUSTOMER_ACTION_REQUIRED`. Enumerated exactly; previously known only as "some."

### State-keyed presentation maps — all four enumerated

| Map | Coverage | Missing |
|---|---|---|
| `EXCEPTION_STATES` `:51` | 7/24 | by design |
| `TERMINAL_STATES` `:61` | 3/24 | by design |
| **`STATE_TO_STEP_INDEX` `:148`** | **12/24** | `REFUND_PENDING`, `REFUNDED`, `CANCELLED`, `PRICE_CHANGED`, `OUT_OF_STOCK`, `PROCUREMENT_FAILED`, `PAYMENT_FAILED`, `SHIPMENT_EXCEPTION`, `CUSTOMER_ACTION_REQUIRED`, `QUOTING`, `QUOTED`, `DRAFT` |
| `ALERTS` `:213` | 8/24 | incl. `REFUNDED`, `CANCELLED` |
| `STATE_BADGES` (web) `order-display.ts` | 21/24 | `DRAFT`, `QUOTING`, `QUOTED` → raw enum leaks |

**New defect found by enumeration (G-19).** `buildCustomerTimeline` uses `STATE_TO_STEP_INDEX[state] ?? -1` (`:170`). For any of the 12 unmapped states the index is `-1`, so **every one of the 8 timeline steps renders `PENDING`**. A customer whose order is in `REFUND_PENDING` — or `PRICE_CHANGED`, or `SHIPMENT_EXCEPTION` — sees a timeline in which *nothing has happened*, including the confirmed, purchased, and shipped steps that demonstrably did. This was not found by any earlier phase because each inspected the map's contents rather than enumerating against all 24 states.

**Two qualifications, added after review.** (a) `AWAITING_PAYMENT: -1` (`:149`) is an *explicit* mapping to `-1`, showing the sentinel is intentional for pre-payment — so `-1` is not per se a bug, and the defect is specifically the 12 **unmapped** states falling into it. (b) `firstTimestampForStep` (`:189-197`) still returns real `occurredAt` values, so the customer sees **timestamped steps labelled PENDING** — internally contradictory, and arguably more confusing than a blank timeline. Severity is **P2, not P1**: it misleads without preventing journey completion. Owning context is **domain** (`apps/api/src/domain/`), not presentation.

---

## 5. Event backbone — all 24 constants enumerated

**CORRECTED after review — the earlier table was wrong three ways.** `EVENT_TYPES` (`packages/core/src/events.ts:28-62`) is **referenced nowhere functionally** — every emission uses a raw string literal, so the constant table is decorative and a typo'd topic cannot be caught by the type system. That is the structural fact, and it invalidates the earlier framing.

**Actual emission sites: 7, across 6 distinct topics** — `commerce.module.ts:283,385`, `admin.module.ts:220,258,295`, `worker/main.ts:179,344`.

Consequences: **18 of 24 constants are dead**, not 12. `quote.created`, `quote.expired`, and `shipment.exception` have **zero references anywhere** — they were wrongly listed as "producer, no consumer"; only `order.state_changed` belongs in that category. The earlier table also listed five members under a count of four.

| Category | Count | Events |
|---|---|---|
| **Dead constant** (no reference anywhere) | **18** | `customer.registered`, `exception.resolved`, `fx.updated`, `notification.requested`, `order.cancelled`, `payment.initiated`, `procurement.failed`, `procurement.required`, `product.requested`, `product.resolution_failed`, `product.resolved`, `reconciliation.unmatched` |
| Producer, no consumer | **1** | `order.state_changed` |
| Topology binding, no producer | 3 | `ledger.posted`, `payment.failed`, `payment.settled` |
| Producer + consumer | **5** | `order.created`, `order.paid`, `procurement.purchased`, `exception.raised`, `shipment.leg_updated` |

**Nuance the enumeration resolves:** `notification.requested` is a dead *constant*, yet the notification queue is **live** — `topology.ts:44` binds it to `order.*`/`payment.*`/`exception.*`, so the consumer receives real events and discards them (`worker/main.ts:224-231`). Both the Phase 3/9 claim ("no consumer") and a naive reading of the dead constant are wrong.

**Delivery semantics — `IMPLEMENTED-BUT-DEFECTIVE`, affecting every consumer.** `once()` calls `markProcessed` **before** the handler (`worker/main.ts:95-99`), committing independently (`repositories.ts:798-806`). A throwing handler permanently suppresses redelivery → **at-most-once**, while `:35` documents at-least-once. **Event delivery must not be described as reliable until this is fixed and tested.** Affected consumers: all four (`order.paid`, `procurement.purchased`, notification, reconciliation).

---

## 6. Manual resolution — the one complete vertical trace

Constructed so Phase 12 cannot implement only one layer.

| Link | Required | Exists? | Evidence |
|---|---|---|---|
| Order state for review | `RESOLUTION_REVIEW` | **MISSING** | `QUOTING: ['QUOTED','OUT_OF_STOCK']` only (`:17`) |
| ProductRequest status | `NEEDS_REVIEW` | **IMPLEMENTED** | `schemas.ts:154`, set at `resolution.ts:209` |
| Operator queue query | list needs-review | **MISSING** | `NEEDS_REVIEW` absent from `apps/api/src` |
| Review workspace | `/resolutions/:id` | **MISSING** | not in `apps/admin` (4 pages) |
| Submit command | `SubmitResolutionReview` | **DESIGN-TARGET** | Phase 10 §1 |
| API route | `POST …/actions/submit-review` | **MISSING** | — |
| Authorization | `resolution:complete` | **DESIGN-TARGET** | permission model absent |
| Override producer | supplies `manualOverrides` | **MISSING** | 2 refs: declaration + consumer |
| Manual strategy | registered in pipeline | **ORPHANED** | absent from `buildStoreStrategies` switch (`:280-305`) |
| Persisted review | `ResolutionReview` | **DESIGN-TARGET** | — |
| Continuation | resume → quote or reject | **MISSING** | no terminal for reject |
| Customer notification | — | **MISSING** | §5 |
| Audit | — | **DESIGN-TARGET** | — |

**13 links; 1 implemented, 1 orphaned, 3 design-target, 8 missing.** No single-layer implementation can satisfy this row group.

---

## 7. Notification — traced from source

| Element | Status | Evidence |
|---|---|---|
| Queue + topology binding | **IMPLEMENTED** | `topology.ts:43-44` |
| Consumer + dedupe | **IMPLEMENTED-BUT-DEFECTIVE** | `worker/main.ts:224-231`; logs only; at-most-once (§5) |
| Event constant | **ORPHANED** | `events.ts:61`, sole reference |
| Emitter | **MISSING** | nothing publishes |
| `NotificationPort` adapter | **MISSING** | no implementation |
| Delivery persistence / status / retry | **MISSING** | — |
| Preferences | **MISSING** | — |
| Sandbox inbox | **DESIGN-TARGET** | Phase 9 |

**The prior claim "no consumer exists" is false and must not be repeated.** The consumer exists and receives real traffic.

---

## 8. Adapter parity — all 8 `AdapterSet` members

| Port | Routed? | External? | Sandbox requirement | Status |
|---|---|---|---|---|
| `store` | yes | yes | required | **IMPLEMENTED** |
| `fx` | yes | yes | required | **IMPLEMENTED** |
| `payment` | yes | yes | required | **IMPLEMENTED-BUT-DEFECTIVE** — `verifyWebhook` synchronous, always production |
| `procurement` | yes | yes | required | **IMPLEMENTED** |
| `carrier` | yes | yes | required | **IMPLEMENTED** |
| **`customs`** | **no** | **no** | **none — correctly shared** | **IMPLEMENTED.** `CategoryPriorCustomsAdapter.estimate()` (`adapters.ts:189-198`) is pure computation over a static prior table, no outbound call. Sharing is correct; mocking would reduce fidelity |
| **`sms`** | **no** | **yes** | **required — GAP** | **MISSING** — a sandbox session can send a real SMS |
| **`storage`** | **no** | **yes** | required — GAP | **MISSING** |

**Runtime divergence invisible to composition:** `SYNCHRONOUS_MEMBERS` (`sandbox-routing.ts:26`) and every non-function member (`:44`) resolve to production; an unknown/expired/corrupt session falls through to production (`:52-58`). **Binding-time parity assertions cannot detect any of these.**

---

## 9. Sandbox context — traced request → persistence → worker → adapter

| Hop | Mechanism | Status |
|---|---|---|
| Client → API | `X-Sandbox-Session` header | **PARTIAL** — WP-01 made the header inert where sandbox is not permitted, at **both** read sites (`CorrelationMiddleware` and `createOrder`'s direct `@Headers`), and gated the worker's two re-entry points. **Where sandbox IS permitted the value is still trusted verbatim — that is WP-03** |
| Server validation | — | **MISSING** |
| Order persistence | `orders.sandboxSessionId` `schema.ts:238` | **IMPLEMENTED** — **1 of 21 tables** |
| Payment / ledger / exception / reconciliation persistence | — | **MISSING** |
| Event envelope | — | **MISSING** — not carried |
| Worker context | order-row lookup on `payload.orderId` `worker/main.ts:100-108` | **PARTIAL** — events without `orderId` never enter sandbox context |
| Adapter selection | `routeByContext` proxy | **IMPLEMENTED** |
| Query exclusion | **exactly one site**: `repositories.ts:249-250` (`OrderRepository.search`) | **PARTIAL** |
| Admin propagation | — | **MISSING** — zero references |
| Balance calculation | `LedgerRepository.balance` `:600-610` queries `ledgerEntries` only, **no filter** | **MISSING** |

**The concealment channel is live**, not prospective: exclusion already defaults to `exclude` (`schemas.ts:323`) while the client sets the tag.

---

## 10. Money — canonical unit trace

| Stage | Unit | Owner | Status |
|---|---|---|---|
| Marketplace price | AED | `Money` | IMPLEMENTED |
| FX | AED→IRR | `FxPort` | IMPLEMENTED |
| Quote / payment / ledger / API | **IRR rial** | `Money` | IMPLEMENTED |
| **Front-office display** | **toman (÷10)** | `formatMoney` `api.ts:347-359` | IMPLEMENTED |
| Backoffice display | toman (`admin/lib/api.ts`) | local formatter | **PARTIAL** — duplicated logic |
| Sandbox | rial | same path | IMPLEMENTED |

**Mixed-unit surface (verified):** `QuoteBreakdown.tsx:49-50` shows a total in تومان beside an FX rate in ریال. **Field naming is the residual risk** — a bare `amount` is interpretable as toman; Phase 10 specifies `amountMinor` + explicit `unit`. **No test asserts the ÷10 boundary.**

---

## 11. Backoffice workflows

| Workflow | UI | API | Authz CURRENT / TARGET | Status |
|---|---|---|---|---|
| Order investigation | `/order/?id=` | `GET /v1/admin/orders/:id` | `ops\|admin` / `order:read` | **IMPLEMENTED** |
| Order search | `/orders/` | `GET /v1/admin/orders` | `ops\|admin` / `order:read` | **IMPLEMENTED-BUT-DEFECTIVE** — G-46: the row query `leftJoin`s unresolved exceptions (`repositories.ts:284`) so an order with N exceptions yields N rows, while `total` uses `count(DISTINCT orders.id)` (`:290`). Rows and count disagree and offset paging shifts |
| Exception queue | `/` | `GET /v1/admin/exceptions` | `ops\|admin` / `exception:read` | **IMPLEMENTED-BUT-DEFECTIVE** — G-47: cursor is `lt(id)` (`repositories.ts:635`) while sort is `desc(rank), desc(id)` (`:641`). Consistent **only because ranks are uniform** — fixing G-17 (ranking) without the cursor corrupts paging. Also the admin client never sends a cursor (`admin/lib/api.ts:120-124`), so the queue shows at most 20 with no "more" affordance |
| Exception ranking | — | — | — / `exception:rank` | **ORPHANED** — `updateRanks` `repositories.ts:656` never called |
| Exception assignment | — | — | — / `exception:assign` | **ORPHANED** — `assignee` column read, never written |
| Exception resolution | — | — | — / `exception:resolve` | **ORPHANED** — `resolveException` `admin.module.ts:305` no route |
| Manual resolution | — | — | — / `resolution:complete` | **MISSING** — §6 |
| Procurement | `/order/` | copilot + confirm | `ops\|admin` / `procurement:*` | **IMPLEMENTED** |
| Logistics | via transition | — | `ops\|admin` / `order:transition` | **PARTIAL** — no leg surface; `detectStalls` only logs (`worker/main.ts:380-386`) |
| Support | — | — | — / `support:*` | **MISSING** |
| Refund | — | — | — / `refund:issue` | **MISSING** |
| Payment investigation | — | — | — / `payment:read` | **MISSING** |
| Ledger investigation | `/finance/` | `GET /v1/admin/finance/ledger` | **`finance\|admin`** / `ledger:read` | **IMPLEMENTED-BUT-DEFECTIVE** — hand-emits `seq`/`txnId` with no DTO; **G-48: no pagination at all** — capped at 200 with a hardcoded `nextCursor: null` (`admin.module.ts:414`) that implies paging exists. Silent truncation on a reconciliation-grade surface |
| Reconciliation | — | — | — / `reconciliation:*` | **MISSING** — consumer logs only (`worker/main.ts:233-237`) |
| Integration health | **`/` queue home** — "Providers degraded" KPI tile + warning banner (`apps/admin/app/page.tsx:29,53,76-85`) | `GET /v1/admin/providers` | `ops\|admin` / `provider:read` | **IMPLEMENTED** — **CORRECTED.** Phase 6 claimed "no screen" three times and Phase 11 repeated it. Provider health *is* rendered on the queue home; what is missing is a dedicated detail view and any control action |
| Config / countries | — | — | — / `config:*` | **MISSING** |
| RBAC administration | — | — | — / `user:manage` | **MISSING** |
| Sandbox control | — | `/v1/sandbox/*` | **`ops\|finance\|admin`** (WP-01 interim) / `sandbox:control:*` | **IMPLEMENTED** — control plane authenticated and environment-gated; **the 2 browser-reachable gateway routes remain unauthenticated by necessity and unverified (WP-02)** |

**Finance authorization, precisely:** `finance` **is** permitted at the two finance handlers (method-level `@Roles('finance','admin')` wins via `getAllAndOverride`). It is blocked from **order and customer** endpoints, which carry only the class-level `ops|admin`. So the finance operator can read the ledger and cannot reach the order a `refId` points at.

---

## 12. Line B/C seams — extensibility, not implementation

No speculative rows. Verifying only that today's architecture does not force a fork:

| Seam | Exists? | Evidence |
|---|---|---|
| Organization / account context | **DESIGN-TARGET** | ADR-001; no table |
| Scoped authorization | **DESIGN-TARGET** | role strings only |
| Quote/pricing modes | **PARTIAL** | quote engine parameterized; no mode concept |
| Wallet / deposit | **DESIGN-TARGET** | no money model beyond direct pay |
| Order/procurement reuse | **IMPLEMENTED** | aggregates already separate |
| Logistics reuse | **IMPLEMENTED** | `CarrierPort` marketplace-agnostic |
| Marketplace extensibility | **IMPLEMENTED** | `MarketplaceRegistry` is data (`marketplace.ts:70-128`) |

**Conclusion:** the engine seams (order/procurement/logistics/marketplace) are real and reusable. The **identity and money** seams are design-target — which matches the Phase 2 finding that those two are the architectural bet.

---

## 13. Front-office simplicity check

Customer-visible vocabulary audited against internal concepts. **No leak of aggregates, roles, provider internals, or ledger terminology** — the 8-step projection (`buildCustomerTimeline`) is doing its job.

**One live leak:** 3 of 24 states (`DRAFT`, `QUOTING`, `QUOTED`) fall through `STATE_BADGES` to raw enum text (`track/page.tsx:95`). **And the timeline defect above (GAP-P11-01) is a second, larger one** — it does not leak vocabulary but it misrepresents progress.

---

## 14. Dead-end audit (§27) — by producer, not by edge

The useful question is not "does an exit edge exist" but "does anything perform it." Enumerated: only **4 transition targets are hardcoded** anywhere in application code (`PAID`, `PROCUREMENT_PENDING`, `PURCHASED`, `AWAITING_PAYMENT`); carrier-driven states come from `normalizeCarrierStatus` (`worker/main.ts:318,334`); the procurement guard sets `PRICE_CHANGED`/`OUT_OF_STOCK` (`worker/main.ts:154`).

**States with no automatic producer at all** — reachable only through the generic operator `POST /admin/orders/:id/transition`:

| State | Automatic producer | Exit producer | Verdict |
|---|---|---|---|
| `PROCUREMENT_FAILED` | **none** | operator only | reachable by operator; no system path |
| `PAYMENT_FAILED` | **none** | operator only | **dead** — a declined payment leaves the order in `AWAITING_PAYMENT` |
| `REFUND_PENDING` | **none** | **none** | operator can enter; **nothing performs `→ REFUNDED`** |
| `REFUNDED` | **none** | terminal | **unreachable** |
| `CANCELLED` | **none** | terminal | operator-reachable only |

**The sharpest dead end: `REFUND_PENDING`.** An operator *can* move an order into it via the generic transition endpoint, and **nothing anywhere can move it out** — `REFUNDED` has no producer and `PaymentPort.refund()` has no callers. An operator acting in good faith today can strand an order permanently in a refund state. This is worse than the previously recorded "refund is unbuilt," because the entry is reachable while the exit is not.

**Terminal states — are they terminal in UX as well as domain?** `DELIVERED` yes. `REFUNDED` and `CANCELLED` are domain-terminal but have **no `ALERTS` copy** and **no `STATE_TO_STEP_INDEX` entry**, so a customer reaching either sees an all-`PENDING` timeline and no closing message (G-19, G-20).

## 15. Review record

### Gate 1 — Phase 6 audit (outstanding since Phase 6; ran on the third attempt)

Found six defects no later phase had caught. Accepted after source verification:

| Finding | Verdict |
|---|---|
| **Provider health *does* have a screen** (`apps/admin/app/page.tsx:29,53,76-85`) | **Accepted** — Phase 6 claimed "no screen" three times and Phase 11 repeated it. Corrected in §11 |
| **G-46** order search `leftJoin` duplicates rows vs `count(DISTINCT)` | Accepted — `repositories.ts:284,290` |
| **G-47** exception cursor `lt(id)` vs sort `desc(rank), desc(id)` — **gates G-17** | Accepted; new dependency added to Chain F |
| **G-48** ledger has no pagination, hardcodes `nextCursor: null` | Accepted |
| **G-49** admin money commands ignore the `Idempotency-Key` they receive | Accepted |
| **G-51** capability matrix omits sorting, saved views, exports, history | Accepted |
| Phase 6 area counts internally inconsistent ("nine" listing ten; "1 of 11") | Accepted as a documentation defect; the substance stands |

### §33 — cross-phase adversarial review

Found the traceability model's own enumeration rule violated. All accepted after verification; **two register entries were withdrawn as false**:

| Finding | Verdict |
|---|---|
| **`apps/admin` does have sandbox references** — a full "Demo orders" filter | **Accepted.** My "zero references" claim was wrong in four documents. Real defect is narrower: no `X-Sandbox-Session` header |
| **G-40 fabricated** — `transition`/`reprice` post no ledger entries | **Accepted; G-40 withdrawn.** Real unkeyed posts are `confirmProcurement` and `settlePayment` |
| **21 tables, not 22** | Accepted; corrected program-wide |
| **`EVENT_TYPES` referenced nowhere functionally**; 18 dead constants not 12; 3 of 4 "producer, no consumer" have no producer; count/member mismatch | **Accepted — the weakest claim.** §5 violated this document's own enumeration rule by counting constants rather than emissions |
| Cancellation, `CUSTOMER_ACTION_REQUIRED`, `REFUND_PENDING` are operator-reachable via the generic transition endpoint | **Accepted** — statuses corrected from MISSING to PARTIAL |
| Customer `NEEDS_REVIEW` surface exists (`web/app/page.tsx:138`) | Accepted; C5 corrected |
| G-19 severity P1→P2, owning context presentation→domain | Accepted |
| 6 state-keyed maps, not 4 | Accepted |
| Operator login, `finance/balances`, `copilot` unenumerated | Accepted; §11 covers finance and procurement — operator login added as a known omission |
| `isException`/`isTerminal` have zero callers; `purgeOlderThan` uncalled → unbounded dedupe growth | Accepted → **G-52** |
| Dependency errors: G-13(P1) placed ahead of G-02(P0); G-03 and G-12 over-serialized | **Accepted** — see `dependency-graph.md` corrections |
| ~10 mis-cited line numbers (off by 1–5) | Accepted; the substance held in every case, but the citations were imprecise |

**Nothing was rejected.**

**The failure mode this phase exhibited.** Phase 11 was written specifically to counter Phase 10's under-searching, and its enumeration rule did work — it found G-19, G-46, G-47 and the dead-end above. **But §5 violated the rule while stating it**, by enumerating the constant table instead of the emission sites. Enumerating *a* set is not the same as enumerating *the right* set, and the review's identification of this as the weakest claim is correct.
