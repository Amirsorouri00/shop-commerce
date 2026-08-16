# Sandbox Architecture

> Phase 9 of `docs/program/MASTER-PROMPT.md`. **Architecture only — no implementation.** Companions: `security-and-isolation.md` (the security boundary and four defects), `scenario-catalog.md`, `e2e-journey-matrix.md`.
>
> Much of this formalizes and extends an existing implementation rather than designing one. `packages/sandbox/` and `apps/api/src/composition/sandbox-routing.ts` already implement the hard part correctly.

## 1. The principle, and how it is already enforced

**The sandbox must exercise the same UI → API → use case → domain → persistence → events/workers → ports path as production, replacing only the outermost adapters.**

This is implemented structurally rather than by convention. `routeByContext` binds each port token to a Proxy resolving its adapter per call from ambient session context, so **no application or domain service contains an `if (sandbox)` branch.** The source states the reason precisely: *"the moment a service branches on 'am I in a sandbox', the sandbox stops proving anything about the real path."*

The worker routes identically (`apps/worker/src/main.ts:48-55`), so an event for a sandbox order reaches that session's adapters rather than production ones.

**What this buys, and what Phase 9 must not trade away:** state machines, authorization, validation, idempotency, the outbox, workers, the ledger, and every application use case are the *same code* in both modes. A sandbox that bypassed any of them could not expose the integration defect it exists to find.

**The prohibition that follows:** no sandbox-only application service, no admin button that sets an order state directly, no front-office mock screen that fakes a response. Where a control is genuinely low-level (forcing a provider event), it belongs in the control plane (§7) and is labelled as such — never mixed into a business surface.

## 2. Session model

The existing `SandboxSession` (`packages/sandbox/src/session.ts:22-38`) already carries: `id`, `scenarioId`, `seed`, `createdAt`, `realStart`, `virtualOffsetMs`, `purchasedAtVirtual`, `log`, `counters`. Stored in Redis with a TTL.

**Additions required:**

| Field | Why |
|---|---|
| `createdBy` (actor id) | Audit, and per-actor session limits |
| `expiresAt` (explicit) | Currently derived from a store-level TTL; the UI must be able to warn *before* expiry rather than discovering it via failure (see F-S1) |
| `providerStates` | Runtime overrides layered on the scenario — e.g. "payment provider is now down" injected mid-session (§8) |
| `label` | Human name for a demo session, so a shared link is identifiable |

**Where session context lives:** the `X-Sandbox-Session` header → ambient context → the routing Proxy. **Domain entities do not carry sandbox fields**, with one deliberate exception: `orders.sandboxSessionId`, which exists for data isolation rather than behaviour. That asymmetry is correct — behaviour is routed ambiently; *isolation* must be durable in the row.

**Session lifecycle:** create (scenario + optional seed) → active → advance/inject/reset → expire or delete.

**Reset semantics, corrected.** An earlier draft said reset "discards its tagged data," which contradicts §7's rule that the control plane never writes domain state. Today `reset()` clears only clock, log, and counters — the tagged rows remain. **The rule wins: reset returns *simulation* state to its initial values and leaves domain data in place.** Purging sandbox rows is a separate, explicitly-authorized administrative operation, not a side effect of reset. Anything else would make the control plane a domain-mutation path.

## 3. Determinism

**Requirement:** the same `scenario + seed + initial state + ordered actions` produces the same observable result.

Existing basis: scenarios are declarative behaviour records and `sandboxProductFor` generates products from a deterministic hash of the ASIN, so an arbitrary link yields a stable product.

**Sources of nondeterminism that must be controlled:**

| Source | Rule |
|---|---|
| Wall clock | Domain time comes from the session's virtual clock, never `Date.now()` in domain code |
| Random ids | Seeded from the session seed. Order/payment ids must be reproducible within a session |
| **Default seed** | **Currently `Math.random()` in both stores — determinism is opt-in, not default.** A seed must be mandatory, or defaulted to a fixed value, for any scenario claiming reproducibility |
| **PRNG lifetime** | `createSandboxAdapters(() => buildContext(session))` is invoked **per port call**, so a seeded PRNG restarts on every call — producing a constant rather than a reproducible *stream*. The seeded generator must live on the session, not in the adapter factory |
| **Session write concurrency** | No compare-and-set (F-S8). Counters that drive scenario branching can be lost, changing outcomes |
| Randomised behaviour | Only where a scenario explicitly models it, and always seeded |
| Provider latency | Virtual, from the scenario (`resolveDelayMs`), never real sleeps |
| External network | Sandbox adapters make **no outbound calls whatsoever** |
| Cache | Session-namespaced (per `security-and-isolation.md` §5), so a prior session cannot alter a later one's result |
| Concurrency | Worker processing order is not guaranteed; assertions must be on **final state and the set of emitted events**, not on interleaving |

**Real timers currently defeat the no-sleep rule.** The tracking poller (5s), FX refresh (180s), and stall detector (600s) run on real intervals, and `quote-engine.ts` reads `Date.now()` for quote validity. Until domain time is injected (§4), **QUO-04 (quote expiry) and QUO-06 (FX rate change) cannot be run by advancing the virtual clock** — they are added to the expected-to-fail set rather than presented as runnable. A shared `fxSnapshots` table written by an unsandboxed refresher compounds this: session-namespaced *cache keys* do not isolate a shared *table*.

**TTL jitter and retry backoff are deliberately left nondeterministic** — they are infrastructure behaviour, and a sandbox that removed them would stop testing what production does. Scenarios must not assert on their timing.

## 4. Virtual clock

Existing: `virtualOffsetMs` moved by `advance()`, with `purchasedAtVirtual` anchoring shipment legs. The stated intent — *"what lets a five-day delivery be walked through in a meeting"* — is right.

**Formalized boundary (detailed in `security-and-isolation.md` §7):** the sandbox clock controls **domain/business time only**. Infrastructure time and security time are untouched. The mechanism must be an injected business clock consulted by domain code, **never a global `Date.now()` override**.

**Time-dependent behaviours the clock must drive:** quote expiry · payment timeout and async settlement · customer decision timeout (SLA policy still undefined — §11) · procurement timeout · shipment leg progression · customs hold duration · notification scheduling · support SLA · refund progression · reconciliation windows.

**Advancing is a control-plane action** requiring `sandbox:clock:advance`, audited, and **never reversible** — time may not run backwards, because a domain that observed a later time and then an earlier one would be in a state production can never produce.

## 5. Provider simulation

Sandbox adapters implement **the same ports** as production and are selected at the composition root. Routed ports today: `store`, `fx`, `payment`, `procurement`, `carrier`.

| Port | Sandbox behaviour | Status |
|---|---|---|
| Store / resolution | tier + outcome + delay from scenario; deterministic catalog | exists |
| FX | fixed rate; outage per scenario | exists |
| Payment | simulated gateway page; declined/timeout/duplicate/async settlement | exists, needs callback-verification routing (F-S2) |
| Procurement | price multiplier, availability, failure modes | exists |
| Carrier / logistics | leg progression against virtual time | exists |
| **Customs** | **exists as its own port and adapter — but is UNROUTED** | **F-S6.** An earlier draft of this document wrongly said customs was "folded into carrier." `CustomsPort` (`packages/core/src/ports.ts:107`) has `CategoryPriorCustomsAdapter` and is injected into the quote engine — so **sandbox quotes compute duty with the production adapter** |
| **SMS** | exists, **unrouted** | F-S6 — a sandbox session could send a real SMS |
| **Storage** | exists, **unrouted** | F-S6 |
| **Notifications** | no adapter | §6 |

**`AdapterSet` has eight ports; five are routed.** `customs`, `sms`, and `storage` use production adapters in **every** session — a permanent fail-open, not an expiry edge case.

**Ports not routed at the member level:** `supports`, `verifyWebhook`, `mode`, `name` are synchronous and always resolve to production. For three of those this is harmless. **`verifyWebhook` is not** — see `security-and-isolation.md` F-S2, and F-S4 for the settle route that bypasses verification entirely.

## 6. Notification simulation

`NotificationPort` and `notification.requested` exist as types with **no adapter, no binding, and no emitter**. **Correcting an earlier draft and the Phase 3 finding it inherited: a consumer does exist** — `QUEUES.notification` is consumed at `apps/worker/src/main.ts:224-231`, bound to `order.*`/`payment.*`/`exception.*`, deduped by event id. It only writes a log line. So the wiring is further along than recorded: the queue, topology, and dedupe exist; what is missing is an emitter and an adapter. Phase 3 also concluded notifications are MVP-now, because the customer exception-decision journey is unusable without them.

**Sandbox must therefore provide the first working `NotificationPort` implementation: a capture adapter.** The existing consumer already does console logging, and Phase 3 concluded that is insufficient where customer journeys depend on notifications — the capture adapter replaces the log line with an inspectable store.

**Note a parity consequence:** `NotificationPort` is **not** in `AdapterSet` today, so adding a routed sandbox notification adapter means a sixth routed token. The parity test (§`e2e-journey-matrix.md`) must be written against the actual port count, not the current five.

Each captured notification records: recipient · channel (`sms`/`push`/`in-app`) · template id · rendered payload (both locales) · created-at (virtual **and** real) · delivery status · retry count · failure reason · triggering event and correlation id.

**The sandbox inbox is a control-plane surface** — an operator or tester inspects what *would* have been sent. This makes notification-dependent journeys observable and testable before any provider exists, and it means the notification trigger points get exercised now rather than being retrofitted with the adapter later.

**This is deliberately not the production adapter.** It is a capture implementation of the real port; wiring a real provider replaces it at the composition root with no domain change.

## 7. Control plane

Sandbox control is **explicitly separate from business operations**. Two different things happen in a sandbox session:

- **Business actions** — resolve, quote, pay, transition, refund — flow through **normal production APIs**, unchanged, with normal authorization.
- **Control actions** — create session, select scenario, advance clock, inject failure, replay callback, reset, delete, inspect — flow through a **namespaced control-plane API** (`/v1/sandbox/*`) with sandbox-specific permissions.

**Never conflate them.** The prohibition from §1 restated as an API rule: the control plane may change *adapter and environment behaviour*; it may never write domain state directly. There is no "mark this order delivered" control endpoint — there is a carrier simulation that reports delivery, which the real domain path then processes.

**Control-plane capabilities:** session create/reset/delete/list · scenario select · clock advance · provider-failure injection · callback replay · session state inspection · event timeline · notification inbox · adapter call log.

**UI placement** (per Phase 8): control surfaces live in a dedicated sandbox control area, **not** scattered into customer or operator business screens. The front office's existing `DemoPanel` — which renders only when the sandbox is reachable — is the right shape and gating for a customer-side demo control; it must gain authentication per the security model.

## 8. Failure injection

**Injection happens at provider and infrastructure seams — never by corrupting domain state.** Writing a bad row to make an error appear tests nothing; making the adapter behave badly tests the real handling path.

Injectable: timeout · HTTP error · malformed response · rate limit / throttle · provider unavailable · delayed event · duplicate event · stale (out-of-order) event · partial data.

**None of this exists yet, and the gap is larger than "not implemented."** Adapters read only the frozen `ScenarioDefinition`; the `providerStates` field proposed in §2 has **no consumer**, and rate-limit, malformed-response, partial-data and stale-event have no representation in the scenario type at all. Runtime injection requires the adapters to consult session-level overrides — a change to how adapters read behaviour, not merely a new control endpoint.

Two forms: **scenario-declared** (baked into the scenario, deterministic, the default) and **runtime-injected** (mid-session via the control plane, requiring `sandbox:inject:*`, recorded in the session log so the run remains reconstructible even though it is no longer purely scenario-determined).

## 9. Observability

A session must be inspectable enough for deterministic debugging and demonstration. Exposed per session: correlation ids · domain event timeline · state transitions with actor and reason · adapter calls and responses · worker processing records · captured notifications · errors and retries · money movements (tagged ledger entries) · audit actions.

The existing `SandboxLogEntry` (`at`, `stage`, bilingual `message`, `detail`) is the right primitive and should be extended with correlation id and adapter-call detail.

**Scoping rule:** a sandbox user sees **their session's** observability data, never production traces, other sessions, or infrastructure internals. The inspector is a session-scoped view, not a window into the platform.

## 10. Legal transitions in sandbox

Carrying Phase 8's decision: **frontends never derive legal transitions locally**; the order detail response carries the legal next states, computed server-side from `TRANSITIONS`.

**Sandbox uses the identical mechanism.** A scenario may not make an illegal transition possible — the state machine is domain logic, not an adapter, and is therefore never simulated. If a scenario appears to need an illegal transition, the scenario is wrong.

This also means sandbox is a genuine test of the transition table: `PAID → PURCHASED` remains illegal in sandbox exactly as in production, so a scenario cannot accidentally collapse `PAID ≠ PURCHASED`.

## 11. Known gaps this architecture must expose, not hide

The phase brief is explicit that the sandbox should reveal missing boundaries. Each of these is a *dead end the sandbox must make visible*, not paper over:

| Gap | Sandbox behaviour |
|---|---|
| **Manual resolution unreachable (P0, F9)** | `RESOLUTION_NEEDS_REVIEW` must land in an operator review queue and **stop there**, visibly. **No scenario may simulate manual completion behind the scenes** — the missing `manualOverrides` boundary is the finding, and hiding it would destroy the evidence |
| **Exception assign/resolve/rank orphaned (F2/F3/F4)** | Exceptions appear in the queue; assign and resolve are **absent, not stubbed** |
| **Finance blocked by coarse authz (F1)** | A sandbox finance operator hits the same wall. The sandbox must not grant what production denies |
| **Notifications unwired** | Fixed *within* sandbox by the capture adapter (§6) — the port gains its first implementation |
| **Customer-decision SLA undefined** | Scenarios can reach the timeout condition; **what happens then is undefined** and must be recorded as reaching an undesigned state, not given a sandbox-invented default |
| **Partial refunds unmodelled** | Sandbox implements full-order refund only. No parallel semantics |
| **`STATE_BADGES` partial (21/24)** | Scenarios exercising `DRAFT`/`QUOTING`/`QUOTED` make the raw-enum leak **observable** — which is the point |
| **`QuoteBreakdown` mixes rial/toman** | A money-correctness assertion (§12) catches it |
| **API weight-confidence defect** | A scenario returning API-tier weight at 0.6 shows escalation failing to trigger |

## 12. Money correctness

Phase 8's invariant: canonical IRR is **rial** in API, domain, and storage; customer display converts to **toman**; shared `Money` owns the conversion.

**Sandbox must test this, not merely respect it.** Required assertion, and it belongs in the E2E suite: a scenario with a known quote total asserts the **API response is in rial** and the **rendered customer figure is that value ÷ 10 with a toman unit label**. A 10× display error must fail the suite — this is the defect that nearly shipped into the shared component layer in Phase 8, and an assertion is the only thing that would have caught it.

**Sandbox money obeys every `Money` rule.** Simulated amounts are still value objects; currency mismatch still throws. A sandbox that let a scenario fabricate a bare number would stop testing the invariant it exists to protect.

## 13. Implementation work discovered (Phase 10–12 input, not done here)

1. **Fail-closed configuration** — strict enum, conditional module registration, production guard, 404 when disabled *(closes P0-SEC-001)*.
2. **Fail-closed routing** on unknown/expired session *(closes F-S1)* — the highest-severity item after config, because it can reach real providers.
3. **Route `verifyWebhook`** *(closes F-S2)*.
4. Sandbox permissions and control-plane authorization.
5. **Propagate the sandbox tag beyond `orders` (1 of 21 tables today) and make repository-layer exclusion the default** *(closes F-S3 — sandbox ledger entries currently move production balances)*.
6. Session-namespaced cache keys.
7. Notification capture adapter + inbox surface.
8. Injected business clock replacing any `Date.now()` in domain paths.
9. Customs as its own port seam.
10. Distinct sandbox callback route + sandbox webhook verifier.
11. Session fields: `createdBy`, explicit `expiresAt`, `providerStates`, `label`.
12. Control-plane API per `scenario-catalog.md` and §7.

---

## 14. Review record

### Review A — self completeness

Checked every phase criterion. Found and fixed one omission mid-pass: **F-S3**, discovered by auditing tag propagation rather than asserting it — only 1 of 21 tables carries a sandbox tag, so sandbox ledger entries move production balances. Also verified one requirement was *already satisfied* (`createSandboxAdapters` takes no credentials, so sandbox adapters are structurally incapable of holding production secrets).

**Consistent with Phases 5–8: self-review found omissions, not contradictions.**

### Review B — independent adversarial

The most productive review of the program so far. Every finding was verified against source before acceptance; none were rejected. Grouped by kind:

**Factual errors in this phase's own artifacts — the reviewer caught claims I had asserted without checking:**

| # | Claim made | Reality |
|---|---|---|
| B1 | "Customs is folded into the carrier port" | **False.** `CustomsPort` exists independently with its own adapter and feeds the quote engine. The real defect is worse: it is **unrouted**, so sandbox quotes compute duty with production logic. `sms` and `storage` too — `AdapterSet` has **8** ports, 5 routed |
| B2 | `NotificationPort` has "no consumer" | **False.** A consumer exists (`worker/main.ts:224-231`), bound and deduped; it only logs. Missing pieces are the emitter and adapter |
| B3 | RES-02 "structured tier answers" | Scenario is `resolveTier: 'vision'`, titled "Vision fallback" |
| B4 | RES-04 "non-Amazon URL, no row created" | Scenario is "Product unavailable" — `productAvailable: false`, `resolveOutcome: 'RESOLVED'`. A different scenario was invented and labelled as existing |
| B5 | QUO-03 filed under Quote | Its `stage` is `procurement` |
| B6 | FUL-04 "raises a shipment exception" | `detectStalls` only logs |
| B7 | Citation drift | `session.ts` is the in-memory store, not Redis; `sandboxProductFor` doesn't exist (unexported `syntheticProduct`) |

**New defects the review found that this phase had missed:**

| # | Defect | Severity |
|---|---|---|
| **F-S4** | `/v1/sandbox/gateway/settle` — **unauthenticated**, on the `@Public` controller, calling `settlePayment` directly and bypassing webhook verification. Fixing F-S2 alone would **not** unblock the callback scenarios | **P0** |
| **F-S5** | `createOrder` copies a **client-supplied** `x-sandbox-session` into the row unvalidated — a real order can be tagged sandbox. **And §5's proposed default-exclude would then hide it** from operator search and financial reports. The mitigation amplifies the hole | **P0** |
| **F-S6** | Three ports permanently unrouted (B1) | P0 |
| **F-S7** | Session TTL slides on every port call, contradicting the proposed `expiresAt` and F-S1's expiry contract | medium |
| **F-S8** | No compare-and-set on session writes; counters that drive scenario branching can be lost — **defeats determinism** in a way the "assert final state" rule does not cover | medium |
| B8 | Nothing anywhere transitions an order to `PAYMENT_FAILED` — PAY-02 and Journey 2 assert behaviour no code performs | medium |
| B9 | Default seed is `Math.random()`; the seeded PRNG restarts per port call, yielding a constant rather than a stream | medium |
| B10 | Real timers (poller 5s, FX 180s, stall 600s) and `Date.now()` in the quote engine make QUO-04/QUO-06 unrunnable by clock advance | medium |
| B11 | **`apps/admin` has zero sandbox references** — the operator half of the E2E matrix is *unexecutable*, and the brief's "one integrated environment" requirement is unmet | **high** |
| B12 | `providerStates` has no consumer; rate-limit/malformed/partial-data/stale-event have no representation in the scenario type | medium |
| B13 | Control-plane API "defined in the catalog" — the catalog contained none. Circular reference; `list()` doesn't exist on the store; per-axis override impossible against a frozen preset record | medium |
| B14 | Transition-table defects surfaced by the causality constraints: `QUOTING → OUT_OF_STOCK → REFUND_PENDING` refunds an **unpaid** order; **`QUOTING` has no exit to `CANCELLED`**, so a failed resolution wedges the order permanently | **high** |
| B15 | Reset "discards tagged data" contradicted the rule that the control plane never writes domain state | medium |
| B16 | The parity test — **the weakest claim** — specified five ports against an eight-port `AdapterSet`, so as written it would *certify a diverged sandbox*, and it cannot observe the two runtime divergences at all | **high** |

**Nothing was rejected.** B14 in particular is a finding about the *domain*, not the sandbox: a permanently wedged order after failed resolution makes the P0 manual-resolution gap unrecoverable rather than merely incomplete.

**The pattern across five phases now includes a sharper variant:** self-review finds omissions; adversarial review finds contradictions *and* unverified assertions. Phase 9's factual errors (B1–B7) were all claims stated confidently without opening the file — a failure mode distinct from the design contradictions of earlier phases, and one that the "verify before asserting" discipline exists to prevent.
