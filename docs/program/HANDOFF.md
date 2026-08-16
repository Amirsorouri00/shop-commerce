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

**Not yet done for Phase 11:**
- `PROJECT-STATE.md` has **not** been updated for Phase 11.
- The cross-phase adversarial review (Phase 11 §33) has **not** run.
- The Phase 6 audit (§31) was launched and **cancelled** before reporting.

**Last commit:** `4a20aaa` — Phase 10.

## 3. Two gates that block Phase 12

Both are explicit in the phase briefs and neither is satisfied. **Phase 12 should not begin until they are.**

### Gate 1 — Phase 6 independent adversarial audit (outstanding since Phase 6)

Commissioned in Phase 6, hit a session usage limit, carried through Phases 7–10, relaunched in Phase 11, cancelled before reporting. **Phase 6's backoffice artifacts are the only ones in the program never independently reviewed.**

Every other phase's adversarial review found defects the self-review missed — including, twice, defects that inverted a conclusion. Phase 6's artifacts are load-bearing for Phase 12's operator work packages, so this is a real risk rather than a formality.

**To run it:** an `Explore` agent with the brief used in Phase 11 — verify F1–F9 against source, hunt enumeration failures, check the "1 of 11 areas complete" framing, and test the claim that all ~39 MASTER-PROMPT backoffice areas are covered or justifiably excluded.

### Gate 2 — Phase 9 executable sandbox parity

`apps/admin` contains **zero** sandbox references. No operator journey can execute in a sandbox session, so the "one integrated environment" requirement is unmet in fact, whatever the architecture says. Recorded as **G-21**.

## 4. What a successor should distrust

This is the most useful section. The program's recurring failure mode has changed shape three times, and each shape produced defects that survived until an adversarial pass.

| Phase | Failure mode | Example |
|---|---|---|
| 5–8 | **Design contradictions** — self-review certified checks as passing that its own artifacts falsified | A `support:*` wildcard would have granted operator commands to every customer |
| 9 | **Unverified assertions** — confident claims about code never opened | "Customs is folded into the carrier port" (false); "`NotificationPort` has no consumer" (false) |
| 10 | **Verified but under-searched** — file opened, first instance confirmed, set never enumerated | Missed a second pre-payment refund path *while analysing the state machine*; described worker sandbox context as travelling in the event envelope when it is an order-row lookup |

**Phase 11 exists partly to counter the third.** Its §2 enumeration rule is why this phase enumerated all 51 transition edges, all 24 event constants, all 3 settlement routes, all 8 adapters, and all 4 state-keyed maps rather than sampling. **That discipline found a defect four phases of review had missed** (G-19, below).

**Practical advice:** when a claim concerns a closed set, enumerate it programmatically. Several of this program's worst errors came from `grep` finding one match and reasoning stopping there.

## 5. The findings that matter most

Full detail in `gap-register.md`; these are the ones that would change what you build first.

**Security / financial (P0):**
- **G-05 — live concealment channel.** A customer can set `x-sandbox-session` on order creation and their real order vanishes from operator search, because exclusion already defaults on (`repositories.ts:249`, `schemas.ts:323`) while the client controls the tag. **Exploitable today.** This is the single most urgent item.
- **G-06 — sandbox money moves production balances.** 1 of 22 tables carries a sandbox tag; `balance()` sums `ledgerEntries` unfiltered and cannot filter.
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

Ungated, small, real consequence: **G-19** (timeline map totality), **G-20** (badge map — raw enum text currently reaches Persian customers), **G-22** (route `sms`/`storage` — a sandbox session can send a real SMS), **G-30**, **G-31**, **G-34**, **G-40**.

## 8. How to resume

1. Run the Phase 6 audit (Gate 1); integrate findings into `gap-register.md` and the traceability artifact.
2. Run the Phase 11 cross-phase adversarial review (§33) against the four staged artifacts. **Expect it to find defects** — every prior one did.
3. Update `PROJECT-STATE.md` for Phase 11.
4. Commit Phase 11.
5. Only then begin Phase 12 work-package decomposition.

If limits prevent 1 or 2, **Phase 11 stays PROVISIONALLY COMPLETE and Phase 12 stays blocked** — that is the brief's own rule, and given how much every adversarial pass has found, it is the right one.

## 9. Conventions worth preserving

- **Nothing is marked complete because a domain transition or repository method exists.** The status vocabulary (`IMPLEMENTED` / `IMPLEMENTED-BUT-DEFECTIVE` / `PARTIAL` / `ORPHANED` / `DESIGN-TARGET` / `EXTERNAL-GATE` / `MISSING` / `BLOCKED`) exists to prevent that, and "supported" and "mostly done" are banned.
- **Every claim about existing behaviour carries a `file:line`.** Design docs are never cited as evidence that code exists.
- **Corrections are recorded, not quietly dropped.** Each artifact keeps a table of its own disproven claims. A register that silently deletes its errors cannot be audited.
- **Known gaps are encoded as deliberately failing scenarios** in the sandbox catalog, so they are measured rather than remembered.
