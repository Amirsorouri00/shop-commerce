# Anti-Personas

> Phase 2 of `docs/program/MASTER-PROMPT.md`. Who this platform is deliberately not for, and why — grounded in `CLAUDE.md`'s compliance RULE and `phase-0.3-logistics-feasibility.md`'s explicit AML/customs guardrails, not invented from scratch. MASTER-PROMPT §1: "No architecture path may depend on concealment, account sharing, or bypassing marketplace/AML controls. The compliance gate is the master switch before production" — these anti-personas exist to make that RULE concrete for product/UX decisions, not just backend enforcement.

## AP1 — The value-transfer arbitrageur

**Pattern:** uses the "buy abroad, deliver in Iran" mechanic backwards or sideways — pays in IRR expecting a foreign-currency-denominated benefit disconnected from an actual physical good, effectively using the platform as an unlicensed hawala-style cross-border money mover.
**Why excluded:** `phase-0.3-logistics-feasibility.md` line 141: "hawala-style *value* transfer is regulated money transmission and is illegal unlicensed... **RULE: our version must move *goods*, never net value across borders**." Line 181 repeats this as a non-negotiable RULE for the traveler/agent fulfillment model specifically.
**Product implication:** every order must resolve to an actual, trackable physical good with a real marketplace transaction behind it (matches Phase 4's "never fabricate price/variation/availability" requirement) — no cash-settlement-only paths, no "credit for future orders" schemes that decouple payment from a specific procured item.

## AP2 — The customs-limit launderer / structuring abuser

**Pattern:** splits large-value goods across many small "personal import" orders, or across many accounts, specifically to stay under personal-import declaration thresholds — not because they're actually many separate personal purchases.
**Why excluded:** `phase-0.3-logistics-feasibility.md` line 133: "must stay within personal-import rules and declare properly; never a vehicle for undeclared value." Line 132 names customs exposure as "the sharp edge" of the risk model.
**Product implication:** feeds I5 (compliance/risk operator)'s job directly — order/account velocity and cross-account pattern monitoring is a compliance-gate concern, not just a fraud-cost concern. Not designed in this program (no dedicated surface exists yet), but flagged so Phase 3/Phase 7 don't design account/order limits in a way that's blind to structuring.

## AP3 — The account-sharing / concealment user

**Pattern:** multiple distinct real people operate under one shared login specifically to obscure who is actually transacting (as opposed to the benign "delegated buyer" edge case in `personas.md`, where one accountable person authorizes someone else to complete checkout *for them*, transparently).
**Why excluded:** `CLAUDE.md` and MASTER-PROMPT §1 both state the RULE directly: "no architecture path may depend on concealment, account sharing, or bypassing marketplace/AML controls."
**Product implication:** the identity model (`account-and-organization-model.md`) must keep `User` (login identity) and delegated-access patterns (family member checkout, `OrganizationMembership` for Line B/C) auditable and attributable — a shared credential with no attribution trail is the anti-pattern, not delegation itself.

## AP4 — The marketplace-ToS-bypass reseller

**Pattern:** wants the platform to help circumvent a marketplace's own seller/geo-restriction rules (e.g., using the platform as a disguised drop-shipping front that hides from Amazon that goods are being resold commercially at scale, when Amazon's terms would restrict that).
**Why excluded:** `CLAUDE.md`: "no architecture path may depend on... bypassing marketplace... controls." This is a distinct failure mode from AP1/AP2 — it's marketplace-policy risk, not AML/customs risk, but the same RULE covers it.
**Product implication:** Line B's "Wholesaler mode hides the source from the merchant's *customer*" (`business-lines.md` §B) is explicitly not the same thing as hiding the transaction's true commercial nature from the marketplace itself — Phase 4's product-resolution work must keep this distinction intact when designing what the marketplace-facing procurement identity looks like.

## AP5 — The catalog-browsing user

**Pattern:** wants to discover/search/browse products through the platform the way they would on a marketplace itself, rather than arriving with a specific link.
**Why excluded:** not a compliance risk — a product-boundary one. `product-boundary.md` resolved this explicitly: `CLAUDE.md`'s "link-first only" RULE governs, and catalog/discovery stays out of scope pending a future ADR, despite `technical-blueprint-v1.md`'s post-MVP list mentioning it.
**Product implication:** front-office IA (Phase 5) should not grow browse/search entry points "for engagement," even opportunistically — that would silently reintroduce a capability this program deliberately excluded.

## AP6 — The uncollateralized enterprise credit-seeker

**Pattern:** an enterprise (Line C) or large merchant (Line B) wants the platform to front full payment for goods/procurement before the platform is paid or secured — effectively asking the platform to carry their working-capital risk unsecured.
**Why excluded:** `feasibility-revalidation-v0.2.md` line 197 (Line C): "de-risk with deposits + milestones, or LC/trade-finance for vetted accounts; never carry full enterprise float unsecured." Line B's default is a **prepaid** wallet specifically to keep working capital merchant-funded (`business-lines.md` §B).
**Product implication:** the money-model abstraction flagged as platform-later in `account-and-organization-model.md` (wallet, escrow, deposit/milestone) must not include an "invoice, pay later, unsecured" mode as a default or easy path for any line.

## Note on enforcement

These are product/UX design constraints, not implemented controls — Phase 0 found no dedicated compliance-operator surface exists yet (I5 in `personas.md`). Anti-personas AP1–AP4 are backend/compliance-gate concerns primarily; AP5–AP6 are product-boundary and money-model concerns this program's own decisions (Phases 1, 7, 10) are directly responsible for not accidentally reopening.
