# Sandbox — E2E Journey Matrix and Testing Strategy

> Phase 9 of `docs/program/MASTER-PROMPT.md`. **Strategy only — no tests implemented.** Companions: `sandbox-architecture.md`, `scenario-catalog.md`, `security-and-isolation.md`.

## 1. Test layers

Scenarios are not only E2E fixtures — the same behaviour vector feeds several layers, and each layer is chosen for what it can prove cheaply.

| Layer | Uses the sandbox how | Proves | Cost |
|---|---|---|---|
| **Unit** | not at all — pure domain | transition table, `Money`, timeline projection, resolution merge | ms |
| **Integration (in-process)** | sandbox adapters via composition root, real DB + real repositories | use case → domain → persistence → outbox | seconds |
| **API contract** | real HTTP, `X-Sandbox-Session`, real auth | contracts, validation, authorization, idempotency | seconds |
| **Worker** | sandbox-routed adapters, real broker | event consumption, retry, DLQ, state progression | seconds |
| **Browser E2E** | real front office / back office against a sandbox session | the journey a human actually experiences | minutes |
| **Regression** | curated subset, per-PR | no silent behaviour change | minutes |

**The heavy lifting belongs in integration and API tests, not the browser.** Browser E2E is reserved for journeys where the *interface* is the thing under test — a decision panel, a workspace preserving context, a payment return. Asserting ledger balance through a browser is slow and fragile; asserting it in an integration test is neither.

**Determinism requirements** (`sandbox-architecture.md` §3) make all layers repeatable: fixed seed, virtual clock instead of sleeps, no outbound network. **No test may `sleep()` to await a time-dependent transition** — it advances the virtual clock. This is the difference between a suite that takes minutes and one that takes hours.

## 2. Required E2E coverage

Twelve journeys, each mapped to scenarios, layer, and the assertion that gives it teeth. *(An earlier draft called these "the twelve the phase brief requires" — the brief specifies E2E coverage areas, not this enumeration. The list is this document's construction.)*

| # | Journey | Scenarios | Layer | Key assertions |
|---|---|---|---|---|
| **1** | Successful B2C purchase | RES-01, QUO-01, PAY-01, PRO-01, FUL-01 | **browser** + integration | Full spine paste→delivered. `PAID → PROCUREMENT_PENDING → PURCHASED` — **never `PAID → PURCHASED`**. Customer sees 8 steps, not 24 states. Ledger balances |
| **2** | Payment decline and retry | PAY-02 | browser | `AWAITING_PAYMENT → PAYMENT_FAILED → AWAITING_PAYMENT`. "Nothing has been charged" shown. Retry succeeds. No orphan ledger entry |
| **3** | Price-change customer decision | PRO-02 | **browser** | Order branches to `PRICE_CHANGED`, **no purchase**. Decision panel offers exactly two legal edges. Accept → `PROCUREMENT_PENDING`; reject → `REFUND_PENDING`. Idempotent submit. **Concurrent operator resolution surfaces as a version conflict, not an error** |
| **4** | Manual product-resolution review | **RES-03** | integration + browser | Reaches `NEEDS_REVIEW` and **stops**. Appears in the operator queue. **No quote produced. No manual completion path exists.** *Expected to fail at the completion step — that failure is the P0 finding (F9), and the test encodes it* |
| **5** | Procurement failure | PRO-05, PRO-06 | integration | `PROCUREMENT_FAILED`; retry legal. **Duplicate request does not double-purchase** — the most expensive possible bug |
| **6** | Customs / customer-action exception | FUL-02, FUL-03, FUL-05 | browser | `CUSTOMS_EXCEPTION` is `actionable: true`; customer supplies a document; resumes to `DOMESTIC_TRANSIT`. Exception is a **banner over the timeline, never a new step** |
| **7** | Refund | REF-01 | integration | Single path `X → REFUND_PENDING → REFUNDED`. Ledger balances. **No parallel refund semantics.** Full-order only — partial refunds are unmodelled and must not appear |
| **8** | Delivery | FUL-01 | integration | Clock-driven progression to `DELIVERED`. Each leg maps to a real domain state. **No UI-only states** |
| **9** | Finance / reconciliation investigation | REC-01…05, SEC-03 | API + browser | Finance reads ledger **and** contextual order/payment/refund. **Holds no `order:transition`/`refund:issue`.** Timing lag distinguished from genuine discrepancy. *Blocked today by F1 — encodes the gap* |
| **10** | Authorization-denied sandbox control | SEC-03 | **API** | A `finance` operator advancing the clock gets `403`. Business permissions **unchanged inside a session** — sandbox is never a privilege-escalation path |
| **11** | Sandbox-disabled behaviour | SEC-01, SEC-02 | **API** | Disabled → control routes **404** (not 403); `X-Sandbox-Session` ignored entirely. Expired session **fails closed** and **never reaches production adapters** (F-S1) |
| **12** | Rial→toman correctness | MON-01 | **API + browser** | API total in **rial**; rendered customer figure = ÷10 with a toman label. **A 10× error fails the suite** |

**Journey 13 — ledger isolation (ISO-01)** is added to the required set: run a sandbox order to `PAID` and assert its ledger entries are excluded from production balances. It currently fails (F-S3), which is precisely why it must exist.

**Journeys 10, 11, and 12 are the ones most likely to be skipped and least affordable to skip.** Two are security properties that fail silently; the third is a financial display error that nearly reached the shared component layer in Phase 8 and would have been invisible to any test not asserting the ratio.

## 3. Operator-side E2E

> **Blocking gap: none of these can run today.** `apps/admin` contains **zero** sandbox references — no way to send `X-Sandbox-Session`, no session selection, no control surface. The backoffice therefore always talks to production adapters, which makes E2E journeys 3, 6, 9 and every operator journey below **unexecutable**, not merely unimplemented. The phase brief's requirement that front office, backoffice, API, worker and sandbox operate as one integrated environment is **not met**, and admin sandbox support is a prerequisite for the operator half of this matrix.

Beyond the twelve, the backoffice journeys Phase 6/8 established:

| Journey | Assertions |
|---|---|
| Exception queue triage | Queue is the landing surface. **Selecting a record does not lose filter, sort, cursor, or scroll.** Next/previous traverses without returning to the list |
| Order workspace | Only **legal** transitions offered — from the server-supplied list, never computed client-side. Reason mandatory. `If-Match` conflict is a normal outcome |
| Manual resolution review | Queue renders; **completion is absent** (F9) |
| Reconciliation investigation | Inspector opens order context **without leaving the reconciliation position** |
| Sandbox control plane | Visually unmistakable; virtual-clock offset always visible; scenario and session identified |

## 4. Sandbox-vs-production parity

**The suite is only worth its runtime if sandbox composition differs from production in exactly one respect: which adapters are bound.** Everything else — routes, guards, validation, services, domain, repositories, outbox, workers, ledger — must be the same code.

**A parity test is therefore required** — but the version specified in an earlier draft of this document was wrong in a way that would have certified a diverged sandbox, and the correction matters more than the original claim.

**The error:** it asserted parity "except for the five routed ports plus notification capture." `AdapterSet` has **eight** ports. `customs`, `sms`, and `storage` are unrouted, so a test written to that specification **passes on a sandbox that prices customs duty with production logic and can send real SMS.**

**Corrected requirement:**
- Parity is asserted over **all eight ports** (plus notification once it joins `AdapterSet`). Any port not routed is a **declared, justified exception with an owning finding** — not an omission the assertion silently permits.
- Binding-time parity is **necessary but not sufficient**. The two real divergences are *runtime*: non-function port members resolving to production (`sandbox-routing.ts:44`), and the expired/corrupt-session fallthrough. A binding comparison cannot observe either. **Runtime parity needs its own assertion**: run a scenario and verify every outbound port call was served by a sandbox adapter — which requires the adapter call log (`sandbox-architecture.md` §9) as a test fixture, not just a debugging aid.

Known parity deviations today, each a defect rather than an accepted difference:
- **`customs`, `sms`, `storage` are unrouted** (F-S6) — customs materially, since it feeds the quote engine. *An earlier draft claimed "customs is folded into the carrier port"; that was false — `CustomsPort` exists independently and is simply not routed.*
- `verifyWebhook`, `supports`, `mode`, `name` are unroutable (F-S2).
- `/v1/sandbox/gateway/settle` bypasses webhook verification entirely (F-S4).
- An expired, unknown, or **corrupt-payload** session silently switches to production adapters (F-S1).

## 5. Scenarios expected to fail

Encoded as failing tests rather than omitted, so gaps are measured:

| Scenario | Fails because | Finding |
|---|---|---|
| RES-03 (completion step) | no `manualOverrides` path exists | **F9, P0** |
| RES-10 | no `eligibility` field | Phase 4/5 |
| PAY-07 | `verifyWebhook` unroutable | **F-S2** |
| SUP-01 | no support API | Phase 3/6 |
| STA-01 | `STATE_BADGES` is `Partial` (21/24) | Phase 8 |
| Journey 9 (context read) | F1 coarse authorization | Phase 6 |
| **ISO-01** | `ledgerEntries` has no sandbox column; balances sum everything | **F-S3, P0** |
| **SEC-04** | `/v1/sandbox/gateway/settle` is unauthenticated | **F-S4, P0** |
| **SEC-05** | client-supplied `x-sandbox-session` copied unvalidated into orders | **F-S5, P0** |
| **SEC-06** | `customs`/`sms`/`storage` unrouted | **F-S6** |
| PAY-02, Journey 2 | nothing transitions an order to `PAYMENT_FAILED` | new |
| PAY-08 | sandbox `verify()` returns `Money.of(0,'IRR')` | new |
| QUO-04, QUO-06 | quote validity and FX use real time, not the virtual clock | new |
| Operator journeys 3, 6, 9 | `apps/admin` has no sandbox support at all | new |

**These must be marked as known-failing with an explicit reason, never skipped.** A skipped test is invisible; a known-failing test with a linked finding is a measurement. When the gap closes, the test turns green without anyone remembering to re-enable it.

## 6. CI strategy

| Trigger | Suite | Budget |
|---|---|---|
| Per commit | unit + integration | < 2 min |
| Per PR | + API contract + worker + regression subset | < 8 min |
| Per merge to main | + full browser E2E (all 12) | < 20 min |
| Nightly | + full scenario catalog incl. known-failing | unbounded |

**Known-failing scenarios run nightly, not per-PR** — they should not block unrelated work, but they must be visible and their count tracked. A rising count means the system is drifting from its own design.

## 6a. Control-plane API contracts

An earlier draft deferred these to `scenario-catalog.md`, which contains no API — a circular reference. Stated here instead, as design targets:

```
POST   /v1/sandbox/sessions              create (scenario, seed, label)   sandbox:session:create
GET    /v1/sandbox/sessions              list own sessions                sandbox:use
GET    /v1/sandbox/sessions/:id          inspect state + log              sandbox:use
POST   /v1/sandbox/sessions/:id/advance  advance virtual clock            sandbox:clock:advance
POST   /v1/sandbox/sessions/:id/scenario select / override axes           sandbox:scenario:select
POST   /v1/sandbox/sessions/:id/inject   provider failure / event         sandbox:inject:*
POST   /v1/sandbox/sessions/:id/reset    reset simulation state           sandbox:session:reset
DELETE /v1/sandbox/sessions/:id          delete                           sandbox:session:delete
GET    /v1/sandbox/sessions/:id/notifications   captured outbound         sandbox:use
GET    /v1/sandbox/sessions/:id/calls           adapter call log          sandbox:use
```

**Three gaps between this and today's implementation:** `AsyncSandboxSessionStore` has **no `list()`**; per-axis scenario override is impossible against a frozen 12-key `SCENARIOS` record when a session stores only a `scenarioId` (the session must store a resolved behaviour vector, not a preset id); and `advance` has **no cap and no audit record**.

**`/v1/sandbox/gateway/settle` is not part of this control plane.** It is a simulated *provider* surface, and per F-S4 it must move behind the webhook verification seam rather than remaining a direct settlement route.

## 6b. Deliberately out of scope

- **Stripe-style and PayPal-style mock checkouts** (named in the phase brief). The MVP corridor is Iranian gateways; building foreign-gateway mocks would simulate an integration the product has no path to. Recorded as an explicit scope decision rather than an omission — revisit if a foreign acquirer enters the roadmap.
- **Load, concurrency, and multi-order queue behaviour** — see §7.

## 7. What this strategy does not yet cover

- **Load and concurrency.** Determinism assertions are on final state and event sets, not interleaving; nothing here tests behaviour under concurrent operators on the same order beyond the `If-Match` path.
- **Browser matrix.** No decision on which browsers or viewports; Phase 8's responsive degradation points (1280/1024/768) are the natural candidates.
- **Visual regression.** Phase 8's token migration will change nearly every type size in the front office; a visual baseline captured *before* that migration would be actively misleading.
- **Accessibility assertions.** Phase 8 requires keyboard traversal, focus management, and contrast; automated a11y checks belong in this suite but are not specified here.
- **Data volume.** Every scenario is single-order. Queue behaviour at operational volume — where bulk actions and ranking matter — is untested, and Phase 6 already noted that order-volume assumptions are unstated.
