# Implementation Work Packages — Index

> Phase 12 of `docs/program/MASTER-PROMPT.md`. **This phase designs the implementation program; it does not implement.** Every package derives from a source-verified finding in `docs/program/gap-register.md` and `verified-defect-register.md`.
>
> **Do not begin WP-01 without explicit approval.** The autonomous loop stops here by design — this document is the implementation order for the remainder of the project, and it should be reviewed before momentum sets it.

## Governing rules for implementation agents

1. **Enumerate the behavioural source of truth, not the registry.** Phase 11's lesson, made binding: `EVENT_TYPES` is a decorative 24-member constant table referenced nowhere functionally; the behaviour is **7 raw-string emission sites**. Any package whose scope concerns a closed set must enumerate the set that *runs*, not the one that *declares*.
2. **Design targets are not code.** The Phase 7 permission vocabulary exists in no source file. Enforcement is role-string equality over `ops | finance | admin`. A package may not assume a permission exists because a document names it.
3. **No controller-layer symptom patches.** If a fix can be made at the controller and the root cause is in the domain, the package is wrong.
4. **No package splits one invariant across owners.** Money, state transitions, sandbox context, and authorization each have exactly one owning package per tranche.
5. **Withdrawn defects stay withdrawn.** G-32 (provider health has no screen) and G-40 (transition/reprice post ledger entries) were disproven against source. No package may resurrect them.

## Deployment status — determines WP-01 urgency

**No deployment evidence exists in the repository.** `platform/docker-compose.yml` defines only infrastructure (Postgres, Redis, RabbitMQ, MinIO, OTel — **no app service**); there are no CI workflows, no deploy scripts, and no hosting configuration. The API appears to run only locally via `pnpm dev`.

**Therefore WP-01 is the first implementation item, not an emergency hotfix.** This inference is from repository evidence and cannot prove nobody deployed manually — **if the API is reachable from anywhere beyond a developer machine, WP-01's containment step becomes an immediate security hotfix ahead of everything else.** That is a question for the product owner, not something the repo can answer.

## Tranche structure

| Tranche | Theme | Packages | Gate |
|---|---|---|---|
| **0** | Immediate containment | WP-01 | — |
| **1** | Integrity foundations | WP-02 … WP-06 | **mandatory before any public/staging exposure** |
| **2** | Operational foundations | WP-07 … WP-10 | |
| **3** | Broken MVP journeys | WP-11 … WP-16 | |
| **4** | Experience convergence | WP-17 … WP-22 | |
| **5** | External adapters / hardening | WP-23 … WP-25 | EXTERNAL-GATE |

## Package list

### Tranche 0 — containment

| ID | Title | Owns |
|---|---|---|
| **WP-01** | Sandbox fail-closed containment | G-01, G-02 (interim auth), G-03 (containment) |

### Tranche 1 — integrity foundations

| ID | Title | Owns | Depends on |
|---|---|---|---|
| **WP-02** | Payment settlement boundary | G-03 (structural), G-04, G-23, G-49 | WP-01 |
| **WP-03** | Server-authoritative sandbox provenance | G-05 | WP-01 |
| **WP-04** | Order lifecycle integrity | G-07, G-08, G-09, dead-end audit | — |
| **WP-05** | Event delivery semantics | G-11, G-28 | — |
| **WP-06** | Authorization foundation | G-13, G-18 | — |

### Tranche 2 — operational foundations

| ID | Title | Owns | Depends on |
|---|---|---|---|
| **WP-07** | Sandbox financial isolation | G-06, G-22 | **WP-03** |
| **WP-08** | Operational query correctness | G-46, G-47, G-52 | — |
| **WP-09** | Finance & ledger query foundation | G-48, G-31 | WP-06, WP-07 |
| **WP-10** | Backoffice workspace read models | G-51 | WP-06, WP-08 |

### Tranche 3 — broken MVP journeys

| ID | Title | Owns | Depends on |
|---|---|---|---|
| **WP-11** | Manual product resolution — end-to-end operator recovery | G-10, G-12 | **WP-04**, WP-06, WP-10 |
| **WP-12** | Exception operations | G-17, G-50 | **WP-08**, WP-06, WP-10 |
| **WP-13** | Customer exception decisions | G-14 | **WP-04**, WP-19 |
| **WP-14** | Refund capability | G-25(refund), G-27 | **WP-04**, WP-02, WP-06 |
| **WP-15** | Notification delivery | G-25(notif) | **WP-05** |
| **WP-16** | Support capability | G-16 | WP-06, WP-14 |

### Tranche 4 — experience convergence

| ID | Title | Owns | Depends on |
|---|---|---|---|
| **WP-17** | Design tokens & money presentation | G-33, G-34 | — |
| **WP-18** | State presentation totality | G-19, G-20 | WP-04 |
| **WP-19** | Available-actions API | G-39 | WP-04, WP-06 |
| **WP-20** | Admin Vite migration | superseding decision | WP-10, WP-17 |
| **WP-21** | Front-office journey slices | G-26, C1–C28 | WP-17, WP-18, WP-19 |
| **WP-22** | Sandbox executable parity | **G-21** | WP-03, WP-07, WP-20 |

### Tranche 5 — external adapters

| ID | Title | Owns | Depends on |
|---|---|---|---|
| **WP-23** | Marketplace resolution adapters | G-12(real), G-35, G-36 | WP-11 |
| **WP-24** | Real payment gateway | EXTERNAL-GATE | WP-02 |
| **WP-25** | Reconciliation | G-24 | WP-09, WP-05 |

**25 packages.**

## Ordering constraints that are correctness-critical

Four orderings, if reversed, produce a **worse** outcome than not doing the work:

| Constraint | Consequence of reversing |
|---|---|
| **WP-03 before WP-07** | Expanding exclusion while the sandbox tag is client-settable turns a data leak into a **concealment channel** — a customer could hide a real order from operator search and financial reports |
| **WP-08 before WP-12** | The exception cursor is `lt(id)` while the sort is `desc(rank)`; it is correct *only because ranks are uniform*. Implementing ranking first **silently corrupts queue pagination** |
| **WP-04 before WP-11** | A review workflow on a lifecycle whose rejection branch has no terminal state produces a queue that fills and never drains |
| **WP-05 before WP-15** | Notification guarantees built on at-most-once delivery drop messages under handler failure |

## Not scheduled

**Lines B and C** (organization membership, org-scoped permissions, merchant pricing modes, wallet/deposit, enterprise approvals) are **platform-later**. WP-06 preserves the `PLATFORM` / `ORGANIZATION` scope seam per ADR-001 so they remain additive, but no package implements them and **no Line-A package may carry speculative B2B UI**.

---

## Review record

### Review A — self completeness

Verified programmatically that every register ID is owned: set difference between `gap-register.md` and `defect-to-work-package-map.md` is **empty (52/52)**. Found three Line B/C gaps covered only by a range (`G-41…G-45`) and made them explicit so the check is machine-verifiable rather than visual.

**Found no contradictions** — consistent with every phase since 5.

### Review B — independent adversarial planning review

Broke the plan in fourteen places. All verified against source; **none rejected**.

| # | Finding | Resolution |
|---|---|---|
| **1** | **WP-14 — a P0 on the critical path — owned no gap-register ID.** README gave it G-25 and G-27; the map assigns those to WP-15 and WP-04/WP-21 | New ID **G-14a** (refund execution) assigned to WP-14 |
| **2** | **Refund eligibility split verbatim across WP-04 and WP-14**, violating this program's own rule that one invariant has one owner — and WP-04 is domain-only, so it *cannot* satisfy a predicate needing payment state | **WP-04 defines the interface and guard points; WP-14 implements it.** WP-04's acceptance is now topological, not financial |
| **3** | **WP-14 had no sandbox dependency** while posting ledger entries and shipping sandbox `REF-01`. `ledgerEntries` has no sandbox column, so a sandbox refund moves production balances | **WP-03 + WP-07 added as hard prerequisites** |
| **4** | **WP-02 widens G-06 before WP-07 fixes it** — routing sandbox settlement through production `settlePayment` posts double-entry lines into an untagged ledger. Same shape as the WP-03→WP-07 hazard | Recorded in WP-02's risk section with two explicit mitigations; **must be chosen, not defaulted** |
| **5** | **Wave 1 violated the plan's own never-parallel rule twice** — WP-01 edits the guard file WP-06 replaces; WP-04's context range covers WP-05's emission sites in `worker/main.ts` | WP-01 moved to its own wave; WP-05 moved to Wave 2 |
| **6** | **`packages/core/src/money.ts` named as "where the 10× error lives."** It divides by a generic minor-unit exponent — a different operation. The toman conversion is duplicated in **both** clients | Ownership moved to `web/lib/api.ts` + `admin/lib/api.ts`. **The named file was the one place the bug isn't** |
| **7** | **`CARRIER_STATUS_MAP` is not state-keyed** — it is `Record<string, OrderState>`, keyed by carrier strings | "Six state-keyed maps" corrected to **four**; totality does not apply to it |
| **8** | **"13 hardcoded px font sizes"** is the distinct-value count; there are **26 declarations** | Corrected — the migration is roughly twice the stated size |
| **9** | **"132 tests"** — there are **120 `it(`/`test(` sites**; 132 is the executed-case count after `it.each` | Corrected in WP-01's acceptance |
| **10** | **G-19 counted as P1** to reach "21 P1 = 33 owned," against the register's own explicit demotion to P2 | Corrected to **20 P1 / 32 total**. The completeness claim now rests on the empty set difference, not the arithmetic |
| **11** | **Critical path contradicted its own graph** — WP-22 on the path while its prerequisites WP-07/WP-17/WP-20 were listed off it | Split into a **9-package correctness path** and a **13-package demonstrability path**, with a recommendation to state which one a schedule quotes |
| **12** | **WP-21 claimed "owns C1–C28"** — the entire customer journey, overlapping WP-02, WP-13 and WP-14 | Narrowed to G-26 and the customer surface of G-27 |
| **13** | **WP-13 scoped as "an endpoint exercising existing legal transitions"** — implementable entirely at the controller, the exact symptom-patch this program forbids | Rescoped as an application command; the route is a thin adapter. **WP-06 added as a prerequisite** (two documents disagreed) |
| **14** | **Ownership nominal for G-15, G-29, G-30, G-37, G-38** — assigned but absent from the owner's scope text | Flagged: **each owner must add an explicit scope line before that package is READY** |

**Also corrected:** fan-out counts conflated direct with transitive dependents; `apps/admin/lib/api.ts` (four packages) and `apps/web/lib/order-display.ts` (two) had no owner in the contention table; WP-17 split into **17a** (Wave 1) and **17b** (contract rename, scheduled slot) because the rename collides with the plan's own additive-only rule for Tranches 1–2.

**The failure mode this phase exhibited:** the program was internally inconsistent in ways no single document revealed — README, dependency graph, critical path, and package docs each said something slightly different about the same package. **A plan is a closed set too**, and it needed the same cross-checking the code did.
