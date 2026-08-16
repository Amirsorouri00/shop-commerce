# Parallelization Plan

> Phase 12 §30. Which packages may run concurrently, and which files must have a single owner.

## High-contention files — single owner at a time

Concurrent edits here produce merge conflicts that are **semantically dangerous**, not merely textual:

| File | Owner | Why |
|---|---|---|
| `apps/api/src/domain/order-state-machine.ts` | **WP-04** | The transition table plus six state-keyed maps. Two agents editing it can produce a topology neither intended |
| `apps/api/src/composition/adapters.ts` | **WP-02**, then **WP-07** | The composition root binds every port. Serialize |
| `apps/api/src/common/http.ts` | **WP-06** | The authorization guard. A second editor risks silently widening access |
| `packages/contracts/src/schemas.ts` | coordinated | Touched by many packages. **Additive-only** during Tranche 1–2; no field renames without a scheduled slot |
| `apps/web/lib/api.ts` **and** `apps/admin/lib/api.ts` | **WP-17** | **CORRECTED — this is where the 10× risk actually lives.** The toman conversion is duplicated in *both* clients (`web/lib/api.ts:356`, `admin/lib/api.ts:190`). `packages/core/src/money.ts:214` divides by a generic minor-unit exponent, which is a different operation — an earlier draft named it as the owner, which is the one place the bug is not |
| `apps/admin/lib/api.ts` | **WP-17 → WP-20 → WP-22** (serial) | Touched by four packages: WP-08 (`:120-124` cursor), WP-17 (`:190` money), WP-20 (migration), WP-22 (session header). **Serialize; never parallel** |
| `apps/web/lib/order-display.ts` | **WP-18** | `STATE_BADGES`. WP-04 must **not** edit it — see the boundary note below |
| `apps/api/src/composition/sandbox-routing.ts` | **WP-03** | Trust boundary |
| `apps/worker/src/main.ts` | **WP-05** | Event semantics |

## Safe parallel sets

**Wave 1 — start together (no prerequisites):**
`WP-04` · `WP-06` · `WP-08` · `WP-17`

**Two packages removed from Wave 1 after review found the "disjoint file sets" claim false:**

- **WP-01 cannot run beside WP-06.** WP-01's interim authentication removes `@Public()` from `sandbox.module.ts:111` and reads `common/http.ts:220-260` — the guard file WP-06 owns exclusively while replacing it. **WP-01 runs first, alone**, which suits it: it is Tranche 0 containment.
- **WP-04 cannot run beside WP-05.** WP-04's context contract reads `apps/worker/src/main.ts:150-200,310-345`; WP-05's emission sites are `:179` and `:344` — **inside both ranges**, on the file WP-05 owns. **WP-05 moves to Wave 2.**

**WP-04 and WP-06 remain genuinely independent** — the two biggest foundations, and the largest compression opportunity in the program.

**Wave 0 — alone:** `WP-01`.

**Wave 2 — after WP-01:**
`WP-02` ∥ `WP-03` ∥ `WP-05` — file-disjoint (payment ingress / request context / worker).

**Wave 3:**
`WP-07` (needs WP-03) ∥ `WP-09` (needs WP-06+WP-07 — so actually Wave 4) ∥ `WP-10` (needs WP-06+WP-08) ∥ `WP-18` (needs WP-04) ∥ `WP-19` (needs WP-04+WP-06)

**Wave 4 — Tranche 3, mostly parallel:**
`WP-11` ∥ `WP-12` ∥ `WP-14` ∥ `WP-15`. **WP-13 must follow WP-19.** **WP-16 must follow WP-14** (it triggers the refund path).

**Wave 5:** `WP-20` → `WP-21` ∥ `WP-22`. **Wave 6:** `WP-23` ∥ `WP-24` ∥ `WP-25`.

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

## Branch strategy

One branch per package, named `wp-NN-<slug>`. **Rebase onto main before merge, never merge main into the branch** — a stale composition root or transition table is exactly the kind of conflict that resolves cleanly and behaves wrongly.

**Tranche 1 packages should land in dependency order even when developed in parallel**, because their integration risk is concentrated in shared files rather than in their own logic.

## Context budget

Each package's document carries a **context contract** naming the minimum source set. Implementation agents should read that set, not the repository. Graphify narrows discovery; it does not replace reading the load-bearing implementation — Phase 10 established that opening the file is necessary, and Phase 11 that it must be the *right* file.
