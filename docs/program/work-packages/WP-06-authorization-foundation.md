# WP-06 — Authorization foundation

**Priority** P1 · **Severity** authorization · **Capability** permission model · **Contexts** auth, identity, all protected surfaces · **Tranche** 1

## Why

**G-13.** The Phase 7 permission vocabulary — ~40 permissions across Phases 7–11 — **exists in no source file.** Enforcement is role-string equality (`apps/api/src/common/http.ts:251-256`) against an enum of exactly three values: `ops | finance | admin` (`packages/contracts/src/schemas.ts:90`). Roles are also **unvalidated**: the JWT signs `operator.role` straight from the database (`auth.module.ts:363`); the `as 'ops'|'finance'|'admin'` at `:372` is a response-DTO cast, not a constraint.

**This chain gates more work than any other.** Every operator capability designed in Phases 6–11 names a permission that does not exist.

**G-18, precisely stated:** `finance` **is** permitted at the two finance handlers (method-level `@Roles` wins via `getAllAndOverride`). What it cannot reach is **order and customer** endpoints, which carry only the class-level `ops|admin`. So a finance operator can read a ledger entry and not the order its `refId` points at.

## Scope

**Included:** permission/role/grant persistence; a permission evaluator; `PLATFORM` / `ORGANIZATION` scope enforcement per **ADR-001**; role compositions as data; `@RequirePermission` alongside `@Roles` during migration; resource-scoped checks at the application layer (a route decorator cannot decide scope — it needs the loaded resource); `GET /v1/me/permissions`; **finance gains `order:read` + `customer:read` at `PLATFORM` without any command permission**.

**Excluded:** organization/membership tables (Line B — the *scope* seam is preserved, the tenant is not built); UI capability payloads (WP-19).

## Architecture

**ADR-001 preserved:** internal operators hold `PLATFORM`-scoped grants and are **not** members of an organization. No table or API may reintroduce an `INTERNAL_OPS` tenant.

**No wildcards.** Phase 7 found a `support:*` composition would have granted operator commands to every customer. Compositions enumerate explicitly.

**`admin` is not a superset** — an administrator manages access and configuration; combined duties are two grants, which leaves an audit trail.

## Migration — the part that must not go wrong

Five steps, and the gate is mechanical:

1. Introduce `@RequirePermission` alongside `@Roles`, changing nothing.
2. Define compositions so today's three role strings map **exactly** onto permission sets.
3. **Dual-run and diff.** For every route, the set of `actor.role` values that pass today must equal the set passing under the new grants. **Two honest caveats:** the route→requirement table cannot be generated from code today (route enumerability is part of this package), and the *actual* role population must be read from the database because `operators.role` is unvalidated free text.
4. Cut over per module; admin last.
5. Remove `@Roles` and the string check.

**The finance widening is intentional and must appear in the step-3 diff as a deliberate change**, not be lost among mechanical equivalences.

## Tests

- Authorization matrix: for each route × role, allow/deny — **enumerated**, not sampled
- Finance can read an order; finance **cannot** transition or reprice one
- No composition contains a wildcard
- Unrecognized role → **explicit deny**, never a lookup miss that grants
- Scope: an `ORGANIZATION`-scoped grant cannot read another organization's data
- `admin` cannot issue refunds without an explicit grant

## Acceptance criteria

1. Permissions are data; endpoints require permissions.
2. The step-3 diff shows zero unintended access changes.
3. Finance can complete its investigation without mutation authority.
4. ADR-001 holds: no internal-ops organization.
5. Backend remains authoritative — no frontend check is load-bearing.

## Dependencies

**Prerequisites:** none. **Dependents:** WP-09, WP-10, WP-11, WP-12, WP-13, WP-14, WP-16, WP-19.

## Risk

**Highest blast radius in the program.** Touches every protected route. Mitigations: dual-run diff; per-module cutover; and a stale-role window persists until step 4 (the JWT carries `role`), so shorten access-token TTL during migration.

## Context contract

Read: `apps/api/src/common/http.ts:195-270`, `apps/api/src/modules/auth.module.ts:230-260,355-380`, `apps/api/src/modules/admin.module.ts:436,529-540`, `packages/contracts/src/schemas.ts:85-95`, `docs/architecture/authorization-model.md`, `docs/architecture/authorization-capability-matrix.md`, `docs/adr/ADR-001-internal-ops-is-not-an-organization.md`.
