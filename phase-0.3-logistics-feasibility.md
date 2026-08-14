# Phase 0.3 — Logistics & Fulfillment Feasibility

## Cross-Border Assisted Commerce Platform — v0.3

**Document status:** Phase 0.3 — Logistics & fulfillment discovery + fulfillment-model design
**Builds on:** v0.1 (Phase 0 feasibility) and v0.2 (AI revalidation + business-line expansion)
**Companion file:** `Logistics-Economics-v0.3.xlsx` (live break-even calculator + route/model matrices)
**Date:** August 2026
**Author lens:** Business Assessor · COO/Logistics · CPO · CEO · Founder
**Reading note:** Actionable, not narrative. **DECISION** = recommendation, **GATE** = must-validate, **BUILD** = to construct, **RULE** = an operating policy to enforce in the product.

---

## 1. What this document decides

v0.2 named logistics as the #1 open discovery priority. This document answers four questions:

1. **When does an order make economic sense to fulfill ourselves?** (Section 2 — the break-even truth, with a live model.)
2. **What fulfillment architecture do we run**, decomposed into legs and delivery points? (Sections 3–4.)
3. **How do we make the service modular** so online shops can take only the legs they need — including "just deliver to us, we do our own last mile" and a gig-style ("Uber/Snapp") delivery layer? (Sections 5, 7.)
4. **Can the Payrafi/hawala "delegated-agent" pattern and traveler crowdshipping become a real feature** — and where? (Section 6.)

Then it fills the **Route Feasibility Matrix** (Section 8) and states the **best starting position** (Section 9).

The central finding up front: **logistics feasibility is not a yes/no about a route — it is a function of value-density (product value ÷ chargeable weight), route distance, and order consolidation.** Your instinct is correct and the model proves it: a $100 product from Japan is a bad order; the same $100 product from the UAE is fine; and a $900 watch is fine *even from Japan*. We therefore do not "support routes" — we **gate orders** on economics and pick the route/model that widens the viable zone.

---

## 2. The economic reality — the break-even truth

### 2.1 The one ratio that governs everything

Define **Logistics Overhead Ratio** = (international freight + source handling + last-mile + insurance) ÷ product value.
Below a **viability threshold** (~25% in the model), the order is healthy. Above it, we are shipping cheap heavy air — burning margin or scaring the customer with a price that is mostly shipping.

Freight scales with **chargeable weight** = max(actual, volumetric). So overhead rises with distance (rate per kg) and weight, and falls with product value. That gives three levers and one law:

> **RULE (value-density gate):** value-density beats proximity. A light, expensive item is viable from far away; a heavy, cheap item is uneconomic even from next door.

### 2.2 The numbers (from `Logistics-Economics-v0.3.xlsx`, illustrative rates pending real quotes)

Representative orders, blended door-to-door estimates:

| Order | Route | Value | Weight | Overhead % | Verdict |
|---|---|---|---|---|---|
| AirPods | UAE | $250 | 0.5 kg | 7.6% | **Viable** |
| $100 gadget | UAE | $100 | 1.0 kg | 19.0% | **Viable** |
| $100 gadget | **Japan** | $100 | 1.0 kg | **29.0%** | **Weak** |
| $100 gadget | Japan | $100 | 3.0 kg | 61.0% | **Weak** |
| Cosmetics basket | Turkey | $180 | 1.5 kg | 13.9% | Viable |
| Laptop | Germany | $1,400 | 2.2 kg | 4.7% | Viable |
| Sneakers (bulky) | UK | $130 | 1.8 kg | 28.5% | Weak |
| Watch (value-dense) | **Japan** | $900 | 0.4 kg | **3.9%** | **Viable** |

**Minimum viable product value** (price a product must exceed to be economic), by route × weight:

| Route \ Weight | 0.5 kg | 1.0 kg | 2.0 kg | 3.0 kg | 5.0 kg |
|---|---|---|---|---|---|
| UAE | $61 | $74 | $100 | $126 | $178 |
| Turkey | $63 | $78 | $109 | $139 | $200 |
| Germany | $74 | $100 | $152 | $204 | $309 |
| UK | $76 | $104 | $161 | $217 | $330 |
| **Japan** | $83 | **$117** | $187 | $257 | $396 |

The Japan/1.0 kg cell is **$117** — a $100 item does not clear it. The UAE/1.0 kg cell is **$74** — the same item clears comfortably. This is the whole thesis in two cells.

### 2.3 Operating rules this produces (enforce in the product)

- **RULE (minimum order value):** the quote engine reads the min-viable-value cell for the order's route+weight and either (a) blocks the order, (b) suggests consolidation with other items, or (c) surfaces a "logistics-heavy — consider a pickup point" nudge.
- **RULE (category allowlist by density):** launch categories should be **high-value, low-weight, low-volume**: electronics/gadgets, cosmetics/fragrance, watches, jewelry, accessories, premium fashion (non-bulky). Defer bulky/heavy/low-value (shoes in volume, home goods, large appliances) until a heavy-freight lane exists.
- **RULE (consolidation is a margin tool, not a convenience):** consolidation can cut per-parcel cost up to ~80% by combining chargeable weight and amortizing handling. It is the single biggest lever to move "weak" orders into "viable." Build consolidation windows into the flow.
- **RULE (route follows economics):** prefer the **nearest capable hub** (UAE, Turkey) as the default source-country consolidation point regardless of where the item is *listed*, because rate/kg dominates. Far marketplaces (DE/UK/Japan) are only worth it for value-dense items.

---

## 3. The fulfillment stack, decomposed

Cross-border fulfillment is not one shipment; it is a chain of **legs** connected by **delivery/handoff points**. Naming them explicitly is what lets us (a) price each leg, (b) let merchants take only some legs, and (c) swap providers per leg.

```
 [1] SOURCE INTAKE POINT            (marketplace ships here)
        warehouse / forwarder address / partner shop in source country
              │  Leg A: marketplace → source intake
              ▼
 [2] SOURCE CONSOLIDATION HUB       (repack, weigh, photo, consolidate, docs)
              │  Leg B: international freight (the expensive leg)
              ▼
 [3] IRAN ARRIVAL / CUSTOMS HUB     (clearance, sort)
              │  Leg C: domestic line-haul
              ▼
 [4] IRAN CITY NODE / PICKUP POINT  (optional out-of-home point)
              │  Leg D: last-mile (gig courier) OR customer self-collect
              ▼
 [5] CUSTOMER  (or the merchant, if they do their own last mile)
```

**Delivery points exist at three tiers**, exactly as you framed it:
- **Source-country points** — where goods are received/consolidated abroad (the forwarder warehouse, and optionally partner shops/travelers as intake).
- **Iran arrival + city nodes** — the customs/sort hub and optional neighborhood pickup points (partner shops/lockers).
- **Destination** — the customer's door via gig last-mile, or the customer/merchant collecting from a point.

**DECISION (asset-light):** we **own the orchestration and data** (which point, which leg, which provider, unified tracking) but **rent the physical assets** (forwarder warehouses, freight carriers, Iran gig last-mile) at launch. Owning warehouses/fleet is a scale-phase decision, not an MVP one (see model E).

---

## 4. Five international best-practice archetypes

Each is a real, proven model abroad. We score them for *launch fit* (full grid in the xlsx "Fulfillment Model Comparison" tab).

### Model A — Integrated forwarder + gig last-mile ★ RECOMMENDED START
**International analogue:** MyUS / Shipito / Borderlinx (source-country address → consolidation → reship) stitched to on-demand last-mile.
**How it maps to us:** rent a source-country address/warehouse (UAE first) that receives marketplace parcels, consolidates/repacks/photographs, ships one consolidated parcel to an Iran hub, then hands to **AloPeyk / Snapp Box / Miare** (Iran's existing 100k+ gig fleet) for the door.
**Economics:** consolidation up to ~80% cheaper; gig last-mile ~$3-equivalent/drop; no warehouse capex.
**Pros:** fastest to launch, asset-light, uses mature infrastructure on both ends, gives us unified tracking data (the moat).
**Cons:** dependent on partner SLAs; margin shared with providers.
**Compliance:** cleanest of the five — standard forwarding + domestic courier.
**Fit: 5/5 for MVP.**

### Model B — PUDO / pickup-point network (out-of-home)
**International analogue:** InPost lockers, DPD/Evri pickup points, Geopost OOH — Europe had ~646k out-of-home points by 2025; OOH is ~25% cheaper than home delivery and cuts returns cost up to ~60%.
**How it maps to us:** offer **collect-from-point** as a cheaper delivery option in Iran — partner shops/kiosks as pickup points (asset-light) before any lockers. Directly attacks the "weak" orders: a bulky/low-value item becomes viable if we skip door last-mile.
**Pros:** meaningful unit-cost reduction; reduces failed deliveries; natural fit for merchants who want customers to collect.
**Cons:** requires a partner-point network and customer willingness to travel.
**Compliance:** low risk.
**Fit: 4/5 — add as a delivery *option*, phase 2.**

### Model C — Crowdshipping / traveler ("Uber for cross-border delivery")
**International analogue:** **Grabr** — a P2P marketplace where shoppers post a wanted item and **travelers** heading their way buy and hand-carry it, earning ~15-20% of item value, protected by **escrow** released on delivery; ~75 countries.
**How it maps to us:** a **traveler layer** for the international leg (source → Iran) — vetted travelers carry high-value/low-weight items in luggage; we handle discovery, escrow, and tracking. This is your "Uber/Snapp for delivering," applied to the *cross-border* hop rather than the domestic one (which AloPeyk/Snapp already solve).
**Economics:** can beat formal freight for value-dense items and avoids some freight overhead; but capacity is lumpy and trust/verification cost is real.
**Pros:** asset-light, flexible, great for the exact items that are most viable (watches, electronics), builds a differentiated network.
**Cons:** reliability/liability/authenticity risk; **customs exposure** (personal-import limits, undeclared goods) is the sharp edge; hard to scale predictably.
**Compliance:** medium-high risk — must stay within personal-import rules and declare properly; never a vehicle for undeclared value.
**Fit: 3/5 — pilot as a *supplementary* channel, not the backbone.**

### Model D — Hawala / Payrafi "delegated-agent" pattern applied to goods
**What Payrafi/hawala does (money):** you pay in the source country to an operator; a networked agent (a "gate") **pays out at the destination**; the two operators settle later by netting. No money crosses the border per transaction; it runs on trust and a distributed agent network.
**The goods analogue you proposed:** a customer/business pays us (or hands goods) in the source country to a person/agent; a **destination agent delivers the equivalent goods** to the recipient; agents reconcile inventory/flows later. Effectively a **"goods gate" network** — a distributed set of local agents holding buffer stock or capacity on each side.
**Where it is powerful:** for **fungible or pre-stocked items** and for **speed** — if a destination agent already holds the item (or an equivalent), the customer gets it *immediately* while the physical replenishment happens asynchronously in the background (exactly how hawala decouples payout from settlement). This is a genuinely differentiated capability for popular SKUs.
**The hard constraints (be explicit):**
- **Compliance:** hawala-style *value* transfer is regulated money transmission and is illegal unlicensed. **RULE: our version must move *goods*, never net value across borders.** The moment agents settle cross-border cash imbalances, it becomes an informal value-transfer system and a sanctions/AML problem. Keep it goods-only, keep settlement *within* each jurisdiction, keep records.
- **Inventory risk:** decoupling delivery from procurement means someone carries stock/float — that is working capital and shrinkage risk on the goods side.
- **Authenticity/quality:** delivering an "equivalent" item requires SKU-level equivalence guarantees.
**Fit: 2/5 as a general model, but 4/5 as a narrow "instant delivery for pre-stocked hero SKUs" feature** layered on Model A once volume reveals which SKUs repeat.

### Model E — Own warehouses + own fleet
Best eventual unit cost and control, but heavy capex and slow. **DECISION: defer to scale phase.** Do not build for MVP.

---

## 5. Modular fulfillment — the "leg toolkit" for merchants

Your point that online shops "may want us to just deliver to their destination and do their own last mile" is the design principle for the whole B2B offer. **We sell legs, not one bundle.** A merchant assembles the chain they need:

| Package | Legs we run | Handoff point | Who does last mile | Buyer type |
|---|---|---|---|---|
| **Full to-door** | A → B → C → D | Customer's door | Us (gig) | Consumer app; hands-off merchants |
| **To-merchant** | A → B → C | Iran hub / merchant address | **Merchant** | Shops with their own courier/store |
| **To-pickup-point** | A → B → C → point | City pickup point | Customer collects | Price-sensitive orders; bulky items |
| **Freight-only** | A → B | Iran arrival/customs | Merchant clears+delivers | Sophisticated importers |
| **Consolidation-only** | A + hold | Source hub | Merchant books own freight | Merchants with freight contracts |

- **RULE (price per leg):** each leg is separately priced so a merchant taking fewer legs pays less — this is *why* they choose us over doing it all themselves, and it removes the "thin middle" risk from v0.2.
- **BUILD:** a merchant "fulfillment configurator" in the panel: pick source hub, consolidation window, handoff point, last-mile option → get a per-leg quote. Same engine, exposed as options.
- **Benefit:** merchants who already have offline/manual last-mile (most Instagram shops do) buy exactly the expensive-and-hard part (source procurement + international leg + customs) and keep the part they're good at (local delivery + customer relationship).

---

## 6. Rotating the Payrafi/crowdship idea into something we can actually run

You asked to rotate these until they're both attractive and safe. Here are the viable rotations, ordered by how soon we can run them:

**Rotation 1 — Traveler intake as a *first-leg* option (not the whole chain).** Instead of travelers carrying door-to-door (fragile, unscalable), use travelers only for **Leg B (source hub → Iran hub)** on value-dense items, feeding into our normal customs + gig last-mile. This contains the risk to one leg and keeps unified tracking intact. Escrow released on hub scan-in, not on personal handoff.

**Rotation 2 — Agent "gates" as delivery/pickup points, not money gates.** Adopt hawala's *network* idea but for **physical handoff**: recruit local agents (shops, individuals) as **source-country intake points** and **Iran pickup points**. They receive/hold/hand-off goods for a per-parcel fee. This is PUDO built the Payrafi way — a distributed, low-capex point network — with **zero value-transfer exposure** because they only ever touch goods, and are paid domestically.

**Rotation 3 — "Instant delivery" for hero SKUs (the hawala decoupling, goods-only).** For the top repeat SKUs, pre-position stock with Iran agents so the customer receives *immediately* while replenishment flows asynchronously. This is the most differentiated feature — but it is inventory-and-compliance heavy, so it is a **phase-3+ upgrade** gated on (a) SKU repeat data from Model A and (b) legal sign-off that we are stocking/importing goods normally, not running value transfer.

**Rotation 4 — Trust rails borrowed from Grabr/hawala.** Whatever the physical model, copy the two things that make these networks work: **escrow** (money released only on verified delivery/scan) and **reputation** (agent/traveler ratings, verification, limits). These are product features we build once and reuse across travelers, agents, and pickup points.

**Compliance guardrails (non-negotiable, RULE):** goods only; never net cross-border cash; settle agents domestically; declare customs properly; enforce personal-import limits on travelers; full audit trail. This keeps us on the right side of the v0.1 compliance gate and out of informal-value-transfer territory.

---

## 7. The gig "Uber/Snapp for delivery" layer

Two separate things are often conflated; keep them apart:

- **Domestic last-mile in Iran is already solved by gig platforms.** AloPeyk (100k+ motorcycle/car/van fleet across Tehran, Karaj, Shiraz, Mashhad), Snapp Box, and Miare are exactly "Uber/Snapp for delivery." **DECISION: integrate them as our Leg-D providers; do not build a fleet.** We get on-demand door delivery with zero capex and an API-style handoff.
- **The cross-border traveler network is the genuinely new "Uber-like" layer** (Model C / Rotation 1) — matching travelers to the international leg. This is where a marketplace/gig design is novel for us, and where escrow + reputation matter most. Treat it as an optional capacity source, measured against formal freight per shipment.

**BUILD:** a provider-abstraction for last-mile (like the FX/store-adapter pattern) so the system picks AloPeyk vs Snapp Box vs pickup-point vs traveler by cost/SLA/coverage per order.

---

## 8. Route Feasibility Matrix (reasoned; revalidate with real quotes)

Scores 1 (poor) – 5 (excellent); weighted total in the xlsx "Route Feasibility Matrix" tab. Weights in parentheses.

| Dimension (weight) | UAE | Turkey | Germany | UK |
|---|:--:|:--:|:--:|:--:|
| Freight cost / proximity (20%) | 5 | 4 | 2 | 2 |
| Forwarder / warehouse maturity (15%) | 5 | 4 | 4 | 4 |
| Procurement automation — marketplace (15%) | 3 | 3 | 4 | 4 |
| Foreign payment feasibility (15%) | 4 | 4 | 3 | 3 |
| Customs / route reliability to Iran (15%) | 4 | 4 | 3 | 3 |
| Product availability / catalog (10%) | 4 | 3 | 5 | 5 |
| Compliance / sanctions exposure (10%) | 3 | 4 | 3 | 3 |
| **Weighted total** | **≈4.1** | **≈3.8** | **≈3.3** | **≈3.3** |

**Read:** **UAE wins as the beachhead** on proximity, forwarder maturity, payment, and customs reliability. **Turkey is the strong #2** and a natural second lane (and better on some compliance dimensions). Germany/UK only justify themselves for **value-dense catalog** items that Turkey/UAE can't source — treat them as *catalog-extension* routes, not primary lanes.

---

## 9. Best starting position — the recommendation

**DECISION (beachhead operating model):**

1. **Route:** launch **UAE (Dubai) → Iran** as the single beachhead lane. Add **Turkey** as lane #2 once the first lane is stable. DE/UK only as value-dense catalog extensions.
2. **Fulfillment model:** **Model A — asset-light integrated forwarder + gig last-mile.** Rent a UAE consolidation address/warehouse (partner or forwarder-as-a-service), consolidate/repack/photograph, one freight leg to an Iran hub, hand to AloPeyk/Snapp Box for the door. Own the orchestration + tracking data; rent the metal.
3. **Delivery-point network (phased):** start with **one source hub (UAE) + one Iran arrival/sort hub + gig last-mile.** Add **partner pickup points** (Rotation 2) as the cheaper delivery option in phase 2. Lockers and owned warehouses are scale-phase.
4. **Category allowlist:** high-value, low-weight only at launch (electronics, cosmetics/fragrance, watches, accessories, premium non-bulky fashion). Enforce the **minimum-order-value gate** from the model.
5. **Modular B2B from day one of the merchant line:** sell legs, not a bundle — "to-door," "to-merchant," "to-pickup-point," "freight-only," "consolidation-only" — priced per leg, via the panel configurator.
6. **Crowdship/traveler + hawala-style features are pilots, not foundations:** traveler layer as an *optional Leg-B* for value-dense items (Rotation 1); agent "gates" as *physical* pickup/intake points (Rotation 2); "instant delivery for hero SKUs" as a phase-3 upgrade (Rotation 3) — all under strict goods-only, no-value-transfer compliance rules.
7. **Consolidation is a first-class feature,** not an afterthought — it is the lever that turns "weak" orders "viable."

**Why this is the right starting point:** it maximizes the viable-order zone (nearest cheap lane + value-dense catalog + consolidation), minimizes capex and compliance exposure (rent assets, goods-only), reuses infrastructure that already exists on both ends (UAE forwarders, Iran gig fleets), and still lets us layer the differentiated networks (travelers, agent gates, instant-SKU) *after* real data tells us where they pay off.

---

## 10. Open gates / next discovery (Phase 0.4)

- **GATE (real freight quotes):** replace the illustrative $/kg rates with actual UAE→Iran and Turkey→Iran forwarder quotes, incl. volumetric rules, fuel surcharges, and consolidation pricing. Re-run the model.
- **GATE (customs):** validate duty/clearance cost and restricted categories per route — the largest remaining unknown in landed cost.
- **GATE (source-hub partner):** identify a UAE forwarder/warehouse offering receiving events, weight capture, package photos, consolidation, and an API/webhook (needed for unified tracking).
- **GATE (Iran last-mile integration):** confirm AloPeyk/Snapp Box coverage, pricing, and integration path in target cities.
- **GATE (traveler/agent legal):** legal review of the traveler and agent-gate models against personal-import and money-transmission rules before any pilot.
- **NEXT after this:** basket-level Contribution Margin modeling per category using real rates (v0.2 §62), then the Phase 0 launch-route decision.

---

## 11. Sources

- [MyUS — Shipping & Consolidation FAQ](https://www.myus.com/faq/shipping-consolidation/) · [MyUS vs Shipito 2026](https://www.myus.com/blog/myus-vs-shipito/) · [Shipito Pricing](https://www.shipito.com/en/shipito-pricing)
- [Grabr — international P2P delivery](https://grabr.io/en/) · [Grabr launches P2P marketplace — TechCrunch](https://techcrunch.com/2016/07/19/grabr-launches-peer-to-peer-marketplace-for-international-shipping/)
- [Informal value transfer system (hawala) — Wikipedia](https://en.wikipedia.org/wiki/Informal_value_transfer_system) · [What is hawala — usehawala](https://usehawala.com/learn/what-is-hawala) · [Hawala regulation — US OJP](https://www.ojp.gov/ncjrs/virtual-library/abstracts/hawala-and-other-informal-value-transfer-systems-how-regulate-them)
- [AloPeyk — Wikipedia](https://en.wikipedia.org/wiki/AloPeyk) · [Snapp Box](https://www.linkedin.com/company/snappbox)
- [Air Freight Cost per Kg 2026 — Suaid Global](https://suaidglobal.com/insights/air-freight-cost-per-kg/) · [Air Freight Rates Guide — FreightAmigo](https://www.freightamigo.com/en/blog/logistics/air-freight-rates-and-costs/)
- [Out-of-Home Delivery Europe: PUDO & Lockers 2026 — Zineps](https://www.zineps.com/blog/out-of-home-delivery-europe-pudo-parcel-lockers-2026) · [The PUDO Economy — Parcel Perform](https://www.parcelperform.com/insights/pudo-economy-margin-defense)

*Freight/handling/last-mile figures in the model are illustrative placeholders for revalidation with real quotes; conclusions depend on the relationships (value-density, distance, consolidation), not the exact numbers.*
