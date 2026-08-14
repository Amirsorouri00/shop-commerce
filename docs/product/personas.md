# Personas & Actors

> Phase 2 of `docs/program/MASTER-PROMPT.md`. Covers primary, secondary, internal, and edge-case actors across all four business lines (`docs/product/business-lines.md`). Anti-personas are split into `anti-personas.md`. JTBD statements are split into `jobs-to-be-done.md` (this file gives the actor roster and role; that file gives the job framework).

**Grounding:** `technical-blueprint-v1.md` §1.1 already names four base personas (Sara the consumer, an internal ops operator, a Line-B merchant, internal finance/treasury). This document keeps those four, gives them MASTER-PROMPT's fuller treatment, and adds the actors Phase 1's B/C boundary work implies but the blueprint's MVP-scoped table didn't need yet. **Do not assume Customer = User** — see `account-and-organization-model.md` for why a "customer" is sometimes a `PersonalAccount`-holding `User` (Line A) and sometimes not a platform identity at all (a merchant's own end customer, Line B).

---

## Primary users (revenue-generating, line-defining)

### P1 — Individual shopper ("Sara", Line A)
Individual Iranian consumer buying for personal use. Pastes one Amazon UAE link at a time, pays in IRR, tracks to door. Price-sensitive on landed cost, trust-sensitive on "is this really the item I asked for" and "will this really arrive." Named directly in `technical-blueprint-v1.md` §1.1.
**Account shape:** `User` + `PersonalAccount` (Line A, MVP-now).

### P2 — Frequent cross-border shopper (Line A, high-value variant of P1)
Same account shape as P1, but orders repeatedly, cares about saved addresses, order history, and faster repeat-checkout more than a first-time buyer does. Not a distinct account type — a usage pattern that should shape UX (Phase 5) more than the data model. Distinguishing this from P1 matters because MASTER-PROMPT §PHASE 2 explicitly asks for it, and because a repeat buyer is the segment most likely to notice a missing address book (Phase 0 finding: address management is inline-only today).

### P3 — Instagram/Telegram social-commerce seller (Line B, "merchant" in the blueprint)
Micro-retailer already manually running "we'll get it from abroad for you" as a DM-based service (`feasibility-revalidation-v0.2.md` line 113). Wants the platform to become their invisible fulfillment + treasury + logistics back-end. Defaults to **Wholesaler mode** (source hidden, one delivered price) to protect their customer relationship from disintermediation (`business-lines.md` §B). Platform-later, but the account model must anticipate this actor from Phase 2 onward.
**Account shape:** `User` (owner) + `Organization` (kind=MERCHANT) + `OrganizationMembership`.

### P4 — Small online merchant / niche e-shop (Line B, broader than P3)
Same account shape and needs as P3, larger or more structured operation — more likely to want Agent-mode transparency (unlocked at higher tiers per `business-lines.md` §B) and multiple staff members submitting/monitoring orders, which is what makes `OrganizationMembership` (not just a single owner login) necessary even at Line B MVP.

### P5 — Company purchaser (Line C, individual buyer within an enterprise)
Employee at an importer/trading company who actually submits a requirement (a spec/BOM, not a link) into the managed desk. Interaction model is operator-mediated, not self-serve (`business-lines.md` §C) — this persona's "product surface" for most of the journey is a status dashboard plus a request-intake form, not a paste-link flow.
**Account shape:** `User` + `Organization` (kind=ENTERPRISE) + `OrganizationMembership` (role: buyer).

### P6 — Enterprise procurement operator (Line C, internal to the enterprise customer)
Manages the relationship and multiple requirements/orders on behalf of the enterprise; distinct from P5 in that they likely have visibility across the whole organization's orders, not just their own submissions.
**Account shape:** same as P5, role: procurement operator (org-scoped, broader read/approve scope than "buyer").

### P7 — Organization owner (Line B and Line C)
The account-holder who created the `Organization`, manages wallet top-ups (Line B) or billing/credit terms (Line C), and invites/removes members. Not a separate persona in spirit from P3/P4/P5/P6 so much as the specific **role** every Organization needs exactly one accountable holder of — called out separately because MASTER-PROMPT §PHASE 2 lists "organization owner" explicitly and because the account model (`account-and-organization-model.md`) needs an unambiguous owner role, not just "some member."

### P8 — Finance approver (Line C, occasionally Line B at higher tiers)
Employee at an enterprise (or a larger merchant) who must approve spend above a threshold before an order proceeds — implied by `feasibility-revalidation-v0.2.md`'s deposit/milestone money model for Line C (line 197) and Agent-mode transparency for larger Line-B merchants. Today's system has no approval-workflow concept at all; flagged as platform-later in `account-and-organization-model.md`.

---

## Internal / operational users

### I1 — Customer support operator
Handles support/refund cases. **Gap:** Phase 0 found no workflow surface exists for this role on either side today (`docs/program/00-current-state-assessment.md` §0.2) — this persona currently has no product to use. In the MVP boundary per `mvp-vs-platform.md` item 2.

### I2 — Procurement operator ("ops operator" in the blueprint)
Works the ranked exception queue, runs the procurement copilot, handles PRICE_CHANGED/OUT_OF_STOCK/delay exceptions. Named directly in `technical-blueprint-v1.md` §1.1 ("clear the orders that actually need me, fast, never touch the healthy ones" — the manage-by-exception RULE in `CLAUDE.md`). Already has a mature product surface per Phase 0 (COMPLETE).

### I3 — Logistics operator
Manages shipments, warehouse/fulfillment state, carrier handoffs. Distinct from I2 in MASTER-PROMPT's persona list; today's system tracks shipment state but Phase 0 didn't find a dedicated logistics-operator surface distinct from the general exception queue — likely folds into I2's surface for MVP, revisit in Phase 6 (backoffice operating model).

### I4 — Finance / reconciliation operator ("finance/treasury" in the blueprint)
Owns ledger integrity, FX exposure, reconciliation match rate. Named directly in `technical-blueprint-v1.md` §1.1. Phase 0 found ledger/finance read surfaces COMPLETE but flagged the automated reconciliation matcher described in `feasibility-revalidation-v0.2.md` as unconfirmed in code.

### I5 — Compliance / risk operator
Owns the compliance gate (`CLAUDE.md`: "the compliance gate is the master switch before production") and the AML/personal-import/anti-concealment guardrails from `phase-0.3-logistics-feasibility.md` (lines 133, 141, 181). No dedicated product surface exists yet; this persona's needs are closely tied to `anti-personas.md` — they are the internal actor whose job is to keep the anti-personas out.

### I6 — System administrator
Manages internal users, roles, and platform configuration (providers, marketplace config, feature flags). Today's `operators` table + flat `@Roles()` decorators give this persona no real UI (Phase 0: "no role-management UI"). Directly motivates the RBAC generalization in `mvp-vs-platform.md` item 4 and Phase 7.

---

## Secondary / edge-case users

- **Delegated buyer** — a Line-A individual who has someone else (family member, assistant) complete checkout on their behalf using shared credentials. Currently indistinguishable from account sharing at the data-model level; flagged, not designed, pending Phase 3 journey work — must not be conflated with the anti-persona "colludes to bypass a single-account limit" pattern (`anti-personas.md`).
- **First-time buyer with no delivery history** — needs more trust-building UI (progress transparency, "why does this cost this much" quote explanation) than P2; a UX weighting concern for Phase 5, not a distinct account type.
- **Merchant's end customer** — the person who actually ordered from a Line-B merchant's Instagram shop. **Not a platform identity in the MVP-for-Line-2 shape** (`business-lines.md` §B: "reusing the exact same engine... with a merchant-markup field and per-merchant branded tracking page") — they see a branded tracking page, not a platform account. Recorded explicitly here so Phase 2's account model doesn't accidentally scope them as a `User`.
- **Organization member removed mid-order** — an org membership can be revoked while their submitted order is still in flight; the order must not become orphaned. A data-integrity edge case for `account-and-organization-model.md` and Phase 10 (backend requirements), not a persona in the product sense.

## Anti-personas

See `anti-personas.md`.
