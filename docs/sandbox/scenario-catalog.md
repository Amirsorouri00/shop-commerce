# Sandbox Scenario Catalog

> Phase 9 of `docs/program/MASTER-PROMPT.md`. **Catalog and composition model — no implementation.** Companions: `sandbox-architecture.md`, `security-and-isolation.md`, `e2e-journey-matrix.md`.

## 1. Composition model

**Decision: a behaviour vector with named presets — not monolithic journeys, and not free composition.**

This formalizes what already exists. `ScenarioDefinition` (`packages/sandbox/src/scenario.ts`) is already a flat record of per-stage provider behaviours — `resolveDelayMs`, `resolveTier`, `resolveOutcome`, `productAvailable`, `fxAvailable`, `payment`, `procurementPriceMultiplier`, `availableAtProcurement`, and fulfilment fields — with twelve named presets built from it. That is the right structure; it needs formalizing and extending, not replacing.

**The vector, by stage:**

| Stage | Axis | Values |
|---|---|---|
| Resolution | `tier` | `api` · `structured` · `vision` · `manual` |
| | `outcome` | `RESOLVED` · `NEEDS_REVIEW` · `FAILED` |
| | `delayMs` | virtual ms |
| | `fieldConfidence` | per-field overrides (weight, price, availability) |
| | `availability` | available · unavailable · unconfirmed |
| | `eligibility` | permitted · restricted |
| | `offers` | single · multiple |
| | `variants` | none · ambiguous |
| Quote | `fx` | available · outage · rate-changed |
| | `viability` | viable · below-threshold |
| Payment | `behaviour` | success · declined · cancelled · timeout · pending-then-success · duplicate-callback · replayed-callback · malformed-callback · amount-mismatch |
| Procurement | `priceMultiplier` | 1.0 · within-tolerance · breach |
| | `availability` | available · out-of-stock |
| | `failure` | none · timeout · provider-error · uncertain-placement |
| Fulfilment | `progression` | normal · delayed · stalled |
| | `customs` | clear · hold · document-required · exception |
| | `delivery` | delivered · failed-attempt · lost |
| Post-order | `refund` | n/a · success · pending · failure |
| | `reconciliation` | matched · missing-settlement · duplicate-event · amount-mismatch |

### Causality constraints — the reason composition is not free

Arbitrary combinations produce states the domain cannot reach. **The composer must reject them rather than silently producing an impossible session.**

| Constraint | Why |
|---|---|
| `resolution.outcome ∈ {NEEDS_REVIEW, FAILED}` ⇒ no quote, payment, or later stage | Nothing to price |
| `quote.viability = below-threshold` ⇒ no payment | The viability gate blocks order creation |
| `payment ≠ success` ⇒ no procurement or later | `PAID` is the precondition for `PROCUREMENT_PENDING` |
| `procurement.availability = out-of-stock` ⇒ no fulfilment; refund path only | |
| `procurement.priceMultiplier = breach` ⇒ order branches to `PRICE_CHANGED`; fulfilment only if the customer accepts | Preserves the max-procurement-price guard |
| `fulfilment.*` requires `PURCHASED` | **Preserves `PAID ≠ PURCHASED`** — a scenario may never jump payment to fulfilment |
| `refund` requires a payment that succeeded | Cannot refund what was never captured — **but see the table defect below** |
| `DELIVERED` is terminal (`TRANSITIONS[DELIVERED] = []`) | **No post-delivery refund is reachable.** REF-01 must therefore refund a pre-delivery order; a post-delivery return flow does not exist in the domain |
| `reconciliation` requires at least one settled payment | |

**Two defects in the transition table that these constraints surfaced** — recorded rather than worked around, since the table is the authority and the constraints merely restate it:

- **`QUOTING → OUT_OF_STOCK → REFUND_PENDING → REFUNDED` is legal**, which refunds an order that was never paid. That contradicts the constraint above and is a genuine table defect, not a scenario-modelling error. *Phase 10 decision: either `OUT_OF_STOCK` from `QUOTING` should route to `CANCELLED`, or `REFUND_PENDING` should require a captured payment.*
- **`QUOTING` has no edge to `CANCELLED`.** A request that reaches `NEEDS_REVIEW` or `FAILED` (RES-03, RES-07) leaves the order **permanently wedged** — there is no legal exit. This makes the P0 manual-resolution dead end worse than recorded: it is not merely incomplete, it is unrecoverable.

**No cancellation scenario exists in this catalog**, which is how both defects went unnoticed. `CAN-01 CUSTOMER_CANCELS` ✳ is added: cancel from `QUOTED` and from `AWAITING_PAYMENT`, asserting the order reaches `CANCELLED` with no ledger effect.

**These constraints are the state machine restated at the scenario layer.** They are not a second source of truth — the domain still rejects illegal transitions at runtime (`sandbox-architecture.md` §10); the composer rejects them earlier so a tester gets a clear error rather than a session that mysteriously stalls.

**Presets are named vectors**, and a session may override individual axes with `sandbox:scenario:select`. The example from the phase brief — `product=low-confidence, payment=success, procurement=price-breach, logistics=not-reached` — is expressible and causally valid.

## 2. Catalog

Each scenario: **ID · purpose · initial state · actor · provider behaviour · expected transitions · expected UI · expected events · expected notifications · terminal state · assertions.** Existing scenarios are marked ✅; new ones ✳.

### Resolution

**`RES-01 HAPPY_PATH`** ✅ — baseline. Actor: customer. Providers: api tier, RESOLVED, available. Transitions: `DRAFT → QUOTING → QUOTED`. UI: product card, all fields confirmed. Events: `product.resolved`. Terminal: quoted. *Assert: no provenance markers; every required field confidence ≥ floor.*

**`RES-02 SLOW_RESOLUTION`** ✅ — ladder escalation is visible. **Corrected: the scenario is titled "Vision fallback" and sets `resolveTier: 'vision'`** — the product API has no data so resolution escalates to the vision model, slower and with lower weight confidence. UI: **staged progress copy**, not a static spinner. *Assert: escalation reaches the **vision** tier; weight confidence is below the UI's estimate threshold.*

**`RES-03 RESOLUTION_NEEDS_REVIEW`** ✅ — **the P0 dead end.** Providers: all automated tiers insufficient. Transitions: request → `NEEDS_REVIEW`, **and stops.** UI: customer told a person is checking; operator sees it in the review queue. *Assert: **no quote is produced**, and **no manual completion occurs** — the missing `manualOverrides` boundary must remain visible. This scenario exists to prove the gap, not to work around it.*

**`RES-04 UNSUPPORTED_PRODUCT`** ✅ — **corrected: the existing scenario is titled "Product unavailable" and sets `productAvailable: false` with `resolveOutcome: 'RESOLVED'`.** The product resolves successfully but is out of stock at the marketplace. UI: resolved card + unavailable block; quote refused. *Assert: `available === false`; no quote produced. **Distinguish from unconfirmed availability** (`provenance.available` absent).*

**`RES-04b UNSUPPORTED_URL`** ✳ — the scenario an earlier draft wrongly attributed to RES-04: a non-Amazon or unparseable URL. UI: explicit rejection naming the supported marketplace. *Assert: no product request row created; marketplace allowlist enforced at the edge.*

**`RES-05 LOW_CONFIDENCE_WEIGHT`** ✳ — vision tier returns weight at the 0.7 ceiling. *Assert: the field is marked estimated **via `provenance.tier`**; the risk reserve widens. **This scenario reproduces the Phase 7/8 boundary defect** where a `< 0.7` test renders a capped estimate as confirmed.*

**`RES-06 MISSING_WEIGHT`** ✳ — no tier supplies weight. *Assert: the 1kg pessimistic default applies, `missingFields` includes it, and the UI shows it as unknown — **never as observed data**.*

**`RES-07 PRICE_UNAVAILABLE`** ✳ — no price from any tier. *Assert: `assemble` returns undefined → `FAILED`; no quote attempted.*

**`RES-08 VARIANT_AMBIGUOUS`** ✳ — multiple variants, none clearly selected. UI: variant shown explicitly; picker where built. *Assert: the resolved variant is displayed as its own labelled line.*

**`RES-09 MULTIPLE_OFFERS`** ✳ — several sellers. *Assert: exactly one offer resolves into `ResolvedProduct`; `seller` stays singular; no seller picker (link-first RULE).*

**`RES-10 RESTRICTED_PRODUCT`** ✳ — ineligible category. *Assert: blocked at resolution with a specific reason — **not** at customs after payment. Currently no eligibility field exists, so this scenario **is expected to fail** until Phase 10 adds it: that failure is the finding.*

**`RES-11 PROVIDER_THROTTLED`** ✳ — marketplace rate-limits. *Assert: the rate limiter defers rather than failing; escalation or retry occurs.*

**`RES-12 PROVIDER_TIMEOUT`** ✳ — resolution provider hangs. *Assert: timeout fires at the resilience layer; ladder escalates.*

### Quote

**`QUO-01 NORMAL_QUOTE`** ✅ · **`QUO-02 FX_PROVIDER_DOWN`** ✅ — *assert: quote is blocked with retry; **no stale rate is presented as final**.* · **`QUO-03 PRICE_DRIFT_WITHIN_TOLERANCE`** ✅ — **note: its `stage` is `procurement`, not `quote`** (the drift is detected at procurement re-check, not at quoting). *Assert: procurement proceeds; price stays within `maxProcurementPrice`; no `PRICE_CHANGED` branch; no customer action.* · **`QUO-04 QUOTE_EXPIRY`** ✳ — advance clock past TTL; *assert: checkout forces a re-quote, **never a stale charge**.* **Expected to fail today:** quote validity reads real `Date.now()` in `quote-engine.ts`, so the virtual clock does not move it. · **`QUO-05 BELOW_VIABILITY`** ✳ — *assert: blocked with the economics explanation, **distinct from the restricted-item message**.* · **`QUO-06 FX_RATE_CHANGED`** ✳ — rate moves between quote and checkout; *assert: revalidation catches it.* **Expected to fail today:** FX snapshots live in a shared table refreshed on a real timer by an unsandboxed job.

### Payment

**`PAY-01 SUCCESS`** ✅ · **`PAY-02 PAYMENT_DECLINED`** ✅ *(scenario exists; assertion does not hold)* — **no code anywhere transitions an order to `PAYMENT_FAILED`.** The state exists in `TRANSITIONS` and the web badge map, and nothing sets it; the scenario leaves the order in `AWAITING_PAYMENT`. *Assert (target): `AWAITING_PAYMENT → PAYMENT_FAILED`, retry legal, "nothing has been charged" shown.* **Expected to fail — added to the known-failing set.** · **`PAY-03 PAYMENT_GATEWAY_TIMEOUT`** ✅ · **`PAY-04 ASYNC_SETTLEMENT`** ✳ — pending, then settles on clock advance; *assert: pending is a **real state**, not a spinner.* · **`PAY-05 DUPLICATE_CALLBACK`** ✳ — *assert: **idempotency key dedupes**; exactly one ledger entry; no double transition.* · **`PAY-06 REPLAYED_CALLBACK`** ✳ — an old callback re-sent later; *assert: rejected as stale.* · **`PAY-07 MALFORMED_CALLBACK`** ✳ — *assert: rejected at verification. **Blocked by F-S2** — `verifyWebhook` is unroutable, so this cannot be exercised until it is fixed. Recorded as a scenario that cannot yet run.* · **`PAY-08 AMOUNT_MISMATCH`** ✳ — callback amount ≠ order total; *assert: rejected, order not marked paid, discrepancy raised.* **Not modellable today:** the sandbox payment `verify()` returns `Money.of(0,'IRR')` by design, so there is no amount to mismatch. Requires the adapter to carry a settlement amount first. · **`PAY-09 CANCELLED_AT_GATEWAY`** ✳ — *assert: returns to a retryable state, never stuck.*

### Procurement

**`PRO-01 SUCCESS`** ✅ — *assert: `PAID → PROCUREMENT_PENDING → PURCHASED`; **`PAID → PURCHASED` never occurs directly**.* · **`PRO-02 PRICE_CHANGED_BREACH`** ✅ — *assert: branches to `PRICE_CHANGED`, **no purchase**; both customer decisions are legal edges.* · **`PRO-03 OUT_OF_STOCK_AT_PROCUREMENT`** ✅ — *assert: informational (`actionable: false`), refund path, no customer decision requested.* · **`PRO-04 PROVIDER_TIMEOUT`** ✳ · **`PRO-05 PROVIDER_FAILURE`** ✳ — *assert: `PROCUREMENT_FAILED`; retry to `PROCUREMENT_PENDING` is legal.* · **`PRO-06 DUPLICATE_REQUEST`** ✳ — *assert: idempotency prevents double purchase — the most expensive possible bug.* · **`PRO-07 RETRY_SUCCESS`** ✳ · **`PRO-08 UNCERTAIN_PLACEMENT`** ✳ — provider ambiguous about whether the order was placed; *assert: routed to operator, **never auto-retried** (double-purchase risk).*

### Fulfilment / customs

**`FUL-01 NORMAL_PROGRESSION`** ✳ — clock-driven; the carrier's first leg is `DISPATCHED_BY_SELLER`, normalized to `SELLER_PROCESSING`. Progression `SELLER_PROCESSING → LOCAL_TRANSIT → WAREHOUSE_RECEIVED → INTERNATIONAL_TRANSIT → CUSTOMS → DOMESTIC_TRANSIT → DELIVERED`. *Assert: the customer sees **8 steps**, never 24 states.* · **`FUL-02 CUSTOMS_HOLD`** ✅ — *assert: `CUSTOMS_EXCEPTION`, `actionable: true`, customer asked for a document.* · **`FUL-03 CUSTOMS_DOCUMENT_REQUIRED`** ✳ → resumes to `DOMESTIC_TRANSIT` on supply. · **`FUL-04 SHIPMENT_STALLED`** ✅ — *assert: informational; "we're chasing the carrier".* **Note:** `detectStalls` currently only writes a log line — it raises no exception — so the operator-visible half of this scenario does not yet occur. · **`FUL-05 DELIVERY_FAILED`** ✳ → `CUSTOMER_ACTION_REQUIRED`. · **`FUL-06 TRACKING_SILENCE`** ✳ — no carrier updates across a long advance; *assert: stall detection fires.* · **`FUL-07 UNKNOWN_CARRIER_STATUS`** ✳ — carrier returns an unmapped string; *assert: `normalizeCarrierStatus` returns null, **nothing raw leaks to the customer**, and it is logged for a human.*

### Post-order

**`REF-01 REFUND_SUCCESS`** ✳ — *assert: the **single** path `X → REFUND_PENDING → REFUNDED`; ledger entries balance; **no parallel refund semantics**.* · **`REF-02 REFUND_PENDING_THEN_SUCCESS`** ✳ · **`REF-03 REFUND_FAILURE`** ✳ — *assert: stays `REFUND_PENDING`, operator surfaced.* · **`SUP-01 SUPPORT_CASE`** ✳ — *expected to fail: no support API exists. The failure is the finding.* · **`REC-01 MATCHED`** ✳ · **`REC-02 MISSING_SETTLEMENT`** ✳ — *assert: distinguished from timing lag.* · **`REC-03 DUPLICATE_PROVIDER_EVENT`** ✳ · **`REC-04 AMOUNT_MISMATCH`** ✳ · **`REC-05 STALE_PENDING_PAYMENT`** ✳.

### Cross-cutting

**`SEC-01 SANDBOX_DISABLED`** ✳ — sandbox off; *assert: control routes **404**, `X-Sandbox-Session` ignored entirely, no session creatable.* · **`SEC-02 EXPIRED_SESSION`** ✳ — advance past TTL, then act; *assert: request **fails closed** with an explicit expiry error and **never reaches production adapters** (F-S1).* · **`SEC-03 UNAUTHORIZED_CONTROL`** ✳ — a `finance` operator attempts clock advance; *assert: `403`; business permissions unchanged inside the session.* · **`MON-01 RIAL_TOMAN`** ✳ — *assert: API total in **rial**; customer display = total ÷ 10 with a toman label. **A 10× error fails the suite.*** · **`STA-01 EARLY_STATES`** ✳ — exercise `DRAFT`/`QUOTING`/`QUOTED`; *assert: no raw enum text reaches the customer. **Expected to fail today** — `STATE_BADGES` is `Partial` (21/24).* · **`ISO-01 LEDGER_ISOLATION`** ✳ — run a sandbox order to `PAID`, then read `/admin/finance/balances`. *Assert: sandbox ledger entries are **excluded** from production balances. **Expected to fail today** — `ledgerEntries` has no sandbox column and `FinanceService.balances()` sums everything (F-S3). This is the assertion that makes simulated money visible as a real financial-integrity problem.*

**`NOT-01 NOTIFICATION_CAPTURE`** ✳ — *assert: exception-raised produces a captured notification with recipient, channel, template, and both locales.*

## 3. Traceability

Every scenario maps to a journey and, where applicable, a recorded finding:

| Journey / finding | Scenarios |
|---|---|
| J1 resolve | RES-01…12 |
| J2 quote | QUO-01…06 |
| J5 checkout/pay | PAY-01…09 |
| J6 tracking | FUL-01…07 |
| J7 customer decision | PRO-02, FUL-02/03/05 |
| J8 support/refund | REF-01…03, SUP-01 |
| J10 exception triage | PRO-02/03/05, FUL-02/04 |
| J13 reconciliation | REC-01…05 |
| **F9 manual resolution (P0)** | **RES-03** — proves the dead end |
| F1 finance authz | SEC-03 |
| P0-SEC-001 / F-S1 | SEC-01, SEC-02 |
| **F-S3 ledger isolation (P0)** | **ISO-01** |
| **F-S4 unauthenticated settle route (P0)** | **SEC-04** ✳ — call `/v1/sandbox/gateway/settle` unauthenticated; *assert: rejected.* Expected to fail |
| **F-S5 client-supplied sandbox tag (P0)** | **SEC-05** ✳ — create an order with a forged `x-sandbox-session`; *assert: rejected or ignored.* Expected to fail |
| **F-S6 unrouted ports** | **SEC-06** ✳ — run a sandbox quote; *assert: customs duty came from a sandbox adapter.* Expected to fail |
| Transition-table defects | **CAN-01** ✳ |
| Phase 8 money invariant | MON-01 |
| Phase 8 status completeness | STA-01 |
| API weight-confidence defect | RES-05 |

**Scenarios expected to fail today are a deliberate feature of this catalog.** RES-03, RES-04b, RES-10, SUP-01, STA-01, PAY-02, PAY-07, PAY-08, QUO-04, QUO-06, ISO-01, SEC-04, SEC-05 and SEC-06 encode known gaps as failing tests, so the gap is measured rather than remembered. A green suite would mean the catalog was written to flatter the system.
