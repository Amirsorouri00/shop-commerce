# Business Lines

> Phase 1 of `docs/program/MASTER-PROMPT.md`. Distinguishes the four business-line buckets MASTER-PROMPT §PHASE 1 requires (A/B/C/D) and states what ships now vs. later. See `product-boundary.md` for the boundary decision and `mvp-vs-platform.md` for phasing detail.

**Source-of-truth note:** the sequencing below is not a fresh inference — `feasibility-revalidation-v0.2.md` already contains an explicit, reasoned **DECISION D3** ("Ship consumer first, merchant second..., enterprise last") and a companion phased-roadmap table (lines 251–266). Per MASTER-PROMPT §5, governing product documents (precedence 3) outrank existing implementation (precedence 5) and are adopted here at **high confidence** — this program's job was to confirm the decision still holds against MASTER-PROMPT's requirements and the Phase 0 reality, not to re-derive it from scratch. It does hold: nothing in MASTER-PROMPT contradicts it, and Phase 0 found the current codebase is already exactly at the "Line A only, engine built generically enough to extend" state the decision assumes.

## A. B2C Assisted Commerce

**Definition:** an individual Iranian consumer pastes a foreign marketplace link (Amazon UAE at MVP), gets a landed-cost quote in IRR, pays, and tracks delivery. This is the beachhead — see `product-boundary.md`.

**Status (per Phase 0):** the only business line with any code. Core journey (resolve → quote → auth → address → pay → procure → track) is COMPLETE on sandbox adapters; real payment/procurement/logistics/FX providers are EXTERNAL-GATE by design. Structural gaps found (customer-facing price-changed/OOS decisions missing, refunds/support have no workflow surface, address management is inline-only) are **completeness gaps within Line A**, not new-business-line work — they belong in Phase 3/5 of this program, in the MVP boundary.

**Monetization:** margin on landed cost (spread between marketplace price + logistics/customs cost and quoted price to customer).

## B. B2B Merchant / Seller Assisted Procurement and Fulfillment

**Definition:** existing Iranian online sellers (Instagram/Telegram shops, niche e-shops) push their own customers' cross-border orders through the platform and resell fulfillment under their own brand, instead of running the ops themselves.

**Product shape, per `feasibility-revalidation-v0.2.md` Part B (lines 109–176):**
- **Money model — DECISION:** default new merchants to **Wholesaler mode** (platform quotes one delivered-to-Iran price, source hidden, margin embedded in the wholesale price) rather than Agent mode (transparent landed-cost + merchant-set markup); unlock Agent-mode transparency at higher tiers. This defuses disintermediation and price-transparency risk (lines 119–125, 134).
- **Access model:** **embedded panel** (merchant logs into a branded dashboard, submits/monitors orders, sets markups, relays status) as the MVP-for-Line-2 surface. Full white-label storefront and referral-link modes are fast-follow, not MVP (lines 138–140, 165).
- **Money handling — DECISION:** **prepaid wallet** (merchant tops up in IRR, each order debits it) as the launch model — zero credit risk to the platform, working capital funded by the merchant. Collected-by-merchant-with-escrow and vetted credit terms are later tiers (lines 144–146).
- **Fulfillment — modular "leg toolkit"** (`phase-0.3-logistics-feasibility.md` §5, lines 151–165): merchants buy only the legs they need (full to-door / to-merchant / freight-only / consolidation-only), each priced separately via a fulfillment configurator. This is what makes the offer viable against a merchant just doing it themselves (removes the "thin middle" risk).
- **MVP-for-Line-2 scope (feasibility doc line 165, verbatim):** "merchant account + prepaid wallet + embedded panel (submit link → wholesale quote → pay from wallet → track) reusing the *exact same* resolution/quote/procurement/tracking engine as the consumer app, with a merchant-markup field and per-merchant branded tracking page."

**Status:** zero code footprint (Phase 0 §0.3.1). Sequenced **after** Line A stabilizes — reuses the same engine, so it is comparatively cheap once Line A's identity/account model (Phase 2) supports an Organization/Merchant profile.

**Monetization:** wholesale-vs-marketplace spread + optional SaaS subscription for panel/white-label tiers (line 160).

## C. Enterprise Procurement / Import Operations

**Definition:** importers, trading companies, and procurement departments place large or recurring B2B orders (a spec/BOM, not a pasted consumer link), get consolidated procurement, freight, customs handling, and unified tracking.

**Product shape, per `feasibility-revalidation-v0.2.md` Part C (lines 177–222):**
- **Not self-serve at first — DECISION:** a **managed procurement desk**: the enterprise submits a requirement, the platform's operators source/quote/procure/ship, the enterprise tracks on a dashboard (line 193). This is a materially different interaction model from Lines A/B (operator-mediated, not paste-a-link).
- **Procurement source shifts:** enterprises want B2B suppliers (Amazon Business, Alibaba/1688, manufacturer direct, RFQ flows), not consumer marketplaces — the resolution engine's "Universal Adapter" needs a B2B-catalog extension, not just a bigger Amazon integration (line 186).
- **Money — DECISION:** de-risk with deposits + milestones, or LC/trade-finance for vetted accounts; never carry full enterprise float unsecured (line 197).
- **Lowest-risk wedge — DECISION:** enter via **consolidation + tracking dashboard**, or a single-category managed desk — sellable on its own, lower compliance risk than full managed procurement (line 201).
- **Sequencing — DECISION (line 207, verbatim):** "Line 3 is highest value per account but highest compliance and working-capital intensity. Treat it as Phase 3+, not MVP. Enter via the lowest-risk wedge... once the consumer and merchant lines have proven procurement, treasury, and compliance foundations. Do not lead with it."

**Status:** zero code footprint. Deferred furthest of the three lines — do not let it pull program scope forward (line 291).

**Monetization:** per-contract margin on consolidated procurement + freight; pipeline/contract-value economics, not per-order margin (line 279).

## D. Shared Platform Capabilities

**Definition:** the single engine all three business lines are front-ends on top of (`feasibility-revalidation-v0.2.md` lines 223–245, 271): product resolution, quote/landed-cost calculation, payment/money movement, procurement execution, multi-leg fulfillment tracking, notifications, and the identity/account substrate. Per-line differences are meant to stay thin: onboarding/identity flavor, pricing/markup policy, money model (direct pay vs. wallet vs. escrow vs. terms), UI surface, SLA tier, support tier (line 271).

**Status:** built, but currently hardcoded to Line A's shape (Phase 0 §0.1, §0.3.2 — identity model has no `Organization`/`MerchantProfile`, RBAC is a flat role string, not the scoped Permission model MASTER-PROMPT Phase 7 requires). Generalizing D so B and C can be thin layers on top of it — without rebuilding it — is the central architectural bet of this whole convergence program, and the direct reason Phase 2 (accounts) and Phase 7 (RBAC) are greenfield, not refinement, per Phase 0's findings.

**Explicitly not part of D:** catalog/search/browsing across marketplaces. `CLAUDE.md`'s RULE "Link-first only. No catalog, search, or merchandising" is treated as still binding — see `product-boundary.md` for the one contradiction this creates against `technical-blueprint-v1.md`'s post-MVP list, and how it's resolved.
