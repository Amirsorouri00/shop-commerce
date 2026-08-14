# Service Blueprint

> Phase 3 of `docs/program/MASTER-PROMPT.md`. Maps every journey in `docs/ux/journey-map.md` through `CUSTOMER ACTION → FRONTSTAGE UI → API → DOMAIN PROCESS → BACKSTAGE OPERATION → EXTERNAL PROVIDER → EXCEPTION HANDLING`, per the Phase 3 spec. Rows citing `file:line` are verified against source in this pass; rows marked **NEW** describe required-but-nonexistent surfaces (the GAP/TARGET journeys) and are design targets, not current behavior — building them is Phase 5/6/10/12 work, not this document's job.

Legend: **E** = EXISTS, **P** = PARTIAL, **N** = NEW (net-new build required).

---

## J1–J2 — Resolution, quote

| Customer action | Frontstage UI | API | Domain process | Backstage operation | External provider | Exception handling |
|---|---|---|---|---|---|---|
| Paste product URL | Landing/paste-link page (`apps/web`) | Resolution endpoint (product resolution service) | Resolution ladder: authoritative → structured metadata → PDP extraction → browser/vision → confirmation/review | Operator review queue on ladder exhaustion | Amazon UAE (unauthenticated scrape/API per Phase 4) | `RESOLUTION_NEEDS_REVIEW`, `UNSUPPORTED_PRODUCT`, `SLOW_RESOLUTION` (`packages/sandbox/src/scenario.ts:133-269`) — **E** |
| Confirm product/variation | Confirmation screen | — (client-side selection, or a confirm mutation) | Normalized `Product Resolution` model (Phase 4 target) | — | — | Multiple variations/sellers → picker — **P**, resolution provenance model not yet designed |
| View landed-cost quote | Quote/breakdown screen | Quote endpoint | Landed-cost calculation (item + duty + logistics + margin); viability-gate check | — | FX rate provider; logistics rate card | `FX_PROVIDER_DOWN` (`scenario.ts`) blocks quote generation; viability-gate blocks below-threshold orders — **E** |
| Accept quote, proceed | — | — | Quote locked with TTL | — | — | Quote expiry → re-quote required — **E** (TTL mechanism), UI expiry handling — **P** |

## J3 — Authentication

| Customer action | Frontstage UI | API | Domain process | Backstage operation | External provider | Exception handling |
|---|---|---|---|---|---|---|
| Enter phone, request OTP | Auth modal/screen | OTP dispatch endpoint | Identity resolution / implicit account creation on first success | — | SMS provider (`StubSmsAdapter`/`FakeSmsAdapter`, `apps/api/src/composition/adapters.ts:321,349,386,394`) | Wrong number → edit before dispatch; too many attempts → cooldown — **E** in sandbox; real-provider outage fallback — **N** |
| Submit OTP | OTP input | OTP verify endpoint | Session/token issuance | — | — | Expired/incorrect OTP → resend with backoff — **E** |

## J4 — Address management (NEW)

| Customer action | Frontstage UI | API | Domain process | Backstage operation | External provider | Exception handling |
|---|---|---|---|---|---|---|
| View saved addresses | Address list — **N** | `GET /addresses` — **N** | Address ownership scoping | — | — | Empty list → prompt to add — **N** |
| Add/edit/delete address | Address form — **N** | `POST/PATCH/DELETE /addresses/{id}` — **N** | Bilingual (fa/en) validation per CLAUDE.md; serviceability check against supported zones | — | Geocoding/serviceability provider, if introduced — must sit behind a port per CLAUDE.md's "every outbound third-party call goes through a port" rule | Delete an address referenced by an in-flight order → block or reassign — **N**, undesigned |

## J5 — Checkout, payment, return

| Customer action | Frontstage UI | API | Domain process | Backstage operation | External provider | Exception handling |
|---|---|---|---|---|---|---|
| Confirm checkout | Checkout screen | Checkout/revalidate endpoint | Revalidate offer + availability + FX; re-lock quote (CLAUDE.md RULE) | — | — | Expired quote → forced re-quote — **E** |
| Pay | Gateway redirect | Payment-initiate endpoint (idempotency key required) | `AWAITING_PAYMENT → PAID` on success | — | Payment gateway (sandbox: mock Iranian-gateway-style page; real: EXTERNAL-GATE `PaymentPort`) | `PAYMENT_DECLINED`, `PAYMENT_GATEWAY_TIMEOUT` (`scenario.ts`) → `AWAITING_PAYMENT → PAYMENT_FAILED`, alert copy already written (`ALERTS.PAYMENT_FAILED`, `order-state-machine.ts:230-237`) — **E** |
| Return from gateway | `apps/web/app/checkout/return/page.tsx` polling against `SETTLED_STATES` (line 37-38) | Order-status poll endpoint | `PAID → PROCUREMENT_PENDING` (only legal edge — `TRANSITIONS`, `order-state-machine.ts:22`) | Outbox event → worker: `order.paid` topic consumer (`apps/worker/src/main.ts:~124`) | — | Duplicate gateway callback → idempotency key must dedupe — **P**, mechanism exists (CLAUDE.md invariant), explicit duplicate-callback test not confirmed present |

## J6 — Order list, detail, tracking

| Customer action | Frontstage UI | API | Domain process | Backstage operation | External provider | Exception handling |
|---|---|---|---|---|---|---|
| View order list | Order list screen | List orders endpoint | Ownership-scoped query | — | — | Empty → prompt to J1 — **E** |
| View order detail / tracking | Order detail, 8-step timeline (`order-display.ts:25-26` for badge styling) | Order detail + timeline endpoint | `buildCustomerTimeline()` (`order-state-machine.ts:169-187`) projects 24 internal states → 8 customer steps | Carrier/warehouse status ingestion → `normalizeCarrierStatus()` (`order-state-machine.ts:89-112`) | Carrier/warehouse/logistics adapters (`LogisticsPort`, EXTERNAL-GATE; sandbox scenarios cover it) | Unmapped carrier status → `null`, logged for human mapping, never leaked raw — **E**; operator surface to *add* a mapping — **N** |
| See exception banner | `alertFor(state)` bilingual copy (`order-state-machine.ts:213-278`) | (same detail endpoint) | Alert derived from current state, `actionable` flag distinguishes informational vs. decision-needed | — | — | `SHIPMENT_STALLED`, `CUSTOMS_HOLD` scenarios (`scenario.ts`) — **E** for banner display; **N** for push notification of the same event |

## J7 — Customer exception decision (NEW — core Phase 3 deliverable)

| Customer action | Frontstage UI | API | Domain process | Backstage operation | External provider | Exception handling |
|---|---|---|---|---|---|---|
| View actionable exception | Decision banner/screen, gated on `alertFor(state).actionable === true` — **N** UI, **E** underlying flag | (same detail endpoint) | — | — | — | Non-actionable states (`OUT_OF_STOCK`, `PROCUREMENT_FAILED`, `SHIPMENT_EXCEPTION`) deliberately excluded — **E** design already encodes this split, must not be overridden |
| Approve new price / continue | Decision control — **N** | `POST /orders/{id}/decision` (customer-facing, idempotency key) — **N**, must invoke the *same* domain transition as the existing operator-only path | `PRICE_CHANGED → PROCUREMENT_PENDING` (legal edge already in `TRANSITIONS`, `order-state-machine.ts:33`) | — | — | Race with operator/timeout auto-resolution → needs a lock — **N**, undesigned |
| Reject / cancel & refund | Decision control — **N** | Same endpoint, different target state | `PRICE_CHANGED`/`CUSTOMS_EXCEPTION`/`CUSTOMER_ACTION_REQUIRED` → `REFUND_PENDING` (legal edges already exist) | Refund execution (see J8) | Payment gateway `refund` method (`apps/api/src/composition/adapters.ts:532,539` — exists on the port, never called from any controller today) | SLA timeout with no customer response → **N**, no policy defined |
| Supply requested document (customs) | Document upload/response — **N** | Endpoint — **N** | `CUSTOMS_EXCEPTION → DOMESTIC_TRANSIT` (legal edge exists) | — | Customs authority / logistics provider, indirectly | Unknown document requirement → generic fallback message — **N** |

## J8 — Support & refund (NEW)

| Customer action | Frontstage UI | API | Domain process | Backstage operation | External provider | Exception handling |
|---|---|---|---|---|---|---|
| Open case | Support form — **N** | `POST /support/cases` — **N** | Case creation, optionally linked to an order | Routes into I1's queue (J12) | — | Malformed order reference → validation error — **N** |
| View case status / replies | Case list/detail — **N** | `GET /support/cases` — **N** | — | — | — | Stalled case with no operator response → SLA policy — **N**, undesigned (shares root cause with J7) |
| Refund triggered by resolution | Case resolution notice — **N** | (internal, triggered by operator action in J12) | Reuses existing state machine: `X → REFUND_PENDING → REFUNDED` (`TRANSITIONS`), never a parallel money path | Ledger entry written (`ledgerEntries` table, `packages/db/src/schema.ts:379-398`) | Payment port `refund` method — exists, unwired (`adapters.ts:532,539`) | Refund execution failure → retry via existing resilience proxy chain (cache→circuit-breaker→retry→timeout→instrumentation→adapter) — **N** wiring, **E** pattern to reuse |

## J10–J11 — Exception queue triage & manual transition

| Operator action | Frontstage UI | API | Domain process | Backstage operation | External provider | Exception handling |
|---|---|---|---|---|---|---|
| View ranked exception queue | Admin exception queue (default view, CLAUDE.md RULE) | `OpsService.listExceptions` (`admin.module.ts:68-97`) | `ExceptionRepository.listOpen`, `rank`/`rankedBy` fields | Ranking model intended but `updateRanks()` (`packages/db/src/repositories.ts:656`) never invoked — rank is effectively insertion-order | — | Empty queue → positive "clear" state — **E** functionally, framing — **P** |
| Open exception, read summary | Exception detail | `summariseException()` (`admin.module.ts:576-600`) — covers `PRICE_CHANGED`, `OUT_OF_STOCK`, `PROCUREMENT_FAILED`, `SHIPMENT_EXCEPTION`, `CUSTOMS_EXCEPTION` | — | — | — | — |
| Reprice order | Reprice action | `POST /admin/orders/{id}/reprice` (`admin.module.ts:511-524`, `@Roles('ops','admin')` line 436) | `OpsService.reprice` (line 268) | — | — | Illegal target → `assertTransition` throws — **E** |
| Transition order manually | Transition action | `POST /admin/orders/{id}/transition` (`admin.module.ts:494-507`) | Same `TRANSITIONS` table as automated path — no bypass | Immutable timeline append (CLAUDE.md invariant) | — | Illegal transition rejected, never silently ignored — **E** |
| See new high-rank exception | — | — | — | — | — | Proactive alert to operator on new exception — **N** (notification gap) |

## J12 — Support case handling (NEW)

| Operator action | Frontstage UI | API | Domain process | Backstage operation | External provider | Exception handling |
|---|---|---|---|---|---|---|
| View support queue | Support queue (mirrors J10 pattern) — **N** | `GET /admin/support/cases` — **N** | — | — | — | Empty → "caught up" — **N** |
| Open case with order/ledger context | Case detail joined to order + ledger — **N** | `GET /admin/support/cases/{id}` — **N** | Join case → order → ledger | — | — | Case referencing deleted/merged order → undesigned |
| Resolve / trigger refund | Resolution action, refund sub-action — **N** | `POST /admin/support/cases/{id}/resolve` — **N** | Reuses J8's refund path (`TRANSITIONS`, ledger, payment-port `refund`) | Same ledger write as J8 | Payment port `refund` | Dispute after resolution → reopen path — **N** |

## J13 — Reconciliation review

| Operator action | Frontstage UI | API | Domain process | Backstage operation | External provider | Exception handling |
|---|---|---|---|---|---|---|
| View reconciliation queue | Reconciliation screen — **P** (backend table exists, UI/API not confirmed) | — | `reconciliationItems` ↔ `ledgerEntries` (`packages/db/src/schema.ts:379-417`) | Automated matcher — **existence unconfirmed**, flagged in `PROJECT-STATE.md` | Settlement feed from payment/FX provider | Discrepancy → flag/escalate — **P** |
| Confirm match / flag discrepancy | Match action — **P/N** | — | `Money` value-object invariants apply throughout | Manual override must be audited (CLAUDE.md: AI never writes financial records; overrides need equal auditability) | — | Timing lag vs. genuine discrepancy → needs distinguishing state — **N** |

## J14 — Compliance/risk review (NEW)

| Operator action | Frontstage UI | API | Domain process | Backstage operation | External provider | Exception handling |
|---|---|---|---|---|---|---|
| View flagged orders/customers | Flagged-item queue — **N** | — **N** | Rule-based trigger logic (customs-limit proximity, pattern matching anti-personas AP2/AP3) — **N**, undesigned | — | — | No flags → positive state — **N** |
| Clear or escalate | Review action — **N** | — **N** | Cleared with recorded reason (audit trail) | — | Legal/compliance escalation is external to the system | False positive → clear-with-reason — **N** |

## J15 — Access grant/revoke (TARGET — RBAC generalization)

| Operator action | Frontstage UI | API | Domain process | Backstage operation | External provider | Exception handling |
|---|---|---|---|---|---|---|
| Today's reality | — | `@Roles(...)` decorator (`http.ts:207-208`) | `actor.role: string` membership check (`http.ts:200-201,256`) — flat, no Role/Permission/Scope tables | — | — | — |
| Target: assign scoped role | User/role management screen — **N** | `POST /admin/users/{id}/roles` — **N** | `Role`/`Permission`/`RolePermission`, scoped `PLATFORM` vs `ORGANIZATION` (already specified in `account-and-organization-model.md`) | Immediate effect on next authorization check — no permission-check caching allowed | — | Last-admin lockout prevention — **N**, undesigned |

---

## Reused-not-duplicated backstage mechanics

These apply identically across every row above marked with a domain process citing `TRANSITIONS`, ledger writes, or the resilience proxy chain — they are documented once here per CLAUDE.md's architecture rules, not repeated per row:

- **State transitions:** every mutation — customer-initiated (J7, **N**), operator-initiated (J10/J11, **E**), or system-initiated (J5's `order.paid` consumer, **E**) — passes through the single `TRANSITIONS` table (`order-state-machine.ts:15-49`) and appends to the immutable timeline. No code path is permitted to bypass it.
- **Outbound third-party calls:** payment, procurement, logistics, SMS, and (once built) notification adapters all sit behind a port wrapped in `cache → circuit breaker → retry → timeout → instrumentation → adapter` (CLAUDE.md). Sandbox scenarios (`packages/sandbox/src/scenario.ts`) exercise the failure modes of this chain for payment (`PAYMENT_DECLINED`, `PAYMENT_GATEWAY_TIMEOUT`, `FX_PROVIDER_DOWN`), procurement/resolution (`PRICE_CHANGED_BREACH`, `OUT_OF_STOCK_AT_PROCUREMENT`, `PRICE_DRIFT_WITHIN_TOLERANCE`, `UNSUPPORTED_PRODUCT`, `RESOLUTION_NEEDS_REVIEW`, `SLOW_RESOLUTION`), and logistics (`CUSTOMS_HOLD`, `SHIPMENT_STALLED`).
- **Events cross module boundaries via the outbox**, relayed to RabbitMQ, consumed by `apps/worker` (confirmed topics: `order.paid`, `procurement.purchased`, `exception.raised`, `shipment.leg_updated`, `apps/worker/src/main.ts`). Every **N** row above that needs to trigger downstream behavior (notification, ledger write, queue update) should emit an event and be consumed by a worker handler — not call across modules directly.
- **Idempotency:** every money/third-party mutating endpoint requires an idempotency key (CLAUDE.md) — applies to J5's payment-initiate, J7's decision endpoint, and J8/J12's refund trigger equally.

## No dead ends

Per MASTER-PROMPT §PHASE 3 ("No journey may terminate at a UI state without corresponding backend/operational behavior. No backend workflow may remain operationally inaccessible when a human is expected to manage it"): the two live violations this pass confirms are **J7** (backend supports the decision via existing `TRANSITIONS` edges, but the frontend never asks — the UI terminates at a read-only banner) and **J8/J12** (the ledger/state machine anticipates refund/support outcomes, but no human-accessible workflow exists on either side to invoke them). Both are named MVP-boundary items already (`mvp-vs-platform.md` #1–#2); this document is what makes them buildable rather than merely "known missing."
