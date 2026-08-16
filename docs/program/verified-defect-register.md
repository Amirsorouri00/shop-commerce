# Verified Defect Register

> Phase 10 of `docs/program/MASTER-PROMPT.md`. **Every entry below was verified by opening the implementing source in this phase.** Per the Phase 10 evidence discipline (§1), no claim about backend behaviour appears here without a file:line citation, and claims inherited from earlier phases that failed verification are marked **CORRECTED**.
>
> Companions: `docs/architecture/state-machine-reconciliation.md`, `backend-domain-api-reconciliation.md`, `sandbox-isolation-backend.md`, `api-design-standards.md`.

## Classification key

`existing-correct` · `existing-incomplete` · `orphaned` (code exists, no caller) · `contradictory` (code contradicts its own documentation) · `missing` · `external-gate`

---

## P0 register

### P0-SEC-001 — sandbox configuration fails open
**Status:** contradictory · **Evidence:** `packages/contracts/src/env.ts:63-67`, `apps/api/src/main.ts:91`, `apps/api/src/modules/sandbox.module.ts:111`

`SANDBOX_ENABLED` is `.optional().transform((v) => v !== 'false')` — **unset yields `true`** — under a comment reading "Off in production." Referenced only by a startup log line. `SandboxController` is `@Public()` at class level; `SandboxModule` is registered unconditionally.

**Root cause:** the flag was written as a log field, never as a gate. **Layer:** configuration + composition root.

---

### P0-SEC-002 — the verified webhook path is unreachable; unverified ones are open
**CORRECTED — there are three settlement ingestion paths, not two.**
**Status:** contradictory · **Evidence:** `apps/api/src/modules/commerce.module.ts:536-565`, `apps/api/src/modules/sandbox.module.ts:180-204`, `apps/api/src/composition/adapters.ts:~139`, `apps/api/src/common/http.ts:223-229`

This is **not** the defect Phase 9 recorded, and the corrected form is worse.

1. **`WebhookController` carries no `@Public()` decorator.** Its own docstring says *"Public — the gateway has no bearer token — but signature-verified."* The four `@Public()` sites in the file are all in `CommerceController` (`:452, :463, :469, :480`). Under the global default-deny guard, **`POST /v1/webhooks/payments/:provider` requires a bearer token no gateway can supply.** The verified ingestion path is therefore unreachable in production.
2. **`POST /v1/sandbox/gateway/settle` is public and unverified** — no auth, no session header, no signature — and calls `OrderService.settlePayment` directly.
3. **`StubPaymentAdapter.verifyWebhook()` returns `true` unconditionally**, so even were the webhook reachable, verification is a no-op under the stub.

4. **`POST /v1/dev/gateway/settle`** (`apps/api/src/modules/dev-gateway.module.ts:27,74-82`) is a **third** path, `@Public()`, settling provider `'stub'` — which is the **default** payment provider (`adapters.ts:126`). An earlier version of this register missed it entirely.

**But it is correctly production-gated**, unlike the sandbox route: `assertEnabled()` throws `NotFoundError` when `NODE_ENV === 'production'` (`:42-44`), and its comment shows deliberate care — *"The provider name is fixed here rather than taken from the request precisely because this endpoint is unauthenticated — a caller who could name the provider could aim this at a real gateway's payment records."* **This is the pattern the sandbox route should have followed and did not.**

**Corrected conclusion:** the only functioning settlement path *in production* is the unauthenticated sandbox one, because the dev gateway 404s there and the verified webhook is unreachable. In development all three are open.

**Severity refinement (CORRECTED from Phase 9):** `settlePayment(provider, providerRef)` looks up by **provider-scoped** reference (`commerce.module.ts:342`), and the sandbox route passes the literal `'sandbox'`. It therefore cannot settle a payment recorded under a real provider. Phase 9's implication that any payment could be settled was overstated.

**But the composite risk is real:** unauthenticated settle → sandbox payment settles → ledger post → **untagged ledger row** (P0-SEC-004) → **production balances move**. F-S4 and F-S3 compose into an unauthenticated balance-manipulation path.

**Root cause:** a missing decorator, plus a sandbox shortcut built to work around the resulting breakage. **Layer:** controller/guard + sandbox composition.

---

### P0-SEC-003 — client-controlled sandbox tagging
**Status:** existing-incomplete · **Evidence:** `apps/api/src/modules/commerce.module.ts:491-500`

`createOrder` reads `x-sandbox-session` from the request and copies it into `sandboxSessionId` with **no validation** — no session-existence check, no ownership check, no authorization.

**Root cause:** a trust boundary treated as a transport detail. **Layer:** request context + application command.

**SEVERITY CORRECTED — this is exploitable now, not a constraint on future work.** An earlier version framed default-exclusion as something to sequence *after* provenance. **Default-exclusion already exists:** `packages/db/src/repositories.ts:249` applies `isNull(orders.sandboxSessionId)` when `sandbox === 'exclude'`, and `adminOrderSearchQuery` **defaults to `'exclude'`** (`packages/contracts/src/schemas.ts:323`).

So today an authenticated customer can set `x-sandbox-session` to any string on order creation and **their real order disappears from the operator's default search**. The concealment channel is live. The ordering constraint still holds for the *remaining* isolation work (financial tables), but the register must not describe a present vulnerability as a future risk.

**Ordering constraint (still binding for the rest):** server-authoritative provenance must land **before** extending exclusion to financial tables — and, given the above, provenance is now the single most urgent item in Chain A.

---

### P0-SEC-004 — sandbox money contaminates production balances
**Status:** missing · **Evidence:** `packages/db/src/schema.ts` (21 `pgTable` declarations; `sandboxSessionId` at `:238` only), `apps/api/src/modules/admin.module.ts:392-433`

**1 of 21 tables carries a sandbox tag.** `ledgerEntries` has none. `FinanceService.balances()` sums four accounts across **all** entries with no filter — and cannot filter, because the column does not exist. `FinanceService.ledger()` likewise returns sandbox and production rows indistinguishably.

**Root cause:** isolation designed at one aggregate, never propagated. **Layer:** persistence.

---

### P0-DOMAIN-001 — an unpaid order can enter the refund path
**Status:** contradictory · **Evidence:** `apps/api/src/domain/order-state-machine.ts:17, 33-46`

Six edges enter `REFUND_PENDING`: from `PRICE_CHANGED`, `OUT_OF_STOCK`, `PROCUREMENT_FAILED`, `CUSTOMER_ACTION_REQUIRED`, `SHIPMENT_EXCEPTION`, `CUSTOMS_EXCEPTION`.

**CORRECTED — there are TWO pre-payment refund paths, not one.** An earlier version of this entry claimed "exactly one," which was wrong and made the proposed fix incomplete:

1. `QUOTING → OUT_OF_STOCK → REFUND_PENDING` (`:17`, `:34`)
2. **`QUOTED → PRICE_CHANGED → REFUND_PENDING`** (`:18`, `:33`) — a quote can move to `PRICE_CHANGED` before any payment exists, and `PRICE_CHANGED` refunds.

The second path survives the `OUT_OF_STOCK` split entirely, so **D1 and D2 alone do not close P0-DOMAIN-001.** This is why the refund *eligibility predicate* (D3) is not defence-in-depth but load-bearing: topology alone cannot close both paths without also splitting `PRICE_CHANGED`, and `PRICE_CHANGED` is genuinely one concept reachable from two lifecycle positions.

**Root cause — not a stray edge.** `OUT_OF_STOCK` is **overloaded across two lifecycle positions with different financial semantics**:
- pre-payment: the item was unavailable at quoting — no money exists, no refund is meaningful;
- post-payment: the item sold out before procurement — refund is exactly right.

Deleting the edge would leave the pre-payment case with **no exit at all**. The fix is to separate the concepts (see `state-machine-reconciliation.md`).

**Financially impossible edges also missed by the earlier analysis** — three edges terminate a **paid** order at `CANCELLED` with no refund and no money movement: `OUT_OF_STOCK → CANCELLED` (`:34`), `PRICE_CHANGED → CANCELLED` (`:33`), `CUSTOMER_ACTION_REQUIRED → CANCELLED` (`:37`). D1 makes this *worse* by declaring `OUT_OF_STOCK` post-payment-only, which removes the one reading under which that edge was benign. **Cancelling a paid order must either be illegal or must route through refund.**

**Also verified:** **no code anywhere transitions an order into `REFUND_PENDING`** — grep across `apps/api/src` and `apps/worker/src` returns nothing outside the table itself. The refund lifecycle is **entirely table-only**, consistent with the payment port's `refund()` having no callers. Refund is not partially built; it is unbuilt.

---

### P0-DOMAIN-002 — failed resolution wedges the order permanently
**Status:** missing · **Evidence:** `apps/api/src/domain/order-state-machine.ts:17`; `apps/api/src/composition/adapters.ts:280-305`

`QUOTING: ['QUOTED', 'OUT_OF_STOCK']` — there is **no exit for a failed or abandoned resolution**, and **no edge to `CANCELLED`**. A request whose resolution returns `FAILED`, or that needs review and never receives it, has no legal terminal state.

**Compounding:** `ManualResolutionStrategy` is **never registered**. `buildStoreStrategies` pushes only `StubStoreStrategy`; the commented-out cases name `marketplace-api`, `structured-data`, and `vision-llm` — **manual is absent from the switch entirely**. So the tier is not merely missing a `manualOverrides` producer (the Phase 6/9 finding); it is never constructed.

**Root cause:** the resolution lifecycle was modelled for success and stock-out only. **Layer:** domain topology + composition.

---

## Corrections to earlier phases

Recorded because a defect register that quietly drops disproven claims is worthless.

| Claim | Phase | Verdict | Evidence |
|---|---|---|---|
| "Customs is folded into the carrier port" | 9 | **FALSE** | `CustomsPort` is independent (`packages/core/src/ports.ts:107`) with `CategoryPriorCustomsAdapter` (`adapters.ts:175-199`) |
| "Sandbox quotes compute duty with production logic — a defect" | 9 | **OVERSTATED — not a defect** | `CategoryPriorCustomsAdapter.estimate()` is pure computation over a static prior table with **no outbound call**. It is deterministic internal business logic behind a port, not an external integration. The same logic in both modes is *correct*; mocking it would reduce fidelity. **`sms` and `storage` remain genuine unrouted external boundaries** |
| "`NotificationPort` has no consumer" | 3, 9 | **FALSE** | A consumer exists (`apps/worker/src/main.ts:224-231`), bound and deduped by event id; it writes a log line. Missing are the **emitter** and the **adapter** — `NotificationRequested` (`packages/core/src/events.ts:61`) appears nowhere else |
| "Anyone can settle any payment" | 9 | **OVERSTATED** | `settlePayment` is provider-scoped; the sandbox route passes `'sandbox'` |
| "Reconciliation matcher existence unconfirmed" | 0, 6 | **NOW VERIFIED — absent** | Queue and consumer exist (`worker/main.ts:233-237`) but the consumer only calls `logger.debug`. `reconciliationItems` table exists (`schema.ts:400`). No matching algorithm |
| Parity test over five ports | 9 | **WRONG** | `AdapterSet` has **eight** (`adapters.ts:65-74`) |

---

## P0 dependency ordering (binding input to Phase 12)

Two independent chains. Within each, order is mandatory; the chains may run in parallel.

### Chain A — sandbox trust and isolation

```
1. P0-SEC-001  fail-closed configuration
       ↓        (nothing else is safe while sandbox self-enables)
2. P0-SEC-003  server-authoritative sandbox provenance
       ↓        (tag must be trustworthy before anything filters on it)
3.             validated session + context propagation
       ↓
4. P0-SEC-004  tag propagation to financial tables
       ↓
5.             default-exclusion in repositories, then reports/queries
       ↓
6. P0-SEC-002  callback parity: fix WebhookController, retire the settle shortcut
       ↓
7.             admin sandbox propagation
       ↓
8.             executable E2E sandbox parity
```

**Step 5 must not precede step 2.** Excluding on a client-settable tag creates a concealment channel — the mitigation becomes the vulnerability.

**Step 6 sits after isolation** because until ledger rows are tagged, exercising settlement in sandbox keeps moving production balances.

### Chain B — pre-payment lifecycle

```
1. P0-DOMAIN-002  pre-payment failure/cancellation semantics
       ↓            (a lifecycle with no exit cannot host a review workflow)
2. P0-DOMAIN-001  separate pre- from post-payment stock-out; refund eligibility guard
       ↓
3.                 register the manual resolution tier
       ↓
4.                 manual review application command + API
       ↓
5.                 operator review UI (Phase 12)
```

**Step 4 must not precede steps 1–2.** Wiring a review workflow against a lifecycle whose failure branch has no terminal state produces orders that cannot be closed — the Phase 12 work package would deliver a queue that fills and never drains.

---

## Non-P0 verified findings carried to Phase 12

| Finding | Status | Evidence |
|---|---|---|
| Exception `assignee` has no writer | orphaned | `schema.ts:434`, `admin.module.ts:90` (read only) |
| `resolveException` has no route | orphaned | `admin.module.ts:305-308`, sole reference |
| `updateRanks` never called | orphaned | `packages/db/src/repositories.ts:656` |
| Nothing transitions to `PAYMENT_FAILED` | missing | grep across api + worker |
| `detectStalls` only logs | existing-incomplete | `apps/worker/src/main.ts:380-386` |
| Reconciliation consumer logs only | existing-incomplete | `apps/worker/src/main.ts:233-237` |
| `STATE_BADGES` covers 21/24 states | existing-incomplete | `apps/web/lib/order-display.ts:10` |
| `apps/admin` has zero sandbox awareness | missing | grep: 0 references |
| `verifyWebhook` unroutable (synchronous) | existing-incomplete | `sandbox-routing.ts:26` |
| `sms`, `storage` unrouted | existing-incomplete | `adapters.ts:65-74` vs `SandboxPortName` |
| Session TTL slides on every port call | existing-incomplete | `sandbox-routing.ts:70-74` |
| No CAS on session writes | missing | read-modify-write across API, worker, poller |
| `ApiResolutionStrategy` weight never escalates | contradictory | `strategies.ts:83-85` (0.6) vs floor 0.5 |
| Seven resolution fields absent | missing | `packages/commerce/src/types.ts:10-29` |

---

## Verification actually executed (Phase 10 §35)

Not asserted — run, with output observed.

| Check | Command | Result |
|---|---|---|
| Unit + package tests | `npx vitest run` | **132 passed, 6 files, 0 failed** (1.13s) |
| Typecheck | `npx turbo typecheck` | **16/16 packages successful** (4.25s) |

**This resolves a question carried since Phase 0.** `handoff.md` claimed 120 tests and every phase since has recorded "whether the tests currently pass is unverified." They pass, and the count is now **132** — the earlier figure was accurate when written and has since grown.

**Coverage of the tested surface, stated honestly:** the passing suites are `core/money`, `validation`, `sandbox`, `commerce` (resolution pipeline, procurement guard), `resilience`, and `auth.otp`. **There is no test file for `order-state-machine.ts`**, which is where every P0-DOMAIN defect lives — the transition table's illegal edges pass typecheck and unit tests precisely because nothing asserts against them. Nor is there an integration test exercising `settlePayment`, which is where P0-SEC-002 sits.

**So a green suite is not evidence against this register.** It is evidence that the *tested* subsystems are sound, and a measurement of where tests are absent: the domain state machine, payment settlement, and every sandbox isolation boundary.

**Not run, and why:** database migrations, integration tests, and E2E require Postgres, Redis, RabbitMQ, and MinIO via `docker compose`. Not started in this phase — Phase 10 is architecture, and the running-service verification belongs with the Phase 12 packages that change behaviour.

---

## Review record

### Review A — self completeness

Found five brief sections under-served (events/outbox, worker boundaries, persistence boundaries, support, contracts) and added them. **Found no contradictions** — consistent with every phase since 5.

### Review B — independent adversarial

The most severe review of the program. All findings below were verified against source before acceptance; **none were rejected**.

**Errors in this phase's own analysis:**

| # | Claim | Reality |
|---|---|---|
| R1 | "**Exactly one** pre-payment refund path" | **Two.** `QUOTED → PRICE_CHANGED → REFUND_PENDING` (`:18`, `:33`) is a second, and **it survives D1/D2 entirely** — so the proposed topology fix did not close P0-DOMAIN-001. The eligibility predicate is load-bearing, not defence-in-depth |
| R2 | "Session id in the event envelope… already works this way," cited to `worker/main.ts:48-55` | **False, and cited to lines showing something else.** The real mechanism is an **order-row lookup** keyed on `event.payload.orderId` (`:100-108`). **Events without `orderId` — much `payment.*`/`exception.*` traffic — never enter sandbox context at all.** This was the weakest claim: load-bearing, wrong, and it justified designing *no* event propagation |
| R3 | "The only functioning settlement path is the unauthenticated one" | **Three paths exist.** `/v1/dev/gateway/settle` (`dev-gateway.module.ts:27`) was missed entirely — `@Public`, settling the **default** provider — though correctly production-gated, unlike the sandbox route |
| R4 | Notification dedupe "exactly right… do not rewrite" | **Wrong, and it inverts.** `once()` marks processed **before** the handler and commits independently, so a throwing handler permanently suppresses redelivery — **at-most-once**, while the module docstring and §9a both claim at-least-once. A correctness defect in the event backbone |
| R5 | Migration "additive, no behaviour change" | New states break **four** state-keyed collections — `TERMINAL_STATES`, `EXCEPTION_STATES`, `STATE_TO_STEP_INDEX`, `ALERTS`. `alertFor()` would return null for both new terminals, contradicting D1's own claim that `UNAVAILABLE` carries customer copy |
| R6 | Concealment channel framed as a **future** ordering risk | **Live today.** `repositories.ts:249` already excludes sandbox rows and `schemas.ts:323` defaults to `exclude`, while the client can set the tag. A customer can hide a real order from operator search **now** |
| R7 | Event producers for `product.resolved`, `product.resolution_failed`, `fx.updated` | **Fabricated** — those constants have no producers. Also omitted `order.created` and `order.state_changed` (the latter has no consumer) |
| R8 | "Finance blocked" | **Imprecise.** Finance *is* permitted at the two finance handlers; it is blocked from **order/customer** endpoints |
| R9 | "No persistence exposed" | `FinanceService.ledger()` hand-emits `seq`/`txnId` with no DTO |
| R10 | `RESOLUTION_REVIEW → QUOTED` | Should be `→ QUOTING`; review resumes resolution, it does not produce a quote |
| R11 | Permission vocabulary used throughout | **Does not exist.** Roles are `ops\|finance\|admin` string equality. Every permission named is a design target, and the role→permission migration gates them all |
| R12 | `sandbox:control:*` proposed | Contradicts this program's own no-wildcard rule. Enumerated instead |
| R13 | New order states | **Duplicate a persisted enum** — `productRequest.status` already carries `NEEDS_REVIEW\|FAILED`. The God-state-machine test had to be applied for real: resolution status stays on `ProductRequest` |
| R14 | Financially impossible edges | `OUT_OF_STOCK → CANCELLED`, `PRICE_CHANGED → CANCELLED`, `CUSTOMER_ACTION_REQUIRED → CANCELLED` all terminate a **paid** order with no refund. D1 makes this worse |
| R15 | Unbounded cycles | Three retry cycles with no cap — harmless while operator-driven, runaway once automated |
| R16 | `PAID` treated as a resting state | Never observable; `settlePayment` moves to `PROCUREMENT_PENDING` in the same transaction |
| R17 | Citations to "phase brief §N" | `MASTER-PROMPT.md`'s Phase 10 section has **no numbered subsections**. Those citations point at the acceptance-criteria message, not the repo file, and should say so |

**Also flagged and accepted:** `availableActions` has no producer, consumer, or test anywhere; `@Idempotent` covers four commerce routes while admin `transition`/`reprice` post ledger entries with none; both gateway settle routes swallow all exceptions and 302 regardless; `@Body()` on those routes is raw with no `zodBody`; `buildStoreStrategies` registers **nothing** in production, not "only the stub."

**The failure mode, stated plainly.** Phase 9's was unverified assertions about code. Phase 10's is subtler and worse: **claims that were verified but under-searched** — I opened `order-state-machine.ts` and still missed a second refund path; I read `worker/main.ts` and described a mechanism it does not implement. Opening the file is necessary and insufficient; the discipline required is *enumerating* the search space (all edges into a state, all settle routes, all state-keyed collections) rather than confirming the first instance found.
