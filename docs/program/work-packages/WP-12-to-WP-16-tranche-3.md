# Tranche 3 — Remaining broken MVP journeys (WP-12 … WP-16)

> WP-11 (manual resolution) has its own document. These five complete the tranche.

---

## WP-12 — Exception operations

**P1 · missing application boundary · Contexts:** Exception, backoffice · **Depends on: WP-08 (HARD), WP-06, WP-10**

**Why.** Three orphans with one shape — built to the controller boundary and stopped: `assignee` is a column (`schema.ts:434`) read into the DTO (`admin.module.ts:90`) and **written by nothing**; `resolveException` (`admin.module.ts:305-308`) has its own definition as its **sole reference**; `updateRanks` (`repositories.ts:656`) is **never called**. Plus **G-50** — `resolveException` takes **no actor**, writing only `resolvedAt`/`resolutionNote`, so shipping it as-is produces an unattributed resolution.

**MVP scope, decided by "does the operator loop break without it":** **claim** (two operators collide silently without it) and **resolve** (a benign exception otherwise has no exit and the queue degrades permanently) are in; release and operator note are cheap and in. **Deferred with reasons:** assign-to-another (needs a team model that does not exist), reprioritize (ranking does not run — manual override of an absent ranking is meaningless), escalate (no escalation target exists), reopen (defer until resolve has usage evidence).

**Concurrency.** Claim uses **compare-and-set** — claiming an already-claimed exception returns **409 with the current holder**, never a silent overwrite. Resolve requires `If-Match` and is idempotent.

**Ranking honesty.** Until ranking runs, the queue **must not present itself as risk-ranked** — sort explicitly by age or margin-at-risk, both already computed per item.

**HARD ordering.** WP-08 first: implementing ranking against a cursor keyed on `id` corrupts pagination the moment ranks stop being uniform.

**Acceptance.** Every command records an actor; the queue has a working exit; concurrent operators cannot silently overwrite each other; pagination correct with ranking active.

---

## WP-13 — Customer exception decisions

**P1 · missing application boundary · Contexts:** Order, front office · **Depends on: WP-04 (HARD), WP-06, WP-19** *(WP-06 added after review — the decision endpoint needs `order:decide`, and two documents disagreed)*

**Why (G-14).** The backend already has the legal edges; **the frontend never asks.** `alertFor` (`order-state-machine.ts:213-278`) marks exactly **four** states `actionable: true` — `PRICE_CHANGED`, `PAYMENT_FAILED`, `CUSTOMER_ACTION_REQUIRED`, `CUSTOMS_EXCEPTION`. `PAYMENT_FAILED`'s action is retry via checkout; the other three have **no customer API**.

**Inherit the split; do not invent decisions.** `OUT_OF_STOCK`, `PROCUREMENT_FAILED`, `SHIPMENT_EXCEPTION` are `actionable: false` by deliberate design — inform, do not ask.

**Scope.** A customer decision **application command** — not a controller shortcut. An earlier draft scoped this as "an endpoint exercising existing legal transitions," which is implementable entirely at the controller and would be exactly the symptom-patch this program forbids. The command validates the decision against the order's state, applies the transition through the domain, records the actor and reason, and emits the event. The route is a thin adapter over it. Idempotency-keyed; the decision panel on `/orders/:id`; document supply for customs. **Concurrency:** an operator may resolve the same exception via `POST /admin/orders/:id/transition`, so "already decided" is a **normal outcome surfaced as a version conflict**, not an error.

**Open, not invented:** the customer-decision SLA/timeout remains undefined. This package must **not** invent a default; it surfaces the state and records the gap.

**Acceptance.** A customer can accept or reject a price change and see the result; concurrent operator action degrades gracefully; no decision is offered for a non-actionable state.

---

## WP-14 — Refund capability

**P0 · financial · Contexts:** Payment, Order, Finance · **Depends on: WP-04 (HARD), WP-02, WP-06, WP-03 + WP-07 (HARD — added after review)**

**Owns:** G-14a *(refund execution — newly assigned; an earlier draft gave this package G-25 and G-27, which belong to WP-15 and WP-04/WP-21 respectively, leaving a P0 on the critical path owning nothing)*, and the **implementation** of `RefundEligibility` moved here from WP-04.

**Why.** Refund is **entirely unbuilt, not partial** — nothing anywhere transitions into `REFUND_PENDING`, and `PaymentPort.refund()` has no callers. Worse, the Phase 11 dead-end audit found an operator **can** enter `REFUND_PENDING` via the generic transition endpoint while **nothing performs `→ REFUNDED`**: entry reachable, exit not. An operator acting in good faith today can strand an order permanently.

**Scope.** **Implement `RefundEligibility`** — the predicate WP-04 declares and cannot satisfy (settled payment exists, amount > 0, none in flight, provider supports refund). It is a **domain** service, not a controller check, because the worker, the operator command, and any future automated path all need it. **This package owns the invariant outright**; WP-04 owns only the topology and the guard points.

**Sandbox dependency, added after review.** This package posts ledger entries and ships sandbox scenario `REF-01`. `ledgerEntries` carries **no sandbox column** (`schema.ts:379`), so a sandbox refund would move production balances — reintroducing G-06 while closing a dead end. **WP-03 and WP-07 are therefore hard prerequisites**, not optional.

Also: refund application command; provider invocation through the port; ledger entries; the single `X → REFUND_PENDING → REFUNDED` path; outbox event; customer and operator states; sandbox `REF-01`.

**Partial refunds are excluded, and the command takes no amount** — the refundable sum is derived server-side, so a generic `amount` parameter cannot introduce partial refunds by accident. Changing that is an explicit domain decision.

**Acceptance.** **No path refunds an unpaid order** (the financial invariant, asserted once, here); `REFUND_PENDING` always has a reachable exit; ledger balances; refund is idempotent; **a sandbox refund leaves production balances unchanged**.

---

## WP-15 — Notification delivery

**P1 · provider integration · Contexts:** Notification, worker · **Depends on: WP-05 (HARD)**

**Why — build only what is missing.** A consumer **exists** (`worker/main.ts:224-231`), bound via `topology.ts:43` to `order.*`/`payment.*`/`exception.*`, deduped by event id, and it **already receives real events and discards them** by logging. The earlier claim that no consumer exists was false and must not drive a rewrite — rebuilding would discard working dedupe structure.

**Actually missing:** the emitter (nothing publishes `notification.requested`; the constant is dead), the `NotificationPort` adapter, delivery persistence and status, retry, preferences, and a read surface.

**HARD ordering.** Notification guarantees on top of at-most-once delivery drop messages under handler failure. WP-05 first.

**Sandbox.** The capture adapter gives `NotificationPort` its first implementation and makes notification-dependent journeys observable before any provider exists.

**Acceptance.** A state change produces exactly one notification under redelivery; failures are visible and retried; the sandbox inbox shows recipient, channel, template, payload, and status.

---

## WP-16 — Support capability

**P1 · missing application boundary · Contexts:** Support · **Depends on: WP-06, WP-14**

**Why (G-16).** No support table, service, or route exists. `REFUND_PENDING`/`REFUNDED` and `PaymentPort.refund()` anticipate the outcome; nothing connects a case to them.

**Scope.** Customer creates and reads own cases; operator queue, respond, resolve; order linkage; resolution may trigger a refund **through WP-14's single path**, never a parallel one; audit.

**Permissions enumerate explicitly** — `support:read`/`support:write` (customer, `SELF`); `support:read/respond/resolve` (operator). **`refund:issue` is deliberately excluded from the default support role**; a support operator who can never refund needs a defined escalation path, and **that remains an open product decision this package must not invent**.

**Acceptance.** A customer can open and track a case; an operator can resolve it with full order and ledger context; refunds traverse the single refund path; no wildcard permission appears.
