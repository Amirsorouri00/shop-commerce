# /goal — WP-06 Authorization foundation

Work in `~/Desktop/shop-wp06` (branch `feature/wp-06`). Run `pnpm install` in `platform/` first.

WP-06 is fully implemented and verified per `docs/program/work-packages/WP-06-authorization-foundation.md`.

**This package has the largest blast radius in the program — it touches every protected route. Migration safety matters more than speed.**

## Before changing code

1. Read the WP-06 document, then `docs/architecture/authorization-model.md`, `authorization-capability-matrix.md`, and `docs/adr/ADR-001-internal-ops-is-not-an-organization.md`.
2. Read `apps/api/src/common/http.ts` in full — the guard is the thing being replaced.
3. **Enumerate the behavioural set, not the declared one.** Phase 11's lesson: a registry is not behaviour. Derive from source: **every route in the API and its effective role requirement** (remember `getAllAndOverride` means a method decorator *replaces* a class one, it does not intersect); every `@Roles` and `@Public` site; and **the actual role values present in the database**, because `operators.role` is unvalidated free text and the three-value DTO cast is not a constraint.

## What you own

Permission/role/grant persistence; a permission evaluator; `PLATFORM` / `ORGANIZATION` scope per ADR-001; role compositions as data; `@RequirePermission` alongside `@Roles`; resource-scoped checks at the application layer; `GET /v1/me/permissions`. **Finance gains `order:read` + `customer:read` at `PLATFORM` with no command permission** — that is the point of the package.

## Migration — the part that must not go wrong

Five steps: introduce the decorator changing nothing → define compositions mapping today's three role strings exactly → **dual-run and diff (route × role → allow/deny)** → cut over per module, admin last → remove `@Roles`.

Two honest caveats to solve, not assume away: the route→requirement table **cannot be generated from code today** (route enumerability is part of this package), and the actual role population must be read from the **database**, not inferred. **The finance widening is intentional and must appear in the diff as a deliberate change**, not be lost among mechanical equivalences.

## What you must not do

- **No wildcards** in any composition. A `support:*` would have granted operator commands to customers.
- **`admin` is not a superset.** Combined duties are two grants.
- **Do not build organization/membership tables** — Line B. Build the *scope mechanism*, not the tenant.
- **Do not weaken WP-01's sandbox containment.** `SandboxController` currently carries `@Roles('ops','finance','admin')` as a deliberate interim; replace it with `sandbox:control:*` only if you complete the scoping, and never leave it unprotected in between.
- **Do not edit `sandbox.module.ts` beyond that decorator**, and do not touch `commerce.module.ts`'s sandbox gate.

## Tests

Authorization matrix, **enumerated route × role**. Finance can read an order and cannot transition or reprice one. No composition contains a wildcard. An unrecognized role is an **explicit deny**, never a lookup miss. Scope: an `ORGANIZATION` grant cannot read another organization's data.

Run full `vitest` and `turbo typecheck`. Baseline: **165 tests / 8 files, 16/16**.

## Reviews

Self-review, then adversarial review hunting: any route whose effective permission changed unintentionally; a wildcard; a privilege escalation path; a stale-role window; ADR-001 violated by reintroducing an internal-ops tenant; sandbox containment weakened.

## Bookkeeping

**Do not edit shared program-state documents.** Record changes in `docs/program/work-packages/completions/WP-06-completion.md`.

Commit once, descriptively, and stop.
