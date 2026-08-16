# WP-04 — Order lifecycle integrity

**Priority** P0 · **Severity** domain lifecycle + financial · **Capability** order state correctness · **Contexts** Order domain · **Tranche** 1

## Why

The 24-state / **51-edge** graph (enumerated from source) has three verified classes of defect:

**Unpaid refunds — two paths, not one.** `QUOTING → OUT_OF_STOCK → REFUND_PENDING` (`:17`,`:34`) **and** `QUOTED → PRICE_CHANGED → REFUND_PENDING` (`:18`,`:33`). The second survives any `OUT_OF_STOCK` split, so **topology alone cannot close this** — the eligibility predicate is load-bearing.

**Paid orders cancelled with no refund — three edges:** `OUT_OF_STOCK → CANCELLED`, `PRICE_CHANGED → CANCELLED`, `CUSTOMER_ACTION_REQUIRED → CANCELLED` (`:33,34,37`).

**Wedges and dead ends.** `QUOTING: ['QUOTED','OUT_OF_STOCK']` — no exit for failed or abandoned resolution, no edge to `CANCELLED`. And the sharpest: an operator can enter `REFUND_PENDING` via the generic transition endpoint while **nothing anywhere performs `→ REFUNDED`** — entry reachable, exit not.

**Root cause of the overload:** `OUT_OF_STOCK` serves two lifecycle positions with opposite financial meaning. A state whose correct exit depends on how it was entered is two states.

## Scope

**Included:** split `OUT_OF_STOCK` (post-payment) from a new `UNAVAILABLE` (pre-payment terminal); complete the pre-payment lifecycle (`RESOLUTION_FAILED`, `CANCELLED` from `QUOTING`); **define the `RefundEligibility` interface and its call sites** — resolve the three paid-cancel edges; update the four state-keyed maps; a dedicated state-machine test file.

**Explicitly excluded — corrected after review:** the **implementation** of `RefundEligibility` moves to **WP-14**. An earlier draft gave the same predicate to both packages verbatim, violating this program's own rule that one invariant has one owner. WP-04 is domain-only and cannot see payment state, so it can define the contract and the guard points; only WP-14 can satisfy them. **WP-04's acceptance is therefore topological, not financial.**

**Excluded:** refund *execution* (WP-14); manual review workflow (WP-11); customer decision API (WP-13).

**Deliberately deferred with rationale:** whether `RESOLUTION_REVIEW` belongs on the Order at all. `productRequest.status` already persists `NEEDS_REVIEW|FAILED` (`schemas.ts:154`), so adding order states would duplicate a persisted enum. **Decision: resolution status stays on `ProductRequest`; the Order gains only terminal outcomes it owns.**

## Architecture

**Domain only**, plus the **four** state-keyed maps that live beside the transition table. The migration is **additive in data** (no rows change, because the affected branches are unbuilt) but **not additive in code**: `TERMINAL_STATES` (`:61`), `EXCEPTION_STATES` (`:51`), `STATE_TO_STEP_INDEX` (`:148`), and `ALERTS` (`:213`) must be updated in the same change, or `isTerminal()` returns false for the new terminals and `alertFor()` returns null.

**Two corrections after review.** (a) An earlier draft said "six state-keyed collections" and included `CARRIER_STATUS_MAP` — that map is `Readonly<Record<string, OrderState>>` (`:89`), **keyed by carrier strings, not by state**, so state totality does not apply to it. It still needs review for new states as *targets*, which is a different check. (b) `STATE_BADGES` lives in `apps/web/lib/order-display.ts` — a frontend file this package does not touch. **WP-18 owns it**; WP-04 must land first so WP-18 has the final state set.

## Tests

**A dedicated `order-state-machine.test.ts` does not exist and must be created.** Required:

- **Property test over the full edge set** (51 today; this package changes it — the test must derive the set from `TRANSITIONS`, never hardcode a count): no path reaches `REFUND_PENDING` without a settled payment
- No `CANCELLED` from a paid state without refund resolution
- Every state has an exit or is explicitly terminal
- **Totality**: every state appears in each of the four state-keyed maps, or is explicitly excluded. **The totality test must be written against the state enum, not against a hardcoded count** — an earlier draft specified "all 51 edges," a number this package itself changes
- `PAID → PURCHASED` remains illegal
- Enumerate **all inbound edges** to `REFUND_PENDING`, `REFUNDED`, and cancellation states — not a sample

## Acceptance criteria

1. No **pre-payment** state has a legal path to `REFUND_PENDING` (topological). *The financial guarantee — that no path refunds an unpaid order — is WP-14's acceptance, since the predicate lives there.*
2. No pre-payment failure requires refund semantics.
3. Every non-terminal state has a reachable exit with a producer or a documented operator path.
4. All six state-keyed maps are total.
5. The new test file fails against the current topology and passes after.

## Dependencies

**Prerequisites:** none. **Dependents:** WP-11, WP-13, WP-14, WP-18, WP-19.

## Risk

**Domain-wide.** High-contention file — `order-state-machine.ts` must have a single owner (see `parallelization-plan.md`). Mitigation: refund and review branches are unbuilt, so there is no legacy behaviour to migrate.

## Context contract

Read: `apps/api/src/domain/order-state-machine.ts` (whole file), `apps/worker/src/main.ts:150-200,310-345`, `apps/api/src/modules/commerce.module.ts:339-390`, `docs/architecture/state-machine-reconciliation.md`, `docs/program/journey-capability-traceability.md` §4,§14.
