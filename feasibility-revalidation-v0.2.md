# Cross-Border Assisted Commerce Platform
## Feasibility Revalidation & Strategic Expansion — v0.2

**Document status:** Phase 0 — Feasibility revalidation + new business-line assessment
**Supersedes:** v0.1 "Cross-Border Assisted Commerce Platform — Phase 0 Feasibility"
**Date:** August 2026
**Primary launch market:** Iran (consumer beachhead), Amazon UAE / Amazon Turkey source marketplaces
**Author lens:** Business Assessor · CPO · CMO · CEO · Founder
**Reading note:** This document is written to be actionable, not narrative. Every section states *where we are going* and *what decision it drives*. Recommendations are marked **DECISION**, open items **GATE**, and things to build **BUILD**.

---

## 0. What this document does

v0.1 established that the consumer "paste-a-link, we buy and ship it" concept is a **Preliminary GO with constraints**. It left three things open that this document closes or advances:

1. **Revalidate feasibility against 2026 AI** — the technology landscape moved materially in the last 12 months (agentic commerce protocols, reliable browser agents, cheap vision extraction). This changes the procurement bottleneck, the cost structure, and the moat. Part A re-scores the MVP with AI leverage baked in.
2. **Assess a second business line** — a **Merchant Fulfillment Platform**: let existing Iranian online shops (Instagram/Telegram sellers, Basalam/Digikala-adjacent stores, niche e-shops) push their customers' cross-border orders through us and resell fulfillment under their own brand. Part B.
3. **Assess a third business line** — **Enterprise Import/Export Procurement**: let importers/trading companies check out large orders and track consolidated freight through the same engine. Part C.

Part D unifies all three into one platform strategy, one build sequence, and one positioning story, because the core insight is that **all three are the same engine pointed at three different demand surfaces.**

---

# PART A — AI Revalidation of the Core MVP

## A1. What changed in the market since v0.1

Three shifts are directly relevant to this business:

**1. Agentic commerce became a standard, not an experiment.** Two open protocols now govern how AI agents transact with merchants:
- **OpenAI/Stripe Agentic Commerce Protocol (ACP)** — live in ChatGPT since Sept 2025; partners include Shopify, Etsy, Instacart, DoorDash. Focused on the checkout/transaction moment.
- **Google Universal Commerce Protocol (UCP)** — released Jan 2026, co-developed with Shopify, and backed by Etsy, Wayfair, Target, Walmart. Covers the full lifecycle (discovery → capability negotiation → checkout → post-purchase) via a decentralized `/.well-known/ucp` endpoint.

Merchants supporting both protocols are reported to see up to ~40% more agent-driven traffic. **Why this matters to us:** it creates a machine-readable rail for two things — (a) *consuming* structured product/checkout data from participating merchants, and (b) *exposing* our own catalog/checkout to AI shopping agents as a new demand channel. Note the constraint: **Amazon is not in either coalition**, and Iran-nexus compliance limits our ability to formally join merchant coalitions. So for procurement we still rely on assisted/agent execution, but for *distribution* we can expose ACP/UCP endpoints.

**2. Browser/computer-use agents crossed the reliability line for supervised use.** Best-in-class agents (e.g. Browser Use) now hit ~89% on the WebVoyager benchmark. The decisive finding: switching from *fully autonomous* to a *plan-follower with human oversight* model raised real-world success from ~30% to ~80%. This is the exact shape of our "Assisted Procurement" model — it is now a mainstream, benchmarked pattern rather than a workaround. Known failure modes remain (rate limits, auth/OTP timeouts, schema drift), which is precisely why **3DS/OTP is still the STP ceiling**, not agent intelligence.

**3. Vision-based structured extraction became cheap and accurate.** LLM + vision extraction of product attributes (title, price, variant, weight, images, availability) from rendered pages now outperforms raw-HTML scraping and survives dynamic/obfuscated DOMs. This turns the **Store Adapter** layer from a brittle per-site scraper into a resilient AI fallback that works across any marketplace with near-zero per-site engineering.

**DECISION A1:** Treat AI not as a feature but as the **operating substrate** of three layers — Product Resolution, Procurement Execution, and Customer Trust/Support. The moat is no longer "we built the website"; it is "we run the lowest-HSPO, highest-STP compliant cross-border operation in the market, and AI is how we get there."

## A2. Re-scored feasibility matrix (v0.1 → v0.2 with AI leverage)

| Capability | v0.1 | v0.2 w/ AI | What AI changes |
|---|---|---|---|
| Link ingestion / URL parsing | 🟢 High | 🟢 High | LLM classifies unknown URL patterns; no per-site regex |
| Product resolution | 🟢 High | 🟢 **Higher** | Vision extraction as universal fallback; resilient to DOM changes |
| Product pricing / landed cost | 🟢 High | 🟢 High | ML estimates weight/volumetric from title+category+images |
| FX integration | 🟢 High | 🟢 High | Unchanged; provider abstraction still the right call |
| Quote engine | 🟢 High | 🟢 High | AI improves shipping/customs estimate accuracy (biggest error source) |
| Iranian payment | 🟢 High | 🟢 High | Unchanged |
| PWA | 🟢 High | 🟢 High | Unchanged |
| Admin / ops console | 🟢 High | 🟢 **Higher** | AI triage of exceptions; ops-by-exception becomes AI-ranked queue |
| Order management | 🟢 High | 🟢 High | Unchanged |
| Financial ledger | 🟢 Feasible | 🟢 Feasible | Unchanged (must stay deterministic — not AI) |
| Reconciliation | 🟢 Feasible | 🟢 **Higher** | LLM matches fuzzy transaction descriptors; raises auto-match rate |
| Unified tracking | 🟢 Feasible | 🟢 **Higher** | LLM normalizes heterogeneous carrier statuses into one lifecycle |
| **UAE procurement** | 🟠 Validate | 🟠→🟢 **Improving** | Supervised agent execution lifts STP; HSPO drops to tens of seconds |
| **Turkey procurement** | 🟠 Validate | 🟠→🟢 **Improving** | Same |
| Foreign payment | 🟠 Validate | 🟠 Validate | AI does not solve banking/3DS; still a compliance/banking gate |
| Treasury | 🟠 Constraint | 🟠 Constraint | AI forecasts float need; does not remove working-capital requirement |
| Logistics | 🟠 Discovery | 🟠 Discovery | Still the #1 discovery priority (Phase 0.3) |
| Customs | 🟠/🔴 | 🟠/🔴 | Unchanged; legal gate |
| Compliance | 🔴 | 🔴 | **Unchanged and still the hard gate** — AI cannot substitute for legal validation |

**Read of the matrix:** AI meaningfully upgrades everything *inside our four walls* (resolution, ops, reconciliation, tracking) and *improves* the procurement bottleneck, but changes **nothing** about the three exogenous gates: **foreign payment banking, customs/importability, and compliance.** Those remain the true GO/NO-GO determinants. Do not let AI optimism paper over them.

## A3. AI applied domain-by-domain (the build map)

**Product Resolution — "Universal Adapter."**
Replace the assumption of one hand-built adapter per marketplace with a two-tier resolver: (1) official/structured API where available (Amazon SP-API/product data); (2) **vision-LLM extraction fallback** for everything else. Output is the same normalized `ExternalProduct` snapshot. *Benefit:* onboard a new source marketplace (Trendyol, Noon, Amazon DE/UK) in days, not sprints. *BUILD:* a `ResolverConfidence` score on each field; low-confidence weight/dimensions route to the pricing risk buffer instead of a hard quote.

**Quote Engine — attack the biggest error source.**
The largest margin leak in v0.1 is shipping/customs estimation before warehouse receipt. *BUILD:* a landed-cost model that predicts **actual + volumetric weight** from product title, category, brand, and images, trained on real warehouse-receipt data as it accumulates. Until data exists, use category-level priors with explicit risk reserve. This is the single highest-ROI AI investment because it directly protects Contribution Margin per Order.

**Procurement — the HSPO/STP engine.**
Adopt the benchmarked **plan-follower + human confirmation** pattern:
- AI prepares the *entire* deterministic context (account, warehouse address, payment profile, price validation, max-price tolerance) and drives the cart up to the pay button.
- Human confirms only the irreducible step (final purchase / 3DS challenge).
- Target evolution: HSPO 45–60s (launch) → <30s (mature) → sub-10s on API-eligible marketplaces.
- Track **STP** as the north-star ops metric. The ceiling is set by auth friction (3DS/OTP), *not* model capability — so measure auth-challenge rate per marketplace/instrument during Phase 0 and choose instruments/banks that minimize it.
*Strategic path:* Assisted (now) → Agentic-supervised (as reliability proves out per category/price band) → API/UCP-ACP native (where marketplaces support it). Never make unsupervised browser automation the *foundation*; use it as an accelerant under a human gate.

**Customer Trust & Support — Persian-first.**
There is a real gap: strong open-source Persian LLMs are scarce; production quality generally requires fine-tuning a base model (Llama/Mistral-class) on Persian + domain data. *BUILD:* (a) an AI "quote explainer" that turns the price breakdown into plain Persian and answers "why this price / when will it arrive"; (b) proactive status-narration in Persian at each lifecycle milestone (trust is generated by observable execution — AI makes that execution legible); (c) a support copilot that drafts replies from order context, human-approved at launch. *CMO note:* trust is a conversion lever, not just support cost. Persian-native, proactive, milestone-by-milestone communication is a differentiator against fragmented Instagram sellers.

**Operations — manage-by-exception, AI-ranked.**
*BUILD:* an exception classifier that ranks the ops queue by margin-at-risk × urgency (price changed, tracking stalled, weight mismatch, reconciliation break, address needed). Operators work a prioritized, AI-explained queue instead of monitoring healthy orders. This is what lets a small team run high GMV.

**Finance — reconciliation, deterministic ledger + AI matcher.**
Keep the ledger strictly deterministic (money is never an LLM decision). Use an LLM *only* to propose fuzzy matches between foreign-card descriptors, procurement orders, and customer orders, with a human/rule confirmation. Target auto-match >99% over time.

## A4. Revised procurement decision

**DECISION A4:** Launch on **Assisted Procurement with an AI copilot** (Strategy C from v0.1), instrumented from day one for HSPO and STP, on Amazon UAE and Amazon Turkey. Treat agentic-supervised execution as a *progressive rollout per category/price band* gated on measured success rate, and API/ACP/UCP-native procurement as the long-term target where marketplace and compliance allow. This preserves reliability and compliance while capturing most of the automation upside immediately.

## A5. Risk register — deltas vs v0.1

- **R1 Procurement automation** — *reduced.* Supervised agents are now benchmarked and viable; assisted model de-risked.
- **R2 Payment authentication (3DS/OTP)** — *unchanged / now the primary STP ceiling.* Elevate to a measured Phase-0 gate.
- **R5 Shipping estimation** — *reduced* via AI weight/volumetric prediction, but only after real receipt data accumulates; keep risk reserve until then.
- **New R11 — AI extraction hallucination.** Vision extraction can mis-read price/variant. *Mitigation:* confidence scoring + mandatory FX/price revalidation at checkout (already in v0.1 §24) + max-procurement-price tolerance (§23).
- **New R12 — Protocol/channel dependency.** If we lean on ACP/UCP for distribution, coalition policy or Iran-nexus exclusion could cut the channel. *Mitigation:* treat agentic channels as upside, not core; own the direct PWA channel.
- **Compliance (R-legal)** — *unchanged and still 🔴.* No AI mitigation. Remains the master gate.

---

# PART B — Business Line 2: Merchant Fulfillment Platform (B2B online-shop panel)

## B1. The idea, stated precisely

Today thousands of Iranian micro-retailers (Instagram/Telegram shops, niche e-commerce stores, personal shoppers) already sell "we'll get it from abroad for you" as a service — manually, unreliably, one DM at a time. **We give them a panel.** They (or their customer) paste a product link into *their* branded storefront/panel; we resolve, price, procure, ship, and track; they keep the customer relationship and a margin. In effect we become the **fulfillment + treasury + logistics back-end for the entire cottage industry of cross-border resellers.**

This is a classic platform move: instead of only competing with these sellers for end-consumers, we also **sell them the infrastructure** — turning competitors into distribution.

## B2. Why it can fail (name the failure modes before designing)

1. **Channel conflict** — if our consumer brand competes with our merchant customers, they won't trust us with their customers.
2. **Disintermediation** — once a merchant sees the source (Amazon UAE) and our margin, they may try to go direct.
3. **Trust asymmetry** — the merchant's brand takes the customer complaint, but *we* control fulfillment quality; a bad delivery burns the merchant, who then churns.
4. **Price transparency** — if the merchant can't set their own markup cleanly, they can't run a business on us.
5. **Support burden** — every merchant's customers become our indirect support load.
6. **Cash flow / credit** — merchants will want to collect from *their* customer and pay us later; that pushes working-capital and default risk onto us.
7. **Thin, undifferentiated middle** — if we're just a reseller API, a merchant can swap us for another.

## B3. The "rotations" — service-level designs that make merchants *want* us

The user's instruction is to *rotate* the solution until it's genuinely attractive to online businesses while protecting us. Below are the levers; the recommendation is to ship a **tiered model** that lets merchants self-select.

**Rotation 1 — Wholesaler mode vs. Agent mode (who owns disintermediation risk).**
- *Agent mode:* merchant sees full landed-cost breakdown, sets their own markup, we're a transparent utility. Attractive to sophisticated sellers; higher disintermediation risk.
- *Wholesaler mode:* we quote the merchant a single "delivered-to-Iran" price (source hidden, margin embedded); merchant marks up freely. Protects our sourcing IP; feels like a supplier, not a passthrough.
- **DECISION:** default new merchants to **Wholesaler mode**; unlock Agent-mode transparency at higher tiers/volume commitments. This directly defuses failure modes #2 and #4.

**Rotation 2 — White-label depth (defuses channel conflict + trust asymmetry).**
Three depths, sold as tiers:
- *Referral/Link* — merchant drops a co-branded link; we own the checkout and support. Lowest effort, lowest merchant control.
- *Embedded panel* — merchant logs into a branded dashboard, submits/monitors orders on behalf of their customers, sets markups, pulls status to relay. We stay invisible to the end-customer.
- *Full white-label storefront* — a paste-a-link PWA under the merchant's domain/brand, our engine underneath, our fulfillment, their face. Their customers never see us.
- **DECISION:** lead the sales motion with the **Embedded panel** (fast to ship, matches how Instagram sellers already work), offer **Full white-label** as the premium retention tier.

**Rotation 3 — Money model (defuses cash-flow/default risk).**
- *Prepaid wallet (default):* merchant tops up a wallet in IRR; each order debits it. Zero credit risk to us, working capital funded by them. This is the safe launch model.
- *Collected-by-merchant + escrow:* merchant collects from their customer via our co-branded checkout; funds settle to a held balance; we release margin to the merchant post-delivery. We control the money, merchant gets their cut, default risk contained.
- *Credit terms:* only for vetted, high-volume merchants with history and limits — an AI credit-scoring decision (see B5).
- **DECISION:** launch **prepaid wallet only**; introduce escrow-collected checkout in phase 2; credit strictly gated.

**Rotation 4 — Value beyond fulfillment (defuses "thin middle").**
Give merchants things they cannot easily replicate: real-time landed-cost calculators, a curated "safe to import" category catalog, marketing-ready product cards auto-generated in Persian, bulk-order tools, per-customer tracking pages under their brand, and analytics (bestsellers, margins, delivery SLAs). The more operational surface we own for them, the higher the switching cost.

**Rotation 5 — Segment targeting.** Not all merchants are equal. Prioritize sellers who already do cross-border volume and hate the ops (established Instagram import shops, category specialists in electronics/cosmetics/fashion). Avoid hobbyists — they generate support load and little GMV.

## B4. Positioning & monetization

**Positioning (CMO):** *"The cross-border fulfillment back-office for Iranian online stores — you sell, we source, pay, ship, and track, under your brand."* We are Shopify-for-cross-border-fulfillment, not a competitor storefront.

**Monetization stack:**
- Per-order platform margin embedded in wholesale price (primary).
- Optional SaaS subscription for panel/white-label tiers (predictable revenue, filters unserious merchants).
- FX spread (same treasury engine as consumer line).
- Value-added: insurance, express, consolidation, priority procurement.
- Float economics on prepaid wallets.

**MVP for Line 2 (BUILD):** merchant account + prepaid wallet + embedded panel (submit link → wholesale quote → pay from wallet → track) reusing the *exact same* resolution/quote/procurement/tracking engine as the consumer app, with a merchant-markup field and per-merchant branded tracking page. Everything else (white-label storefront, escrow checkout, credit, analytics) is fast-follow.

## B5. AI enhancements specific to Line 2

- **Auto-generated Persian product listings:** paste link → AI produces a marketing-ready title, description, spec bullets, and price card in Persian for the merchant to publish. Turns us from fulfillment utility into a *merchandising* tool.
- **Markup/margin advisor:** AI recommends a competitive resale price by category and observed market, so merchants price to sell.
- **AI credit scoring:** for credit-term eligibility, score merchants on wallet history, order defaults, volume, and dispute rate.
- **Merchant support copilot:** a Persian assistant inside the panel that answers "where is order X / why did the price change / is this category importable" so merchants self-serve and our support load stays flat as merchant count grows.
- **Demand signal aggregation:** across all merchants, the most-requested products become a data asset — informs a future stocked/pre-imported catalog and better freight consolidation.

---

# PART C — Business Line 3: Enterprise Import/Export Procurement

## C1. The idea, stated precisely

The same "checkout + track" spine, scaled up: importers, trading companies, and procurement departments place **large or recurring orders** through our platform, pay in IRR (or on terms), and get consolidated procurement, freight, customs handling, and unified tracking. Where the consumer buys one AirPods, the enterprise buys 200 units, or a mixed basket of components, or recurring supply.

## C2. Why it's different (and why not to treat it as "big consumer orders")

- **Unit economics invert:** high order value, low volume, long sales cycle, relationship-driven. HSPO matters less; *contract value and reliability* matter most.
- **Procurement source shifts:** enterprises often want wholesale/B2B suppliers (Amazon Business, Alibaba/1688, manufacturer direct, trade suppliers), not consumer marketplaces. Our Universal Adapter must extend to B2B catalogs and RFQ flows.
- **Compliance intensifies:** larger sums, customs/duty exposure, documentation (proforma, HS codes, certificates), and sanctions scrutiny scale up. This is a *heavier* legal gate, not a lighter one.
- **Payment shifts:** bigger foreign settlements, more banking friction, possible LC/trade-finance instruments.
- **Working capital balloons:** treasury float requirement is proportional to order size.

## C3. Rotations to make it viable and attractive

**Rotation A — Managed service, not self-serve, at first.** Enterprises don't paste-a-link; they send a spec/BOM. Sell a **managed procurement desk**: they submit a requirement, we source/quote/procure/ship, they track on a dashboard. Productize gradually.

**Rotation B — Quote-to-order (RFQ) workflow.** Replace instant-quote with a formal RFQ: requirement → sourcing options with landed-cost + lead-time → approval → procurement. This matches how procurement teams actually buy and lets AI compress the sourcing cycle (see C5).

**Rotation C — De-risk money with deposits + milestones.** Deposit on order, balance on shipment/receipt; or LC/trade-finance for vetted accounts. Never carry full enterprise float unsecured.

**Rotation D — Narrow the category/route first.** Pick one or two high-value, low-regulatory-risk import categories with clean customs treatment (e.g. specific electronics/components) and one corridor (UAE consolidation → Iran). Prove the operation before breadth.

**Rotation E — Tracking/consolidation as the wedge.** Even enterprises that source themselves struggle with fragmented multi-supplier freight visibility. A unified consolidation + tracking + customs-status dashboard is a sellable product on its own, and a low-compliance-risk entry point.

## C4. Positioning & sequencing

**Positioning:** *"Procurement and cross-border logistics, operated for you — one platform to source, pay, consolidate, clear, and track your imports."*

**Sequencing DECISION:** Line 3 is **highest value per account but highest compliance and working-capital intensity.** Treat it as **Phase 3+, not MVP.** Enter via the *lowest-risk wedge* (consolidation + tracking dashboard, or a single-category managed desk) once the consumer and merchant lines have proven procurement, treasury, and compliance foundations. Do not lead with it.

## C5. AI enhancements specific to Line 3

- **AI sourcing agent:** given a spec/BOM, search and compare suppliers across marketplaces/B2B catalogs, returning ranked landed-cost + lead-time options. This is where 2026 B2B procurement is heading — AI compressing RFx cycles from weeks to days.
- **HS-code & duty classifier:** AI proposes HS codes and estimates duty/customs cost from product descriptions (human-verified) — directly attacks the customs-estimation gap.
- **Document automation:** auto-draft proforma invoices, packing lists, and customs paperwork from order data.
- **Consolidation optimizer:** AI plans multi-supplier consolidation and freight batching to minimize volumetric cost.
- **Landed-cost + FX scenario modeling:** show the enterprise cost under FX bands and shipping modes so they can decide.

---

# PART D — Unified Platform Strategy & Positioning

## D1. The core thesis: one engine, three demand surfaces

The strategic unlock is that **B2C, merchant-B2B, and enterprise import are not three products — they are three front-ends on one shared spine.** Everything hard and defensible is shared:

```
        ┌──────────── DEMAND SURFACES ────────────┐
        │                                          │
   [Consumer PWA]   [Merchant Panel /       [Enterprise Desk /
    paste-a-link]    white-label store]      RFQ + tracking]
        │                 │                        │
        └───────┬─────────┴───────────┬────────────┘
                ▼                      ▼
        ┌─────────────── SHARED CORE ENGINE ───────────────┐
        │ Universal Resolver (API + vision-LLM)             │
        │ Quote / Landed-Cost Engine  ·  FX service         │
        │ Procurement (assisted → agentic → API)            │
        │ Foreign payment orchestration  ·  Treasury        │
        │ Ledger · Reconciliation                           │
        │ Warehouse / multi-leg shipment / unified tracking │
        │ Ops-by-exception console  ·  Persian support AI   │
        │ Compliance & category allowlist                   │
        └───────────────────────────────────────────────────┘
```

**Implication for the build:** build the core once, correctly (as v0.1 already scopes it). The three business lines are then primarily **surface + policy + pricing** differences on top — a defensible reason to invest deeply in the engine now.

## D2. Positioning ladder (how we talk about ourselves, per audience)

- **To consumers:** "Paste any link from abroad. We buy it, ship it, and you track every step — in Toman, no card needed."
- **To online shops:** "The cross-border fulfillment back-office for your store — sell under your brand, we handle sourcing, payment, shipping, and tracking."
- **To enterprises:** "Your outsourced import desk — source, pay, consolidate, clear, and track, on one platform."
- **To AI shopping agents (new, 2026):** expose ACP/UCP endpoints so agents can discover and check out our catalog — a distribution channel that didn't exist in v0.1.

## D3. Sequencing — what to build, in what order

| Phase | Focus | New surface | Gates that must clear |
|---|---|---|---|
| **0.3 (now)** | Logistics & unit economics discovery | — | Real warehouse/freight data; basket-level Contribution Margin |
| **1 — Consumer MVP** | Link-first PWA, assisted+AI procurement | Consumer PWA | Foreign payment + compliance (🔴) for at least one route |
| **2 — Merchant Line** | Prepaid wallet + embedded panel (reuses engine) | Merchant panel | Merchant T&Cs, wallet accounting, per-merchant tracking |
| **2.5 — Agentic upgrades** | Vision resolver, exception AI, Persian support, agentic-supervised procurement per category | — | Measured STP/HSPO thresholds per category/price band |
| **3 — White-label + Escrow** | Full branded storefronts, collected-checkout escrow, merchant analytics + AI listings | White-label store | Escrow/settlement model, credit policy |
| **4 — Enterprise wedge** | Consolidation+tracking dashboard, single-category managed desk | Enterprise desk | Heavier customs/trade compliance, working-capital/trade-finance |
| **5 — Agentic distribution** | ACP/UCP endpoints, AI-agent checkout channel | Agent channel | Protocol + compliance feasibility |

**DECISION D3:** Ship consumer first, merchant second (fastest incremental revenue on shared engine), enterprise last (highest gate load). Layer AI upgrades continuously rather than as a separate phase.

## D4. What is shared vs. per-line (avoid rebuilding)

- **Build once (shared):** resolver, quote/landed-cost, FX, procurement execution, payment orchestration, treasury, ledger, reconciliation, warehouse/shipment/tracking, ops console, compliance/allowlist, Persian support AI.
- **Per-line (thin):** onboarding + identity (consumer vs merchant vs enterprise), pricing/markup policy, money model (direct pay vs wallet vs escrow vs terms), UI surface, SLA tier, support tier.

This is the argument for spending on the engine now: three revenue lines amortize one build.

## D5. Metrics that matter, per line

- **Consumer:** CAC, resolution success rate, quote acceptance, checkout conversion, Contribution Margin/order, on-time delivery, repeat rate, STP, HSPO.
- **Merchant:** activated merchants, merchant-GMV, wallet top-up frequency, orders/merchant, merchant churn, per-merchant contribution, support tickets per 100 orders (must stay flat as merchants grow — the AI-support test).
- **Enterprise:** pipeline value, win rate, average contract value, gross margin/contract, procurement lead-time, reconciliation match rate, working-capital days.
- **Cross-cutting north stars:** Contribution Margin per Order and STP. Everything else is diagnostic.

## D6. The moat, restated

The defensibility is **not** the AI (competitors get the same models) and **not** the website. It is the compound of: a **compliant** foreign-payment + treasury operation, **real logistics data** that makes our landed-cost estimates tighter than anyone's (a data flywheel: every delivered order sharpens the weight/customs model), the **lowest HSPO/highest STP** operation via AI-supervised procurement, and **trust infrastructure** that turns first-time buyers into repeat buyers and merchants into a distribution army. AI is the *lever*; the operation and the data are the *moat*.

## D7. Overall recommendation

**Preliminary GO — expand the vision, protect the sequence.**
1. The consumer MVP remains **GO with constraints**; 2026 AI strengthens it (procurement, resolution, support, ops) without touching the three hard gates (foreign payment, customs, compliance). Prioritize the Phase 0.3 logistics discovery and real unit economics **before** implementation — unchanged from v0.1.
2. The **Merchant Fulfillment Platform is the highest-leverage expansion**: it reuses the engine, converts competitors into distribution, funds working capital via prepaid wallets, and is the fastest incremental revenue. Launch it in **Wholesaler mode + embedded panel + prepaid wallet**, then layer white-label and escrow. **This should be an explicit part of the product roadmap now**, even though it ships after the consumer MVP.
3. **Enterprise import/export is real but deferred** — highest value per account, highest compliance and working-capital load. Enter through the low-risk **consolidation+tracking / single-category managed-desk** wedge in a later phase; do not let it pull the roadmap forward.
4. **AI is the operating substrate, not a feature.** Fund the Universal Resolver, the landed-cost predictor, the procurement copilot, and the Persian support/trust layer as core infrastructure.
5. **The gates that decide everything are still exogenous:** compliant foreign payment, customs/importability, and legal/sanctions compliance. No amount of AI moves them. Resolve them per route before scaling any line.

---

## Appendix — 2026 AI capability map (quick reference)

| Layer | AI capability (2026) | Maturity | Our use |
|---|---|---|---|
| Product resolution | Vision-LLM structured extraction | Production | Universal adapter fallback |
| Pricing | Weight/volumetric + customs prediction | Emerging (needs our data) | Landed-cost accuracy |
| Procurement | Supervised browser/computer-use agents (~80–89%) | Production w/ oversight | Assisted procurement copilot |
| Distribution | ACP (OpenAI/Stripe), UCP (Google) | Live 2025–26 | Expose checkout to AI agents |
| Support/trust | Persian LLM (needs fine-tuning) | Gap — build | Quote explainer, proactive status, support copilot |
| Ops | Exception classification/ranking | Production | AI-ranked ops queue |
| Finance | Fuzzy reconciliation matching | Production | Auto-match >99% (deterministic ledger) |
| Enterprise sourcing | AI RFx / sourcing agents, HS-code classify | Emerging | Enterprise procurement desk |

## Sources

- [11 Best AI Browser Agents in 2026 — Firecrawl](https://www.firecrawl.dev/blog/best-browser-agents)
- [Agentic Commerce 2026 — Invisible Technologies](https://invisibletech.ai/blog/agentic-commerce-2026)
- [The Agentic Commerce Radar — commercetools](https://commercetools.com/blog/the-agentic-commerce-radar-key-market-shifts-insights)
- [Google UCP: Merchant Guide to Agentic Commerce — commercetools](https://commercetools.com/blog/google-ucp-merchant-guide-to-agentic-commerce)
- [UCP vs ACP in 2026: A Technical Comparison — DEV Community](https://dev.to/ucptools/ucp-vs-acp-in-2026-a-technical-comparison-of-ai-commerce-protocols-50j7)
- [Amazon Business Ordering API overview](https://amazon-business-group-2.readme.io/docs/ordering-api)
- [Introducing the Orders API v2026-01-01 — Amazon SP-API](https://developer-docs.amazon.com/sp-api/changelog/new-introducing-the-orders-api-v2026-01-01)
- [Using LLMs for Extraction and Normalization of Product Attribute Values — ADBIS](https://dl.acm.org/doi/10.1007/978-3-031-70626-4_15)
- [E-commerce LLM Guide for 2026 — Fyresite](https://www.fyresite.com/e-commerce-llm-guide-use-cases-implementation/)
- [Fine-Tuning a Large Language Model for Persian — AHD Co (Medium)](https://medium.com/@info.ahdsoft/fine-tuning-a-large-language-model-for-persian-our-companys-journey-20aedcc9c13f)
- [B2B ecommerce pulse: AI agents, marketplace expansion — MarketScale](https://www.marketscale.com/industries/retail/b2b-ecommerce-pulse-ai-agents-marketplace-expansion-and-digital-investment-drive-mid-2026-momentum)
- [How Modern B2B Procurement Platforms Transform Global Sourcing in 2026 — LooperBuy](https://looperbuy.com/blog/how-modern-b2b-procurement-platforms-transform-global-sourcing-in-2026.html)
- [Top 10 eCommerce Fulfillment Companies in 2026 — CS-Cart](https://www.cs-cart.com/blog/fulfillment-companies/)
