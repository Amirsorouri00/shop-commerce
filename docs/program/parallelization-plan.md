# Parallelization Plan

> Phase 12 §30. Which packages may run concurrently, and which files must have a single owner.

## High-contention files — single owner at a time

Concurrent edits here produce merge conflicts that are **semantically dangerous**, not merely textual:

| File | Owner | Why |
|---|---|---|
| `apps/api/src/domain/order-state-machine.ts` | **WP-04** | The transition table plus **four** state-keyed maps (`TERMINAL_STATES`, `EXCEPTION_STATES`, `STATE_TO_STEP_INDEX`, `ALERTS`). Two agents editing it can produce a topology neither intended. `CARRIER_STATUS_MAP` lives here too but is keyed by carrier strings, not state |
| `apps/api/src/composition/adapters.ts` | **WP-02**, then **WP-07** | The composition root binds every port. Serialize |
| `apps/api/src/common/http.ts` | **WP-06** | The authorization guard. A second editor risks silently widening access |
| `packages/contracts/src/schemas.ts` | coordinated | Touched by many packages. **Additive-only** during Tranche 1–2; no field renames without a scheduled slot |
| `apps/web/lib/api.ts` **and** `apps/admin/lib/api.ts` | **WP-17** | **CORRECTED — this is where the 10× risk actually lives.** The toman conversion is duplicated in *both* clients (`web/lib/api.ts:356`, `admin/lib/api.ts:190`). `packages/core/src/money.ts:214` divides by a generic minor-unit exponent, which is a different operation — an earlier draft named it as the owner, which is the one place the bug is not |
| `apps/admin/lib/api.ts` | **WP-17 → WP-20 → WP-22** (serial) | Touched by four packages: WP-08 (`:120-124` cursor), WP-17 (`:190` money), WP-20 (migration), WP-22 (session header). **Serialize; never parallel** |
| `apps/web/lib/order-display.ts` | **WP-18** | `STATE_BADGES`. WP-04 must **not** edit it — see the boundary note below |
| `apps/api/src/composition/sandbox-routing.ts` | **WP-03** | Trust boundary |
| `apps/worker/src/main.ts` | **WP-05** | Event semantics |

## Canonical execution schedule

**This is the only schedule.** Historical corrections live in the Phase 12 review record, not here — an execution artifact that carries its own revision history invites an implementer to follow the wrong line.

| Wave | Packages | Prerequisites satisfied by |
|---|---|---|
| **0** | `WP-01` **alone** | — |
| **1** | `WP-04` ∥ `WP-06` ∥ `WP-08` ∥ `WP-17a` | — (all four are ungated) |
| **2** | `WP-02` ∥ `WP-03` ∥ `WP-05` | WP-01 (for 02, 03) |
| **3** | `WP-07` ∥ `WP-10` ∥ `WP-18` ∥ `WP-19` | WP-03 (07) · WP-06+WP-08 (10) · WP-04 (18, 19) |
| **4** | `WP-09` ∥ `WP-11` ∥ `WP-12` ∥ `WP-15` | WP-06+WP-07 (09) · WP-04+WP-06+WP-10 (11) · WP-08+WP-06+WP-10 (12) · WP-05 (15) |
| **5** | `WP-13` ∥ `WP-14` | WP-19 (13) · WP-03+WP-07 (14) |
| **6** | `WP-16` ∥ `WP-20` ∥ `WP-17b` | WP-14 (16) · WP-10+WP-17a (20) · Tranche 2 complete (17b) |
| **7** | `WP-21` ∥ `WP-22` | WP-17a+WP-18+WP-19 (21) · WP-03+WP-07+WP-20 (22) |
| **8** | `WP-23` ∥ `WP-24` ∥ `WP-25` | WP-11 (23) · WP-02 (24) · WP-09+WP-05 (25) |

**WP-01 runs alone** because its interim authentication edits `apps/api/src/common/http.ts`, the guard file WP-06 replaces.

**WP-05 is in Wave 2, not Wave 1**, because WP-04's context range (`apps/worker/src/main.ts:150-200,310-345`) covers WP-05's emission sites (`:179`, `:344`).

**WP-14 is in Wave 5, not Wave 4**, because it posts ledger entries and ships sandbox `REF-01`, so it requires WP-07's ledger tagging.

**Coupling note for Wave 2:** WP-02 routes sandbox settlement through the production settlement path, which posts into an untagged ledger until WP-07 lands in Wave 3. Either keep sandbox settlement disabled between Wave 2 and Wave 3, or schedule WP-07 immediately after WP-02. **This is a decision, not a default.**

## Never parallel

| Pair | Reason |
|---|---|
| WP-04 ∥ WP-18 | Both touch state-keyed maps. WP-04 owns the topology; WP-18 the presentation totality — **serialize** |
| **WP-04 ∥ WP-05** | WP-04's context range covers WP-05's emission sites in `worker/main.ts` |
| **WP-01 ∥ WP-06** | WP-01 edits the guard file WP-06 is replacing |
| **WP-17 ∥ WP-20 ∥ WP-22** | All three edit `apps/admin/lib/api.ts` |
| WP-03 ∥ WP-07 | Hard ordering; also both touch sandbox tagging |
| WP-08 ∥ WP-12 | Hard ordering; both touch the exception repository |
| WP-02 ∥ WP-07 | Both edit the composition root |
| WP-06 ∥ anything touching route decorators | The guard is being replaced beneath them |

## Bookkeeping during parallel execution

**Implementation branches must not update shared program-state documents.** `PROJECT-STATE.md`, `gap-register.md`, `journey-capability-traceability.md`, `defect-to-work-package-map.md` and any Graphify artifact are touched by every package and would otherwise become guaranteed merge conflicts — artificial ones, since the packages themselves are genuinely independent.

Instead: **each package records its required state changes in a completion artifact**, `docs/program/work-packages/completions/WP-NN-completion.md`, covering gaps closed or newly found, traceability rows changed, status transitions, and any decision made in-flight. After a wave's branches land, **one integration-state reconciliation** applies them all.

**The code packages are parallelizable; the bookkeeping does not need to be.**

## Branch strategy

One branch per package, named `wp-NN-<slug>`. **Rebase onto main before merge, never merge main into the branch** — a stale composition root or transition table is exactly the kind of conflict that resolves cleanly and behaves wrongly.

**Tranche 1 packages should land in dependency order even when developed in parallel**, because their integration risk is concentrated in shared files rather than in their own logic.

## Context budget

Each package's document carries a **context contract** naming the minimum source set. Implementation agents should read that set, not the repository. Graphify narrows discovery; it does not replace reading the load-bearing implementation — Phase 10 established that opening the file is necessary, and Phase 11 that it must be the *right* file.
