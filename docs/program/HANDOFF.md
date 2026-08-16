# Handoff — Cross-Border Assisted Commerce Platform Convergence Program

> Written 2026-08-16, mid-Phase-11. Supersedes the older root `handoff.md` for program state; that file remains useful for the original pre-program baseline.
>
> **Read this first, then `PROJECT-STATE.md`.** This document says where things stand and what to distrust; `PROJECT-STATE.md` is the durable record.

## 1. Status in one paragraph

Phases 0–10 are complete and committed. **Phase 11 (traceability) is in progress and uncommitted** — all four artifacts are written and staged but not committed, and two of its acceptance gates are unmet. No production code has been changed by this program at any point: it has produced architecture, design, and verified defect analysis only. The platform's tests pass (132) and typecheck cleanly (16/16 packages), which is a regression baseline and nothing more.

## 2. Exact state of the working tree

**Staged, uncommitted** (all Phase 11):

| File | Size | State |
|---|---|---|
| `docs/program/journey-capability-traceability.md` | 22.8 KB | complete |
| `docs/program/gap-register.md` | 6.7 KB | complete — 45 gaps, G-01…G-45 |
| `docs/program/dependency-graph.md` | 4.0 KB | complete — five chains |
| `docs/program/test-coverage-map.md` | 4.1 KB | complete |

**Phase 11 is now complete and both gates are closed** — the Phase 6 audit ran on its third attempt, and the cross-phase review ran. Both sets of findings are integrated. `PROJECT-STATE.md` is updated.

**Remaining blocker for Phase 12:** Phase 9 executable sandbox parity (**G-21**) — `apps/admin` can filter sandbox rows but cannot enter a sandbox session, so no operator journey runs in one. Phase 12 must plan this rather than assume it.

## 3. Two gates that block Phase 12

Both are explicit in the phase briefs and neither is satisfied. **Phase 12 should not begin until they are.**

### Gate 1 — Phase 6 audit — **CLOSED**

Ran on the third attempt. Found six defects no later phase had caught, including one that changes sequencing: **G-47**, the exception queue's cursor (`lt(id)`) is inconsistent with its sort (`desc(rank), desc(id)`) and is correct *only because ranks are currently uniform* — so fixing G-17 (ranking) first would silently corrupt queue pagination. It also disproved a claim repeated three times in Phase 6 and once in Phase 11: provider health **does** have a screen.

### Gate 2 — Phase 9 executable sandbox parity — **STILL OPEN**

`apps/admin` has a "Demo orders" **filter** (`app/orders/page.tsx:71-125,298-306`) but **never sends `X-Sandbox-Session`** (`lib/api.ts`, 0 references), so it cannot create or enter a sandbox session. No operator journey can execute in one — the "one integrated environment" requirement is unmet. Recorded as **G-21**.

## 4. What a successor should distrust

This is the most useful section. The program's recurring failure mode has changed shape three times, and each shape produced defects that survived until an adversarial pass.

| Phase | Failure mode | Example |
|---|---|---|
| 5–8 | **Design contradictions** — self-review certified checks as passing that its own artifacts falsified | A `support:*` wildcard would have granted operator commands to every customer |
| 9 | **Unverified assertions** — confident claims about code never opened | "Customs is folded into the carrier port" (false); "`NotificationPort` has no consumer" (false) |
| 10 | **Verified but under-searched** — file opened, first instance confirmed, set never enumerated | Missed a second pre-payment refund path *while analysing the state machine*; described worker sandbox context as travelling in the event envelope when it is an order-row lookup |
| 11 | **Enumerated the wrong set** — the rule was applied, to the wrong collection | §5 enumerated the 24-member event *constant* table instead of the 7 actual *emission sites*, producing three errors at once. Also asserted "`apps/admin` has zero sandbox references" across four documents when a Demo-orders filter exists |

**Phase 11 exists partly to counter the third, and partly succeeded.** The enumeration rule found G-19, G-46, G-47 and the `REFUND_PENDING` dead end. **It also violated itself** — see row 11. Enumerating *a* set is not the same as enumerating *the right* set.

**Practical advice:** when a claim concerns a closed set, enumerate it programmatically. Several of this program's worst errors came from `grep` finding one match and reasoning stopping there.

## 5. The findings that matter most

Full detail in `gap-register.md`; these are the ones that would change what you build first.

**Security / financial (P0):**
- **G-05 — live concealment channel.** A customer can set `x-sandbox-session` on order creation and their real order vanishes from operator search, because exclusion already defaults on (`repositories.ts:249`, `schemas.ts:323`) while the client controls the tag. **Exploitable today.** This is the single most urgent item.
- **G-06 — sandbox money moves production balances.** 1 of 21 tables carries a sandbox tag; `balance()` sums `ledgerEntries` unfiltered and cannot filter.
- **G-03/G-04 — settlement.** Three settlement routes exist. The *verified* webhook is unreachable (no `@Public()` despite a docstring claiming it), while the *unverified* sandbox route is open and not production-gated. In production the only working settlement path is unauthenticated.
- **G-11 — the event backbone is at-most-once** while documented at-least-once. `once()` marks an event processed before running the handler, so a throwing handler permanently suppresses redelivery. Affects all four consumers.

**Domain (P0):**
- **G-07/G-09** — two pre-payment refund paths; `QUOTING` has no exit for failed resolution. The refund lifecycle is *entirely* table-only — nothing anywhere transitions into `REFUND_PENDING`, which means the fixes are additive and cheap **now**.
- **G-12** — in production, `buildStoreStrategies` registers **no** resolution strategies at all.

**New in Phase 11 (found by enumeration):**
- **G-19** — `STATE_TO_STEP_INDEX` covers **12 of 24** states, and `buildCustomerTimeline` falls back to index `-1`. A customer in `REFUND_PENDING`, `PRICE_CHANGED`, or `SHIPMENT_EXCEPTION` sees a timeline where **nothing has happened** — including steps that demonstrably did. Four phases inspected this file and missed it because they read the map's contents rather than checking it against all 24 states.

**Structural (P1):**
- **G-13 — the Phase 7 permission model does not exist in code.** Enforcement is role-string equality against `ops | finance | admin`. Every permission named across Phases 7–10 is a design target. **This gates more work than anything else** (`dependency-graph.md` Chain C), and Phase 12 must not schedule permission-dependent features before the foundation.

## 6. Ordering constraints that are not preferences

Two orderings, if reversed, make things **worse than doing nothing**:

1. **Sandbox exclusion before provenance** converts a data leak into a concealment channel. This is not hypothetical — exclusion is already on, so provenance is the fix and must land first.
2. **Manual-review UI before pre-payment lifecycle** delivers an operator queue that fills and never drains, because a rejected review has no terminal state.

`dependency-graph.md` has the five chains in full.

## 7. Cheap fixes worth pulling forward

Ungated, small, real consequence: **G-03 containment** (an env gate on the sandbox settle route). **Containment ≠ fix**: the structural remedy spans WP-01 and WP-02, **G-12** (register resolution strategies — production currently registers none), **G-19**, **G-20** (raw enum text reaches Persian customers), **G-22** (a sandbox session can send a real SMS), **G-30**, **G-31**, **G-34**, **G-46**, **G-48**, **G-49**.

## 8. How to resume

Phase 11 is complete and committed. **Phase 12 (work-package decomposition) is next**, with three standing constraints:

1. **Respect the six dependency chains.** Two orderings are correctness-critical (§6), and Gate 1 added a third: **G-47 before G-17**.
2. **Do not schedule permission-dependent features before the permission foundation** (G-13). Every operator capability designed in Phases 6–10 names a permission that does not exist in code.
3. **Phase 9 executable sandbox parity (G-21) is still open.** Plan it; do not assume it.

**Expect the Phase 12 adversarial review to find defects.** Every one of the seven that ran did, and two inverted a conclusion.

## 9. Conventions worth preserving

- **Nothing is marked complete because a domain transition or repository method exists.** The status vocabulary (`IMPLEMENTED` / `IMPLEMENTED-BUT-DEFECTIVE` / `PARTIAL` / `ORPHANED` / `DESIGN-TARGET` / `EXTERNAL-GATE` / `MISSING` / `BLOCKED`) exists to prevent that, and "supported" and "mostly done" are banned.
- **Every claim about existing behaviour carries a `file:line`.** Design docs are never cited as evidence that code exists.
- **Corrections are recorded, not quietly dropped.** Each artifact keeps a table of its own disproven claims. A register that silently deletes its errors cannot be audited.
- **Known gaps are encoded as deliberately failing scenarios** in the sandbox catalog, so they are measured rather than remembered.
