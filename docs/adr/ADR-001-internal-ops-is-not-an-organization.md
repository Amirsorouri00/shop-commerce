# ADR-001 — Internal operations is a platform scope, not an Organization

- **Status:** Accepted
- **Date:** 2026-08-15
- **Phase:** 7 (authorization architecture)
- **Supersedes:** the open fork recorded in `docs/product/account-and-organization-model.md` (Phase 2), which recommended `Organization(kind=INTERNAL_OPS)` at medium confidence and deferred the decision to Phase 7.
- **Blocks:** any schema implementation of accounts, memberships, roles, or permissions (Phase 10/12).

## Context

Phase 2 designed `User` ↔ `PersonalAccount` (Line A) or `OrganizationMembership` → `Organization` (kind: `MERCHANT` / `ENTERPRISE` / `INTERNAL_OPS`), and flagged as an open architectural fork whether internal operations genuinely belongs under the `Organization` concept. It recommended yes — one membership mechanism, one role mechanism, reused for staff and for future B2B tenants — but recorded medium confidence and explicitly deferred the decision to this phase, before schema work depends on it.

Phase 6 sharpened the question. The finance-operator finding (F1) showed that an operator's access problem is about which *capabilities* they hold across the whole platform — a finance operator must read any customer's order to investigate a ledger reference, which is the opposite of tenant-bounded access.

**F1 does not by itself settle the fork, and an earlier draft of this ADR overstated that it did.** F1 is a *granularity* finding (a flat role string plus `getAllAndOverride`), and Alternative A — `Organization(kind=INTERNAL_OPS)` combined with `PLATFORM`-scoped roles — would fix F1 equally well. What F1 supplies is evidence that internal access is naturally expressed platform-wide rather than tenant-wise; **the decision rests on the semantic argument below, with F1 as corroboration rather than proof.**

## Decision

**Internal operations is modeled as `PLATFORM` scope, not as an `Organization`.**

- `Organization` remains a **tenant boundary**: a merchant or enterprise whose members see that organization's data and no one else's. Introduced with Line B; not populated at MVP.
- Internal operators are `User`s holding **`PLATFORM`-scoped role assignments**. They have no `Organization` and no `OrganizationMembership`.
- **One permission vocabulary and one role-composition mechanism serve both.** Only the *scope* of a grant differs. This preserves the reuse Phase 2 wanted without the semantic collision.

`Organization.kind` therefore drops `INTERNAL_OPS` and carries only `MERCHANT` and `ENTERPRISE`.

## Rationale

**An Organization means "a tenant whose data is isolated from other tenants." Internal ops is cross-tenant by definition.** Modeling staff as a tenant would mean every authorization check and every tenant-scoped query must ask "is this a real tenant, or the special one that sees everything?" That conditional would sit in the hottest, most security-sensitive path in the system, and it is precisely the kind of `if (x === specialCase)` branch the codebase avoids elsewhere — the marketplace registry encodes capabilities as data specifically so that behaviour is a lookup rather than a special case (`packages/commerce/src/marketplace.ts:5-14`).

Three further consequences, in order of how much they'd hurt:

1. **The failure mode is silent and severe.** If `INTERNAL_OPS` were an Organization, tenant-isolation logic would have to *deliberately not apply* to it. A future refactor that correctly tightens tenant scoping — exactly the kind of change a security review would ask for — could silently blind the entire back office, or worse, a mistake in the other direction could expose one merchant's orders to another. Two different concepts sharing one mechanism is what makes that class of bug possible.
2. **It matches how authorization is actually asked.** "Can this operator issue a refund?" is a platform capability question. "Can this merchant's staff member see this order?" is a tenancy question. Different questions deserve different constructs.
3. **It costs little, though not nothing.** The reuse Phase 2 wanted was of the *permission and role* machinery, which is fully preserved. What is not reused is `OrganizationMembership`, which for staff would have been a row whose only purpose was to point at a fictional organization. The genuine cost is two grant paths and a marginally more complex resolver, conceded under Consequences — an earlier draft's "costs almost nothing" understated this.

## Alternatives considered

**A. `Organization(kind=INTERNAL_OPS)`** — Phase 2's recommendation. Rejected for the reasons above. Its genuine benefit (one membership table) is outweighed by permanently overloading "organization" with two incompatible meanings.

**B. A separate `Operator` entity distinct from `User`** — closer to today's implementation, which has separate `customers` and `operators` tables. Rejected: it duplicates identity, and forecloses a person being both a customer and staff (plausible: employees test the product). Phase 2's decision to unify identity under `User` stands.

**C. Defer again** — rejected. The goal for this phase requires resolution before schema work, and Phase 6 produced the evidence needed. Deferring a third time would make it a decision by default.

## Consequences

**Positive.** Tenant isolation for Line B/C can be implemented as an unconditional rule, with no carve-out. Internal authorization is expressed in the same permission vocabulary as tenant authorization. `PersonalAccount`, `Organization`, and platform staff are three clearly distinct things.

**Negative / accepted costs.**
- Two grant paths exist (`PLATFORM`-scoped and `ORGANIZATION`-scoped). The permission *check* must handle both, so the resolver is marginally more complex than a single path. Accepted: the complexity is in one well-tested resolver rather than distributed across every tenant-scoped query.
- Migration from today's `operators` table must map `role: 'ops'|'finance'|'admin'` onto `PLATFORM`-scoped role assignments. Covered in `docs/architecture/authorization-model.md` §migration.

**Neutral.** Nothing about this decision requires Line B to ship sooner or later; the `Organization` construct stays unpopulated at MVP either way.

## Reversal cost

**Low-to-moderate, and front-loaded.** Reversing before schema implementation costs a document rewrite. Reversing after would require migrating platform grants into memberships of a synthetic organization and re-auditing every tenant-scoped query — which is exactly why this ADR is required to land before Phase 10/12 schema work, as the phase goal specifies.

## Open question deliberately left open

Whether an *operational team* construct (e.g. a logistics desk owning a subset of the exception queue) is needed is **not** decided here. Phase 6 finding F5 shows no `logistics` role exists today and that ops/logistics are merged by accident rather than decision. `TEAM` is reserved as a possible third scope in `authorization-model.md` but is not introduced, because no evidence yet shows a permission that a team boundary would grant differently from a platform-scoped role. Introducing it speculatively would be role explosion by another name.
