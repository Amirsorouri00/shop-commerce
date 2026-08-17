# Critical Path

> Phase 12. The shortest dependency path from today to: **"a customer can complete the entire Line A journey in sandbox, and an operator can manage every expected exception safely."**

## The path

```
WP-01  sandbox containment            ─┐
WP-03  sandbox provenance             ─┤ security preconditions
WP-02  payment settlement boundary    ─┘
   ↓
WP-04  order lifecycle integrity        ← domain correctness; gates 4 packages
   ↓
WP-06  authorization foundation         ← gates 8 packages; longest single chain
   ↓
WP-10  backoffice workspace read models
   ↓
WP-11  manual product resolution        ← the last MISSING step in the customer journey
   ↓
WP-13  customer exception decisions
   ↓
WP-14  refund capability                ← closes the only reachable dead end
       (also requires WP-03 + WP-07 — see dependency graph)
   ↓
WP-22  sandbox executable parity        ← the acceptance criterion itself
```

**Nine packages** on the correctness path of twenty-five; **thirteen** on the demonstrability path — see the reconciliation below.

## Why each is on it

| Package | Why it cannot be deferred |
|---|---|
| WP-01/02/03 | The journey runs on money-moving paths that are currently unauthenticated and client-trustable. Demonstrating a journey over them would be demonstrating the vulnerability |
| **WP-04** | Two customer journey steps (C18 price-change, C25 refund) and the whole review workflow sit on a topology with unpaid-refund paths and a wedge. Building on it produces orders that cannot be closed |
| **WP-06** | Every operator capability in Tranche 3 names a permission that does not exist. Without it, "an operator can manage exceptions safely" is unverifiable — there is no *safely* |
| WP-10 | The operator half needs read models, or the workspace becomes N+1 page-per-resource — the regression Phase 8 exists to prevent |
| **WP-11** | `NEEDS_REVIEW` is the one customer-journey step with **no exit at all**. A journey that can enter a state nothing leaves is not complete |
| WP-13 | Three `actionable: true` states have no customer API. "Manage every expected exception" fails without them |
| **WP-14** | An operator can enter `REFUND_PENDING` today and **nothing can leave it**. Until refund executes, the safe-management claim is false |
| **WP-22** | The goal names sandbox execution. This package's acceptance criterion *is* the goal statement |

## Contradiction found in review, and resolved

An earlier version placed **WP-22 on the critical path while listing WP-07, WP-17 and WP-20 — its own prerequisites — as off it.** That cannot both be true. The resolution is to be explicit about *which* goal is being measured:

- **Goal as literally stated** ("a customer completes the journey in sandbox and an operator manages exceptions safely") requires WP-22, and therefore transitively requires **WP-07, WP-17a and WP-20** as well. Under this reading the critical path is **13 packages**, not 9.
- **Goal as functional correctness** — the journey works and exceptions are handled safely, verified by integration and API tests rather than an executable admin sandbox session — stops at WP-14 and is **9 packages**.

**Recommendation: treat the 9-package path as the correctness milestone and the 13-package path as the demonstrability milestone**, and say which one a schedule is quoting. Conflating them is how WP-20 (an admin framework migration) ends up on a security-and-correctness critical path.

## Not on either path

WP-05 gates only notifications (WP-15), which the journey can complete without — **though if a demo depends on a customer being notified of a price change, it moves onto both**. WP-08 and WP-12 improve operator throughput without blocking correctness. WP-18/19/21 are experience quality. WP-23–25 are external gates.

**WP-05 is a judgement call worth flagging:** it is off the critical path only if the sandbox journey tolerates dropped notifications. If a demo depends on a customer being *notified* of a price change, it moves onto the path.

## Longest chain

**WP-06 → WP-10 → WP-11** is the longest serial run and the likeliest schedule risk. WP-06 touches every protected route, and its migration gate is a mechanical route × role diff that **cannot be generated from code today** — route enumerability is part of the package.

## Compression opportunities

- **WP-04 and WP-06 are independent** and can run in parallel from the start — the two biggest foundations, neither blocking the other.
- **WP-01 unblocks WP-02 and WP-03 immediately**; those two are then parallel.
- **WP-17 and WP-18** can run any time after WP-04 and are off-path.

**Minimum serial depth: 6 stages** (WP-01 → {02,03} → 04/06 → 10 → 11 → 13/14 → 22).
