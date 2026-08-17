# Implementation Dependency Graph

> Phase 12. Derived from `docs/program/dependency-graph.md` (Phase 11) and **re-verified** against the gap register. Where the Phase 11 graph was wrong, the correction is noted.

## Corrections to the Phase 11 graph

Three ordering errors were found in the Phase 11 review and are fixed here:

| Error | Correction |
|---|---|
| G-13 (P1) placed ahead of G-02 (P0) via "C before A's control-plane authz" | **WP-01 carries an interim check** — any authenticated operator — which needs no permission model. Full scoping follows in WP-06. A P0 no longer waits on the longest P1 chain |
| G-03 over-serialized behind G-05 and G-06 | **Containment moves into WP-01** (no dependencies). The *structural* fix stays in WP-02 |
| G-12 over-serialized behind the lifecycle chain | **Moved to WP-23**, and its production consequence is flagged in WP-11 |

## Chains

```
SECURITY
WP-01 ──┬──> WP-02 ──> WP-14, WP-22, WP-24
        │            (WP-02 widens G-06 — pair it with WP-07 or gate sandbox
        │             settlement until WP-07 lands)
        │            WP-14 additionally requires WP-03 + WP-07 (ledger tagging)
        └──> WP-03 ──> WP-07 ──> WP-09, WP-22
                        (WP-03 BEFORE WP-07 — hard)

DOMAIN
WP-04 ──> WP-11, WP-13, WP-14, WP-18, WP-19
         (WP-04 defines RefundEligibility; WP-14 IMPLEMENTS it — one invariant, one owner)

AUTHORIZATION
WP-06 ──> WP-09, WP-10, WP-11, WP-12, WP-13, WP-14, WP-16, WP-19

EVENTS
WP-05 ──> WP-15, WP-25

QUERY CORRECTNESS
WP-08 ──> WP-12                (WP-08 BEFORE WP-12 — hard)
WP-10 ──> WP-11, WP-12, WP-20

EXPERIENCE
WP-17a ──> WP-20, WP-21        (WP-17b: contract rename, scheduled after Tranche 2)
WP-18 ──> WP-21
WP-19 ──> WP-13, WP-21
WP-20 ──> WP-22
```

## The four hard orderings

Reversing any of these produces a **worse** outcome than not doing the work:

| Order | Consequence of reversal |
|---|---|
| **WP-03 → WP-07** | Exclusion on a client-settable tag turns a leak into a **concealment channel**: a customer hides a real order from operator search *and* financial reports |
| **WP-08 → WP-12** | The exception cursor is `lt(id)` while the sort is `desc(rank)`; correct only while ranks are uniform. Ranking first **silently corrupts pagination** |
| **WP-04 → WP-11** | A review workflow whose rejection branch has no terminal state yields a queue that fills and never drains |
| **WP-05 → WP-15** | Notification guarantees on at-most-once delivery drop messages under handler failure |

## Fan-out

| Package | Directly gates | Note |
|---|---|---|
| **WP-06** | 8 | Largest fan-out; longest chain |
| **WP-04** | 5 | Highest-contention file |
| **WP-03** | 2 direct (WP-07, WP-22) | Closes the live exploit; WP-07 then fans out further |
| WP-01 | 2 direct (WP-02, WP-03) | Cheapest unblock |

*Counts corrected after review — an earlier version conflated direct with transitive dependents.*

## Ungated — startable immediately

WP-01, WP-04, WP-05, WP-06, WP-08, WP-17. **Four of the six are foundations**, which is why the program parallelizes well early and narrows later.
