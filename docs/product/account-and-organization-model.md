# Account & Organization Model

> ⚠️ **PARTIALLY SUPERSEDED by `docs/adr/ADR-001-internal-ops-is-not-an-organization.md` (Phase 7, accepted 2026-08-15).**
>
> This document recommended modeling internal operations as `Organization(kind=INTERNAL_OPS)` at medium confidence, and explicitly asked Phase 7 to "ratify or reject with an ADR." **Phase 7 rejected it.** Internal operations is now modeled as `PLATFORM` **scope**, not as an Organization; internal operators hold platform-scoped role assignments and have no `Organization` or `OrganizationMembership`. `Organization.kind` carries only `MERCHANT` and `ENTERPRISE`.
>
> The reasoning (see ADR-001): an `Organization` means "a tenant whose data is isolated from other tenants," and internal ops is cross-tenant by definition — Phase 6's finance-operator finding (F1) showed an operator's access problem is about which *capabilities* they hold platform-wide, not which tenant they belong to. Everything else in this document stands, including the `User` / `PersonalAccount` / `Organization` / `OrganizationMembership` separation, the `PLATFORM` vs `ORGANIZATION` role scoping, and the decision to shape the model for Line B/C from the start. **Read every `kind=INTERNAL_OPS` reference below as "platform-scoped grant."**

> Phase 2 of `docs/program/MASTER-PROMPT.md`. This is the identity-side design of `business-lines.md` §D's "central architectural bet": generalize the shared spine now, for Line A only, so Lines B/C become thin layers later rather than a rebuild. Per `docs/program/00-current-state-assessment.md` §0.3.1, today's schema has only `customers`, `identities`, `operators` — this is greenfield design, not refinement.

## Design principle

Per `mvp-vs-platform.md`: **ship only Line A's individual-account shape now, but shape the model so Organization was always the general case, not bolted on later.** Concretely — every account-bearing entity (order, payment, wallet, role assignment) attaches to an **account context** (`PersonalAccount` or `Organization`), never directly to a bare `User`. Line A's MVP simply never populates the `Organization` path. This is the one design choice that makes the "reuse the exact same engine" claim in `business-lines.md` §B true rather than aspirational.

## Entities

### `User` (Identity)
The login identity. One human, one `User`. Authenticates via OTP (individuals, per `technical-blueprint-v1.md` §1.2) or another method for org contexts (email/password or SSO later — not decided, flagged below).
- Today's equivalent: `identities` table (Phase 0 §0.3.1) — generalize, don't replace.
- A `User` can hold **at most one** `PersonalAccount` and be a member of **zero or more** `Organization`s via `OrganizationMembership`. A `User` with no `PersonalAccount` and one `OrganizationMembership` is a pure org user (e.g., an enterprise buyer who never shops personally on the platform) — must be a valid, unremarkable state.

### `PersonalAccount`
The Line-A individual customer account context. One-to-one with a `User` that has one.
- Today's equivalent: `customers` table — this is the direct migration target; today's `customers` row becomes `User` + `PersonalAccount`, split so the identity/auth concern and the customer-profile concern aren't the same row (this split is what lets a `User` later also join an `Organization` without schema surgery).
- Holds: default addresses, saved payment method references (not raw payment data — `Money`/ledger invariants in `CLAUDE.md` still apply), order history pointer, notification preferences.

### `Organization`
The Line B/C account context, and (see note below) the natural home for internal operator "teams" too.
- Fields: `id`, `kind` (`MERCHANT` | `ENTERPRISE` — ~~`INTERNAL_OPS`~~ removed by ADR-001), `name`, `status` (`active` | `suspended` | `pending_review`), `complianceTier`.
- ~~**REJECTED by ADR-001.**~~ The original reasoning is preserved for the record: `kind=INTERNAL_OPS` is a deliberate choice: today's flat `operators` table (Phase 0 §0.3.1) is really "members of one implicit internal organization." Modeling internal ops as an `Organization` with `kind=INTERNAL_OPS` means **one** membership/role mechanism serves I2–I6 (`personas.md`) and P3–P8 (merchant/enterprise) instead of two parallel systems — directly serves Phase 7's RBAC generalization. This is an architectural recommendation for Phase 7 to ratify or reject with an ADR, not a decision this document is authorized to lock in alone (MASTER-PROMPT §5 — implementation follows accepted ADRs, not the reverse).
- **MVP-now (as amended by ADR-001):** the `Organization` schema exists but is **entirely unpopulated** at MVP. Internal operators migrate from `operators` to `User` + `PLATFORM`-scoped role assignments, not to organization rows. `MERCHANT`/`ENTERPRISE` rows are platform-later (Line B/C), per `mvp-vs-platform.md`.

### `OrganizationMembership`
Join entity: `userId`, `organizationId`, `roleId` (see `Role` below), `status` (`active` | `invited` | `suspended` | `removed`), `joinedAt`.
- Multiple memberships per user (a person could theoretically be an internal ops member and separately run a merchant account — edge case, not designed further here, but the model doesn't forbid it, which is the point).
- **Edge case flagged in `personas.md`:** a membership can be revoked while the member's submitted order is still in flight. Design requirement for Phase 10: the order must retain a durable reference to who submitted it (a snapshot/audit reference), independent of the live membership row, so revocation never orphans an in-flight order.

### `CustomerProfile`
Line-A-specific profile data (delivery preferences, KYC-lite fields if the compliance gate ever requires them). For MVP this may simply **be** `PersonalAccount` (no separate table) — called out as a distinct concept in MASTER-PROMPT §PHASE 2's entity list, but Phase 10 should collapse it into `PersonalAccount` unless a concrete field-ownership reason emerges to split them.

### `MerchantProfile` (platform-later, Line B)
Extends `Organization` where `kind=MERCHANT`: wallet balance (see money-model note below), pricing-mode default (`WHOLESALER` | `AGENT`, per `business-lines.md` §B), branding config (logo, tracking-page theme), tier.

### `EnterpriseProfile` (platform-later, Line C)
Extends `Organization` where `kind=ENTERPRISE`: credit terms, deposit/milestone policy, compliance tier, assigned account manager (I5/internal relationship).

### `Role` / `Permission` / `RolePermission`
- `Role` has a `scope`: `PLATFORM` (applies platform-wide, held by internal operators directly with **no organization involved** per ADR-001 — ops, logistics, support, finance, compliance, admin, matching `personas.md` I1–I6) or `ORGANIZATION` (applies within a specific `MERCHANT`/`ENTERPRISE` org — owner, staff, buyer, finance_approver, procurement_operator, matching P5–P8).
- `Permission` is a fine-grained action string (`order.transition`, `refund.issue`, `ledger.view`, `wallet.topup`, ...).
- `RolePermission` is the join table. This is the direct replacement for today's `@Roles('ops','admin')` decorator pattern (Phase 0 §0.3.1) — full design and migration is Phase 7's job; this document only establishes that `Role` is scoped and organization-aware from the start, because that's an identity-model decision, not an authorization-logic one.
- **MVP-now:** enough of this model to stop blocking Line A launch (`mvp-vs-platform.md` item 4) — likely just seeding `PLATFORM`-scope roles for the existing ops/finance/admin set, backed by real `Role`/`Permission` rows instead of a hardcoded string enum. Full `ORGANIZATION`-scope roles ship with Line B.

### `Team` (platform-later, not designed further here)
MASTER-PROMPT §PHASE 2 lists `Team`s. No concrete requirement for one surfaced in the governing docs for Line A/B/C MVP shapes — flagged as a real gap only if Phase 6 (backoffice operating model) finds internal ops needs sub-team structure (e.g., a distinct compliance team vs. procurement team) beyond what `Role` scoping already gives it. Do not build ahead of that evidence.

### Delegated responsibilities (platform-later)
Covers P8 (finance approver)'s approval-before-spend job (`jobs-to-be-done.md`) and any future "act on behalf of" pattern. No `Approval` entity exists today and none is needed for Line A MVP. Flagged for Phase 10 when Line C work begins — do not design it now on speculation.

## What ships in MVP-now vs. platform-later

| Entity | MVP-now (Line A) | Platform-later (Line B/C) |
|---|---|---|
| `User` | Yes — replaces/generalizes `identities` | — |
| `PersonalAccount` | Yes — replaces `customers` | — |
| `Organization` | Schema exists; **unpopulated** (ADR-001 — internal ops uses `PLATFORM` grants, not org rows) | `kind=MERCHANT`/`ENTERPRISE` populated |
| `OrganizationMembership` | Yes, for internal ops only | Yes, for merchant/enterprise org members |
| `CustomerProfile` | Likely merged into `PersonalAccount` — confirm in Phase 10 | — |
| `MerchantProfile` | — | Line B |
| `EnterpriseProfile` | — | Line C |
| `Role`/`Permission`/`RolePermission` | Minimal seed for `PLATFORM` scope (unblocks launch, per Phase 7) | Full `ORGANIZATION`-scope roles, Line B/C |
| `Team` | — | Only if Phase 6 evidence demands it |
| Delegated approval | — | Line C, driven by P8's job |

## Money-model note (cross-reference, not designed here)

`capability-map.md` already flags money model (wallet/escrow/deposit-milestone) as the other high-leverage generalization alongside identity, with no shared-spine path identified yet. `MerchantProfile.walletBalance` and `EnterpriseProfile.depositPolicy` above are placeholders showing *where* that model attaches to the account model — the wallet/escrow abstraction itself is Phase 10's job, not this document's.

## Open question for Phase 7 / an ADR

~~Whether `kind=INTERNAL_OPS` organizations are the right home for internal role scoping (vs. keeping internal ops as a separate, non-`Organization` concept) is a real architectural fork, not a settled decision~~ — **RESOLVED by ADR-001 (Phase 7): internal ops is `PLATFORM` scope, not an Organization.** The medium-confidence recommendation recorded here was rejected on Phase 6 evidence. The reversal cost noted here ("low, since no code depends on either choice yet") held — the decision landed before any schema work, exactly as intended.
