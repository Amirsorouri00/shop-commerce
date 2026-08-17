# /goal — WP-04 Order lifecycle integrity

Work in `~/Desktop/shop-wp04` (branch `feature/wp-04`). Run `pnpm install` in `platform/` first.

WP-04 is fully implemented and verified per `docs/program/work-packages/WP-04-order-lifecycle-integrity.md`.

**This package is domain topology. It is not a payment package, not a UI package, and not a refund package.**

## Before changing code

1. Read the WP-04 document in full, then `docs/architecture/state-machine-reconciliation.md`.
2. Read `apps/api/src/domain/order-state-machine.ts` **in its entirety** — it is the subject of this package.
3. **Enumerate, do not sample.** This package exists because earlier analysis repeatedly reasoned from one representative edge. Derive programmatically from source: every state; every edge (51 today); every inbound edge to `REFUND_PENDING`, `REFUNDED`, and each cancellation state; every state-keyed map; and — separately — **which transitions any code actually performs**, which is a different and smaller set than which edges are legal.

## What you own

Split `OUT_OF_STOCK` (post-payment) from a new `UNAVAILABLE` (pre-payment terminal). Complete the pre-payment lifecycle. Define the `RefundEligibility` **interface and its guard points**. Resolve the three edges that cancel a paid order with no refund. Update the **four** state-keyed maps in `order-state-machine.ts`.

## What you must not do

- **Do not implement `RefundEligibility`.** You are domain-only and cannot inspect payment settlement state. WP-14 implements it and owns the financial invariant. Your acceptance is topological.
- **Do not touch `apps/web/lib/order-display.ts`** — `STATE_BADGES` is WP-18's.
- **Do not add customer or operator commands** — WP-11, WP-13, WP-14, WP-21.
- **Do not edit `apps/worker/src/main.ts`.** Your context contract cites lines there for reading only; WP-05 owns that file in a parallel branch.

## Tests

There is **no `order-state-machine.test.ts`** — create it. Derive the edge set from `TRANSITIONS` at runtime; **never hardcode a count**, since this package changes it. Required: no pre-`PAID` state has any path to `REFUND_PENDING`; no cancellation edge originates from a post-`PAID`-only state without refund resolution; every state has an exit or is explicitly terminal; every state-keyed map is total.

Run: full `npx vitest run`, `npx turbo typecheck`. Baseline to preserve: **165 tests / 8 files, 16/16 packages**.

## Reviews

Self-review for completeness, then an independent adversarial review by a fresh-context agent instructed to find: a missed inbound edge to a refund state; a state left without an exit; a map left partial; any acceptance criterion that silently requires payment state; scope leakage into WP-14 or WP-18.

## Bookkeeping

**Do not edit `PROJECT-STATE.md`, the gap register, traceability, or the defect map.** Record required state changes in `docs/program/work-packages/completions/WP-04-completion.md`. One integration reconciliation follows the wave.

Commit once, descriptively, and stop.
