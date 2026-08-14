# MVP vs. Platform

> Phase 1 of `docs/program/MASTER-PROMPT.md`. States what ships in the first production release ("MVP-now") vs. what is in-boundary-but-later ("platform-later"), with confidence and reversal cost per MASTER-PROMPT §1. See `business-lines.md` for the per-line detail this phasing is built from.

## MVP-now

**Line A (B2C), brought from "COMPLETE on sandbox" to production-ready.** Per Phase 0, the core journey already exists; what's actually left for MVP is closing the gaps Phase 0 found, not building a new business line:

1. Customer-facing price-changed / out-of-stock decision UI (today: operator-only — Phase 0 §0.2, §0.3.3). This is a correctness gap against MASTER-PROMPT §PHASE 3 ("No backend workflow may remain operationally inaccessible when a human is expected to manage it" — here inverted: a customer decision the backend expects but the frontend never asks for).
2. A minimal support/refund workflow surface (today: ledger/state-machine anticipates it, nothing initiates it).
3. Standalone address management (today: inline-only inside checkout, no add/edit/delete).
4. RBAC generalized from a flat role string to a scoped Permission/Role model *at least enough to not block Line A production launch* (full B/C-ready scoping can follow — see Phase 7).
5. Real provider integrations behind the three existing EXTERNAL-GATE ports (payment, procurement, logistics) — these remain gated on external credentials/agreements per MASTER-PROMPT §1, but the sandbox-parity requirement (MASTER-PROMPT §PHASE 9) means Line A must be fully demonstrable end-to-end in sandbox regardless of gate status.
6. **D — Shared Platform Capabilities**, to the extent Line A already exercises them (resolution, quote, procurement engine, tracking, money/ledger). Not generalized for B/C yet — that generalization is platform-later, scoped in Phase 2/7/10, not required to ship Line A.

**Confidence: high.** This is a direct continuation of what Phase 0 already found built, not a new inference.

## Platform-later (in-boundary, sequenced after MVP)

1. **Line B — Merchant Fulfillment Platform**, next. MVP-for-Line-2 shape is already specified (`business-lines.md` §B: merchant account + prepaid wallet + embedded panel + wholesaler-mode pricing + per-merchant tracking, reusing the Line A engine). Reversal cost of deferring: **low** — governing docs (line 290) call this "the highest-leverage expansion" specifically *because* it reuses the engine; nothing about building Line A first forecloses it, and no Line-A work should be built in a way that would need to be undone to add it (this is the reason Phase 2's account model must support Organization from the start even though only individual accounts ship in MVP — see `docs/product/account-and-organization-model.md`, produced in Phase 2).
2. **Line C — Enterprise Import/Export Procurement**, last, entered through the lowest-risk wedge (consolidation + tracking dashboard, or a single-category managed desk) rather than full managed procurement. Reversal cost of deferring: **low** — explicitly the governing docs' own sequencing decision (`feasibility-revalidation-v0.2.md` line 207), driven by compliance and working-capital load, not technical dependency.
3. **D generalization beyond what Line A needs** — wallet money model, escrow, Organization/Membership beyond a minimal shape, per-leg fulfillment configurator, B2B supplier/RFQ sourcing extension. These are platform-later *because* B and C are platform-later, not for independent reasons.
4. Line B's white-label storefront and collected-checkout escrow tiers, and Line B's AI upgrades (auto-generated Persian listings, markup advisor, credit scoring, support copilot) — explicitly "fast-follow" even within Line B itself (`business-lines.md` §B, feasibility doc line 165).

## Permanently out (not "later" — see `product-boundary.md` for the one contested item)

Catalog/search/marketplace browsing — held out pending an explicit future ADR, not scheduled as platform-later. Native apps, crowdship/traveler network, agentic-native procurement, ACP/UCP distribution, pickup-point network, instant-SKU — genuinely deferred per blueprint (line 48), no ADR needed to eventually build them, but not scheduled within this program's current phase ordering.

## What this phasing does not decide

This document sets *product* sequencing. It does not commit to a specific *implementation* order inside Phase 12 (work-package decomposition) — e.g., whether Line A's gap-closure work packages (support surface, RBAC generalization) happen before or interleaved with Phase 2–11 discovery work for Line A itself. That ordering is Phase 12's job, informed by this file plus the traceability matrix (Phase 11).
