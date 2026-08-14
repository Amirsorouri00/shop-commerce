# Product Boundary

> Phase 1 of `docs/program/MASTER-PROMPT.md`. States what is and isn't inside this platform's product boundary, and resolves the one material contradiction Phase 1 found. See `business-lines.md` for the A/B/C/D detail and `mvp-vs-platform.md` for phasing.

## The confirmed beachhead

Foreign product URL → product resolution → landed-cost quote → customer decision → authentication/account → address → payment → procurement → multi-leg fulfillment → customs/logistics → delivery → support/refund/exception handling (MASTER-PROMPT §PHASE 1; matches the implemented Line-A journey confirmed in `docs/program/00-current-state-assessment.md` §0.2).

Primary lane: **Amazon UAE → Iran** (`phase-0.3-logistics-feasibility.md` DECISION, line 219 — UAE beachhead, Turkey as lane #2 once stable, DE/UK only as value-dense catalog extensions later).

## In the product boundary (all four buckets, phased — see `mvp-vs-platform.md`)

- **A — B2C Assisted Commerce.** In now; already built to COMPLETE-on-sandbox per Phase 0.
- **B — B2B Merchant Fulfillment Platform.** In the boundary, phased after A. Wholesaler-mode, prepaid-wallet, embedded-panel MVP shape is already specified in governing docs (`business-lines.md` §B).
- **C — Enterprise Import/Export Procurement.** In the boundary, phased after B, entered via the lowest-risk wedge (consolidation/tracking dashboard or single-category managed desk), not full managed procurement.
- **D — Shared Platform Capabilities.** In now, but needs generalizing (identity/account model, RBAC) so B and C can be thin layers rather than forks.

## Explicitly outside the product boundary

**No catalog, search, or marketplace browsing, ever, absent an explicit ADR.** This is the one place Phase 1 found a real tension between sources and had to apply MASTER-PROMPT §5's precedence rule instead of silently picking one:

| Source | Says |
|---|---|
| `CLAUDE.md` (existing architectural rule) | "**Link-first only.** No catalog, search, or merchandising. One paste-a-link flow." — marked as a **RULE** (CLAUDE.md's own status-marker legend: "RULE = enforced business rule... Don't silently override a DECISION or downgrade a RULE.") |
| `technical-blueprint-v1.md` (governing product document) | Lists "catalog/discovery" in its post-MVP OUT list (line 48): "OUT (post-MVP): merchant panel/white-label, enterprise desk, **catalog/discovery**, native apps..." — phrased as *deferred*, i.e. implies it is on the long-run roadmap, not permanently excluded. |

Per MASTER-PROMPT §5, governing product documents (precedence 3) outrank existing architectural rules (precedence 4). Taken literally, that would let the blueprint's "deferred, not excluded" framing override CLAUDE.md's RULE.

**Resolution — deliberately not silent:** this program does **not** adopt catalog/discovery as a planned future capability. Reasoning:
1. The apparent conflict may not be a real one — "link-first only" plausibly describes the *primary interaction mechanic* (no browse/search as the entry point), which a narrow future catalog feature might not violate. But that reading is itself an inference this program isn't positioned to make unilaterally, because CLAUDE.md frames it as an enforced RULE, not a UX preference.
2. Reversal cost is asymmetric: excluding catalog/discovery now costs nothing (nothing in the MVP or platform-later plan needs it — Lines A/B/C all work purely off pasted links / submitted specs, per `business-lines.md`). Building toward it later, if a human product owner decides the RULE should be narrowed, costs a normal feature build. Building it now on the strength of one ambiguous blueprint phrase, against an explicit RULE, is not reversible in the same cheap way (it changes the product's core interaction model and CLAUDE.md's own multi-project instructions).
3. MASTER-PROMPT §1 requires recording assumption/confidence/alternatives/reversal-cost for inferred decisions of this kind: **assumption** — CLAUDE.md's RULE still governs; **confidence** — high, because RULE-marker status is explicitly meant to survive ambiguity; **alternative considered** — adopt blueprint's deferred framing and scope a future catalog capability; **reversal cost of this decision** — low (a future ADR can supersede the RULE exactly the way MASTER-PROMPT §6 already superseded the admin-framework DECISION).

**Also outside the boundary for now** (blueprint's post-MVP list, adopted as genuinely deferred — no RULE conflict): native apps, crowdship/traveler network, agentic-native procurement, ACP/UCP agent-commerce distribution, pickup-point network, instant-SKU, white-label storefront/escrow (Line B fast-follow, not Line B MVP), full managed enterprise procurement beyond the wedge (Line C).

## What "in the boundary" does not mean

Per MASTER-PROMPT §1: a business line being in-boundary-but-phased-later is not an excuse to leave its seam undesigned. Lines B and C must still get their domain contracts, ports, and UX-state scaffolding planned (not necessarily built) at the point Phase 12 (work-package decomposition) reaches them, exactly as MASTER-PROMPT requires for any blocked external integration.
