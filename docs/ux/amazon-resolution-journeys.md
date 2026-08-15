# Amazon Resolution Journeys

> Phase 4 of `docs/program/MASTER-PROMPT.md`. Expands J1 (paste → resolve → confirm) and the front half of J2 (quote) from `docs/ux/journey-map.md` into the PDP archetypes MASTER-PROMPT §PHASE 4 names. Data model: `docs/product/product-resolution.md`. Mechanics: `docs/architecture/product-resolution-architecture.md`.
>
> **Governing objective (MASTER-PROMPT):** not to clone Amazon visually, but to resolve the product faithfully enough that (1) the customer recognizes exactly what they requested, and (2) deterministic pricing receives normalized trustworthy data. Every decision below serves one of those two.

## What exists today

One screen carries the whole flow (`apps/web/app/page.tsx:10-16` — "the link *is* the interface"). Current states: idle → `resolving` (spinner + skeleton, `page.tsx:112-118,132`) → resolved card (`ProductCard`) → optional `NEEDS_REVIEW` warning (`page.tsx:138-143`) → unavailable block (`page.tsx:145-147`) → quantity + quote.

`ProductCard.tsx` already implements the honest-provenance principle: a `وزن برآوردی` ("estimated weight") badge appears when `provenance.weightKg.confidence < 0.7` (`ProductCard.tsx:14-15,43-47`), with the rationale in its own docstring — "an estimated weight drives the freight figure, and a customer who was told the number might move is a customer who is not surprised later."

**Two things follow from that, and they shape everything below:**

1. **A confidence *band* already exists in the UI** (0.7), distinct from the pipeline's escalation floor (0.5). The "customer confirmation" rung MASTER-PROMPT asks for is therefore not a new concept to introduce — it's an existing pattern to generalize from one field (weight) to the fields that need it. This confirms the recommendation in `product-resolution.md` that confirmation belongs in the frontend, not as a fifth pipeline tier.
2. **Provenance is currently surfaced for exactly one field.** Every other soft field (price, availability, seller, category) resolves silently regardless of confidence. That's the main UX gap of this phase.

## Cross-cutting rules

- **Confirmed vs. inferred must be visually distinguishable per field**, not per record. A record-level "some info is uncertain" banner (today's `NEEDS_REVIEW` copy, `page.tsx:140-142`) tells the customer something is soft without telling them *what* — which is closer to anxiety than to informed consent. Extend the existing badge pattern instead.
- **Never fabricate** price, variation, availability, shipping, seller, or delivery estimate. Structurally enforced already (see architecture doc); the UI's job is to not *undo* that by rendering a default as if it were a fact. Concrete hazard: `assemble` defaults missing weight to 1kg and missing seller to `'Unknown'` (`resolution.ts:281,287-289`) — the UI must not present either as observed data.
- **Keep the journey usable when data is missing.** Degrade to confirmation or review; never a dead end without a reason (J1's terminal-states row).
- **Persian-first, RTL, mobile-first**; URLs and seller names render LTR inside RTL text (existing `dir="ltr"` / `.ltr` usage, `page.tsx:90,122`).
- **Only `amazon.ae` is enabled** (`marketplace.ts:88`); other descriptors exist but are `enabled: false`, and `MarketplaceRegistry.match` returns nothing for them (`marketplace.ts:157`). The UI already says so (`page.tsx:121-123`).

---

## Archetype 1 — Simple product (single SKU, in stock, sold and fulfilled by Amazon)

The baseline. Ladder resolves at `api` or `structured`; all required fields clear the floor; status `RESOLVED`.

**UX:** product card (image, title, brand, seller, price, `موجود` badge) → quantity → quote. No confirmation interstitial — asking a customer to confirm high-confidence data trains them to click through prompts that matter. **Ships today.**

## Archetype 2 — Product with variations (colour / size)

Confirmed real on Amazon UAE: listings carry compound variation state in the title itself (e.g. a Ray-Ban listing rendered as "…Color: Silver/Blue Photochromic, Size: 58 mm"), and two-axis colour+size is the common shape.

**The problem:** a pasted `/dp/<ASIN>` URL points at *one* variant. `ResolvedProduct.variant` records the selected one (`types.ts:17`) but there is no `selectableVariations` field, so the UI cannot offer alternatives, and the customer cannot tell whether the variant they're being quoted is the one they meant.

**UX:**
- Always render the resolved variant explicitly as its own labelled line ("رنگ: نقره‌ای/آبی · اندازه: ۵۸ میلی‌متر"), never folded silently into the title. Recognition is objective (1) of this phase.
- When `selectableVariations` exists (post-implementation), offer a picker. Changing a variant is a **new resolution** against that variant's ASIN, not a local edit — different variants are different ASINs with different prices, availability, and weights, and mutating the record client-side would decouple the displayed product from the priced one.
- Until then: show the resolved variant prominently plus a link to the source page so the customer can self-verify. Honest and cheap; not a substitute for the picker.

**Priority:** high — this is the most common way a customer ends up quoted for the wrong item.

## Archetype 3 — Multiple sellers (Buy Box + "Other sellers on Amazon")

Confirmed real: listings expose a panel with a seller count and starting price (e.g. "Other sellers on Amazon · New (7) from AED262.42").

**Decision:** resolve to **one** offer — the authoritative/lowest-risk one, normally the Buy Box — and keep `ResolvedProduct.seller` singular. The quote engine must never reason about which offer it's pricing (see architecture doc §3). Offer-set logic stays inside the strategy layer.

**UX:** show the seller plainly (already does, `ProductCard.tsx:31`). Do **not** surface a seller picker at MVP — that is a marketplace-browsing affordance, and the link-first RULE (`CLAUDE.md`: no catalog, search, or merchandising) cuts against it. If the resolved offer's seller differs from what the customer saw when they copied the link, that surfaces later as a price difference at checkout revalidation, which the existing revalidate-at-checkout RULE already handles.

## Archetype 4 — Discounted product

Site-wide events are real on Amazon UAE (Mega Sale "up to 50% off", White Friday "up to 70% off"), and PDPs show a strikethrough original price alongside the current one.

**The problem:** the model has only final `price`. The discount signal — genuinely useful for trust and for the customer's own recognition ("yes, this is the deal I found") — is discarded.

**UX (post-`originalPrice`/`discountPercent`):** show the original price struck through beside the current price, in **AED** at the product level, with the Toman landed cost remaining the single headline number at the quote step. Do not translate a marketplace discount into a Toman "you saved X" claim — FX and duty sit between the two, and a savings claim the customer can't reconcile against their final invoice damages the trust it was meant to build.

**Time-sensitivity, flagged:** a discounted price is more likely to move before procurement than a stable one. The existing `checkOffer` re-check at checkout and the max-procurement-price guard already cover this — no new mechanism, but discount-heavy orders are exactly the population where `PRICE_CHANGED` (J7) will concentrate.

## Archetype 5 — Unavailable product

Confirmed: Amazon UAE uses consistent copy — *"Currently unavailable. We don't know when or if this item will be back in stock."* — across categories, making it a stable extraction anchor alongside availability microdata.

**Today:** resolution succeeds, `available: false`, and the UI blocks with `این کالا در حال حاضر موجود نیست.` (`page.tsx:145-147`), correctly refusing to quote.

**Gaps:**
- **Missing availability is indistinguishable from confirmed unavailability.** `assemble` maps absent availability to `false` (`resolution.ts:286`) — safe for pricing, but the customer is told "not available" when the truth is "we couldn't confirm." Distinguish these: confirmed-unavailable → the current message; unconfirmed → "we couldn't confirm availability" plus a retry, since a resolution failure is not the product's fault.
- **Copy must differ from the post-purchase `OUT_OF_STOCK` exception.** Both mean "you won't get this," but pre-purchase is a browsing dead end while post-purchase (`ALERTS.OUT_OF_STOCK`, `order-state-machine.ts:222-229`) involves the customer's money and a refund. Reusing one string across both would be a real trust error.
- **No dead end:** offer "notify me if it returns" **or** an explicit "we can't fulfill this" close. Amazon's own copy admits it may never return, so a notify-me promise the platform can't keep is worse than a clean ending. Recommend the honest close at MVP, deferring notify-me until the notification system exists (itself a `journey-map.md` cross-cutting gap).

## Archetype 6 — Fulfillment party (FBA vs. seller-fulfilled)

**Naming correction, recorded:** MASTER-PROMPT says "Prime/FBA," but Amazon UAE doesn't market Prime the way amazon.com does. The real, load-bearing distinction is **Fulfilled by Amazon vs. seller-fulfilled** — different dispatch reliability and different lead-time variance, both of which feed the delivery estimate and the risk reserve.

**Today:** `seller` exists; `fulfillmentParty` does not, so the two are conflated.

**UX:** once modeled, show fulfillment as a small factual line, not a trust badge — "ارسال توسط آمازون" vs. "ارسال توسط فروشنده". This platform's own multi-leg logistics dominate total delivery time, so implying the marketplace's fulfillment choice determines the customer's delivery experience would overstate it. Its real use is internal: seller-fulfilled orders carry more dispatch variance and belong in the same risk-widening path as soft weight (`resolutionRiskFactor`).

## Archetype 7 — Shipping restrictions / ineligible items

Some categories can't be personally imported (hazmat, batteries above thresholds, restricted goods), and some are marketplace-restricted for export.

**Today: nothing models this.** No `eligibility`/`restrictions` field, no resolution-time check. An ineligible item resolves cleanly, quotes cleanly, and fails at customs — the worst possible discovery point, after the customer has paid.

**UX:** block at resolution with a specific reason ("این دسته از کالاها قابل واردات شخصی نیست") — never a generic failure, and never a successful quote. This is the one candidate among the new fields for `REQUIRED_FIELDS` membership, *if* the viability/compliance gate consumes it.

**Priority: high.** It's the archetype with the worst failure mode, it ties directly to the compliance RULE (`CLAUDE.md`: no path may depend on bypassing controls) and to I5's job (J14), and unlike the other gaps it cannot be mitigated later in the journey.

## Archetype 8 — Incomplete or ambiguous structured data

The pipeline's normal condition, not an edge case: `structured` tier throws when no JSON-LD `Product` node exists (`strategies.ts:127-129`); `extractWeightKg` returns `undefined` on an unrecognized unit (`strategies.ts:267`); vision confidences are capped (`strategies.ts:340-348`).

**Outcome mapping:**

| Outcome | Meaning | UX |
|---|---|---|
| `RESOLVED` | required fields present and confident | product card, proceed |
| `NEEDS_REVIEW` | product assembled, some required field soft/missing | card **+ per-field markers** + honest quote framing |
| `FAILED` | no title or no price — nothing to show | explicit failure + retry/alternatives (`page.tsx:38-42`) |

**Improve `NEEDS_REVIEW`:** today one generic banner naming weight as an example (`page.tsx:138-143`) fires regardless of which field is actually soft. Instead, mark each soft field where it appears — generalizing `ProductCard`'s existing weight badge — and let the banner summarize rather than speculate. `ResolutionOutcome.missingFields` (`types.ts:116`) already carries exactly this list to the frontend via `ProductRequestDto`, so **no new API data is needed** — this is a rendering change, not a contract change.

**Never render a default as an observation:** weight defaulting to 1kg and seller to `'Unknown'` (`resolution.ts:281,289`) are pricing-safety defaults, not facts. `'Unknown'` in particular currently reaches `ProductCard.tsx:31` and renders as if it were a seller name.

## Archetype 9 — Slow resolution / ladder exhaustion

Sandbox covers this: `SLOW_RESOLUTION` and `RESOLUTION_NEEDS_REVIEW` scenarios exist (`packages/sandbox/src/scenario.ts`).

**Empirically confirmed this pass:** six of seven live fetches to `amazon.ae` returned HTTP 503. Blocked fetches are a **routine operating condition**, not a rare failure — the `structured` and `vision` tiers both depend on `PageFetcher` reaching a page Amazon will serve.

**UX:** the current single spinner ("در حال بررسی کالا…") is fine for the fast path but not for a multi-second escalation. Escalation is real work with real stages — say so ("در حال بررسی دقیق‌تر کالا…") rather than showing an unchanging spinner, which reads as a hang. Do **not** expose tier names or cost units; the customer needs reassurance of progress, not the ladder's internals.

**On exhaustion:** route to operator review (`manual` tier) and tell the customer a human is checking, with an expectation of when. This is J1's "provider outage" row and is the one path where the honest answer is "a person will finish this."

---

## Summary of UX gaps this phase opens

| # | Gap | Blocks | Priority |
|---|---|---|---|
| 1 | No variation picker; resolved variant not explicitly displayed | Archetype 2 | High |
| 2 | No eligibility/restriction check at resolution | Archetype 7 | High |
| 3 | Per-field provenance shown for weight only | Archetype 8 | High |
| 4 | Missing-availability indistinguishable from confirmed-unavailable | Archetype 5 | Medium |
| 5 | No discount/original-price display | Archetype 4 | Medium |
| 6 | No fulfillment-party display | Archetype 6 | Medium |
| 7 | Single flat spinner during multi-stage escalation | Archetype 9 | Medium |
| 8 | Defaults (`1kg`, `'Unknown'`) rendered as observed data | Archetypes 5, 8 | Medium |
| 9 | No notify-me on unavailable (blocked on notification system) | Archetype 5 | Low |

Gaps 3, 4, 7, and 8 need **no backend change** — `missingFields` and `provenance` already cross the wire. Gaps 1, 2, 5, and 6 require the model extensions in `product-resolution.md`. All feed Phase 5 (front-office IA) and Phase 12 work packages.
