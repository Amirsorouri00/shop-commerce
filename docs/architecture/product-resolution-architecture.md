# Product Resolution Architecture

> Phase 4 of `docs/program/MASTER-PROMPT.md`. The code-level architecture behind `docs/product/product-resolution.md`. **This documents an engine that already exists** in `platform/packages/commerce/` and states precisely what must change to close the Phase 4 gaps — it is not a greenfield design. Every claim below is cited to source read in this pass.

## Where the code lives

| Concern | File |
|---|---|
| Canonical types, ports, required fields, confidence floor | `packages/commerce/src/types.ts` |
| Escalation pipeline, merge, assembly, risk factor | `packages/commerce/src/resolution.ts` |
| The four ladder rungs | `packages/commerce/src/strategies.ts` |
| Marketplace descriptors, URL→marketplace matching, ASIN extraction | `packages/commerce/src/marketplace.ts` |
| Rate limiting per marketplace | `packages/commerce/src/rate-limit.ts` |
| Composition/wiring, `STORE_PROVIDERS` switch | `apps/api/src/composition/adapters.ts:221-311` |
| Wire contract (`ProductRequestDto`, `resolvedProductSchema`) | `packages/contracts/src/schemas.ts:127-159` |
| Frontend consumer | `apps/web/app/page.tsx:17-72`, `apps/web/lib/api.ts:247-256`, `apps/web/components/ProductCard.tsx` |
| Sandbox playback | `packages/sandbox/src/{scenario,adapters}.ts` |

## The port

`StorePort` (`types.ts:125-133`) exposes exactly three operations:

- `supports(url)` — does any enabled marketplace claim this URL.
- `resolve(url, correlationId)` → `ResolutionOutcome` — the full ladder.
- `checkOffer(marketplaceId, productId)` → `{price, available}` — the cheap live re-check.

`checkOffer` being a **separate, deliberately uncached operation** is load-bearing, not a convenience: it is what the checkout revalidation RULE and the max-procurement-price guard consume, and the code comment says so explicitly — "Never cached. The whole purpose is to see what the price is *now*; a cached answer here would defeat the max-procurement guard that consumes it" (`resolution.ts:74-76`). Any future caching layer added in front of `StorePort` **must not** cache `checkOffer`. This is the single most dangerous place in the resolution subsystem to "optimize."

Per `CLAUDE.md`, `StorePort` is consumed through the standard proxy chain (`cache → circuit breaker → retry → timeout → instrumentation → adapter`) — with the caching stage necessarily bypassed for `checkOffer` as above.

## The ladder

Four strategies implementing `ResolutionStrategy` (`types.ts:97-108`), sorted by `costUnits` ascending at construction (`resolution.ts:57` — "the escalation order is the cost order"):

| Tier | Class | `costUnits` | Status | What it's authoritative on |
|---|---|---|---|---|
| `api` | `ApiResolutionStrategy` | 1 | EXTERNAL-GATE | price 0.99, title 0.99, availability 0.95 |
| `structured` | `StructuredDataStrategy` | 3 | EXTERNAL-GATE (blocked on a fetcher Amazon won't block) | title 0.9, price 0.85, image 0.9 |
| `vision` | `VisionResolutionStrategy` | 20 | EXTERNAL-GATE (model credentials) | the only tier that can estimate *shipping* weight; all confidences capped |
| `manual` | `ManualResolutionStrategy` | 50 | Available (needs operator UI) | everything, confidence forced to 1.0 |

Only `StubStoreStrategy` is wired in dev; it is **refused in production** (`adapters.ts:290-296`), and the live set is chosen by the `STORE_PROVIDERS` env switch (`adapters.ts:281`) — consistent with `CLAUDE.md`'s "composition root is the only place that knows which adapter is live."

**Design property worth preserving:** strategies throw rather than invent. The header comment is explicit — "A strategy that silently fabricates a plausible weight is worse than one that fails: the pipeline can escalate past a failure, but it cannot detect a confident lie" (`strategies.ts:14-16`). `StructuredDataStrategy` throws `UpstreamError` when no JSON-LD `Product` node exists (`strategies.ts:127-129`); `ManualResolutionStrategy` throws without operator input (`strategies.ts:382-384`); `extractWeightKg` returns `undefined` for an unrecognized unit because "unknown unit is worse than no answer" (`strategies.ts:267`).

## Escalation semantics

`ResolutionPipeline.resolve` (`resolution.ts:127-225`):

1. Parse URL → marketplace + product id, or immediate `FAILED` (`resolution.ts:128-139`).
2. For each strategy cheapest-first: skip if `!canHandle`; **break if nothing required is still missing** (`resolution.ts:158-159`); break if the next strategy would exceed `costBudget` (default 100, `resolution.ts:59,161-164`); acquire the per-marketplace rate-limit token, skipping (not failing) the strategy on timeout (`resolution.ts:167-173`).
3. Merge the result field-by-field, **highest confidence per field wins, ties go to the incumbent** (`resolution.ts:233-250`) — so a cheap exact API price is never displaced by an expensive vision guess reporting the same confidence.
4. A failing tier is expected and non-fatal — it's logged, counted, and the loop escalates (`resolution.ts:189-202`).
5. Status: `RESOLVED` if no required field is missing; else `NEEDS_REVIEW` if a product could still be assembled; else `FAILED` (`resolution.ts:208-209`).

Rate limiting is per **marketplace**, not per strategy — "the marketplace is what blocks us" (`resolution.ts:166`). Amazon UAE is configured at 2 rps / burst 5 (`marketplace.ts:84-85`), deliberately below any published limit because "being rate-limited is recoverable, being blocked is not" (`marketplace.ts:50-52`).

`REQUIRED_FIELDS` = `title`, `price`, `available`, `weightKg`, `category` (`types.ts:53-59`). A field below `MIN_FIELD_CONFIDENCE` (0.5) is treated as **missing**, not as low-quality-but-present (`types.ts:62`, `resolution.ts:257-261`).

## Assembly defaults — pessimistic by design

`assemble` (`resolution.ts:263-296`) returns `undefined` unless both `title` and a `Money`-typed `price` are present, since "without a title and a price there is nothing to show a customer, even for review" (`resolution.ts:270`). Otherwise it fills:

- `weightKg` → **1kg** when missing, deliberately pessimistic "so the quote overestimates freight rather than underestimating it," while `missingFields` still flags it (`resolution.ts:287-289`).
- `available` → `merged['available'] === true`, i.e. **missing availability resolves to `false`** (`resolution.ts:286`) — the safe direction.
- `seller` → `'Unknown'`, `category` → `'general'`.

These defaults are correct in direction (each errs toward *not* losing money or overpromising) and should be preserved as-is.

## Risk propagation into pricing

`resolutionRiskFactor(product)` (`resolution.ts:306-320`) collapses per-field confidence into one 0..1 number the quote engine widens its risk reserve by, weighted `weightKg` 0.5, `price` 0.3, `available` 0.1, `category` 0.1. Weight dominates because "freight is charged per kilo, so a wrong weight is a per-order margin loss that repeats on every order of that product" (`resolution.ts:302-304`). This is the mechanism `feasibility-revalidation-v0.2.md` called for (a `ResolverConfidence` routing soft data into the pricing buffer) — already built.

---

## Defect found this pass — record, don't silently fix

**`ApiResolutionStrategy` never triggers weight escalation, contrary to its own comment.**

`strategies.ts:83-85` sets `weightKg` confidence to `0.6` with the comment *"Catalogue weight ignores packaging and dimensional weight, so it is a starting point rather than the chargeable figure. **Deliberately below the escalation floor.**"*

But the escalation floor is `MIN_FIELD_CONFIDENCE = 0.5` (`types.ts:62`), and `missingRequired` tests `confidence < floor` (`resolution.ts:259`). `0.6 < 0.5` is false — so an API-supplied catalogue weight is treated as **sufficient**, the pipeline stops, and the `vision` tier (the only rung that can estimate a true *shipping* weight, per `strategies.ts:286-289`) is never consulted. Verified that nothing overrides the floor in production: `confidenceFloor` is set only in `packages/commerce/src/commerce.test.ts:277`, never in `apps/`.

**Why it matters:** freight is most of landed cost; catalogue weight excludes packaging and dimensional weight and is therefore systematically *under*-stated. The intended behavior (escalate to vision for weight even when the API answered) is exactly the pipeline's headline optimization — "when the API answered everything except weight, the vision model is asked about weight, not about the whole product" (`resolution.ts:32-33`). Today that path can't fire for the `api` tier.

**Latency:** currently zero — the `api` tier is not wired in production (`STORE_PROVIDERS`, `adapters.ts:281`), so no live order is mispriced by this today. It becomes a live margin defect the moment the API gate clears.

**Candidate fixes (not applied — Phase 4 is design, and this needs a deliberate choice):** (a) lower `ApiResolutionStrategy`'s `weightKg` confidence below 0.5 to match its comment; (b) make the floor per-field so weight can carry a stricter threshold than other fields; (c) treat "chargeable weight" as a distinct field from "catalogue weight" so the API can be authoritative on one and silent on the other. **(c) is the most honest** — the two really are different quantities, and modeling them as one field is the root cause — but it is also the largest change. Recommend deciding this in Phase 10/12 alongside the `api`-tier gate work, not before.

---

## Required changes for Phase 4's product goals

1. **Add the missing fields** named in `docs/product/product-resolution.md` (`selectableVariations`, `fulfillmentParty`, `itemCondition`, `originalPrice`/`discountPercent`, `quantityRestrictions`, `estimatedMarketplaceDelivery`, `eligibility`/`restrictions`) to `ResolvedProduct` (`types.ts:10-29`) as optional fields with their own `FieldProvenance` entries. The provenance mechanism generalizes without redesign. Mirror in `packages/contracts/src/schemas.ts:127-159`. None may participate in `REQUIRED_FIELDS` unless the quote genuinely cannot be produced without them — `eligibility`/`restrictions` is the only plausible candidate, and only if the viability/compliance gate consumes it.
2. **Customer confirmation is a frontend behavior, not a fifth tier.** Gate a confirmation prompt on `provenance[field].confidence` falling in a band *above* `MIN_FIELD_CONFIDENCE` but below a "show it without asking" threshold. The pipeline's contract stays "best available answer with honest confidence"; deciding when to ask a human is a presentation concern. (Confidence: medium; reversal cost: low — purely additive.)
3. **Multi-offer selection sits upstream of `ResolvedProduct`.** `seller: string` (singular, `types.ts:15`) is correct for *the resolved offer*. Amazon UAE genuinely exposes N sellers per ASIN ("Other sellers on Amazon · New (7) from AED262.42", per `docs/product/product-resolution.md`'s empirical findings). Model the offer *set* inside the strategy layer, choose the authoritative/lowest-risk offer, and keep `ResolvedProduct` singular — the quote engine should never have to reason about which offer it's pricing.
4. **The `structured` tier needs a fetcher Amazon won't block.** Empirically confirmed this pass: six of seven direct fetches to `amazon.ae` returned HTTP 503. `PageFetcher` (`strategies.ts:95-100`) is already the correct seam — its docstring anticipates "proxying, headers and session reuse." Whatever fills it (headless browser with a realistic fingerprint, or a licensed fetching provider) goes behind that interface and through the standard proxy chain. No pipeline change required.
5. **Re-evaluate the `api` tier's premise.** `marketplace.ts:78` asserts `productApi: true` for `amazon.ae`. Amazon's PA-API 5.0 was deprecated 2026-05-15 in favor of a Creators API with a narrower access model (see `docs/product/product-resolution.md` finding #2). Whether `productApi: true` still holds is now an *availability* question, not just a credentials question. Since capabilities are data (`MarketplaceCapabilities`, `marketplace.ts:28-39`), flipping it is a one-line descriptor change if the answer turns out to be no — the architecture already absorbs this cleanly.

## What must not change

- `checkOffer` stays uncached (`resolution.ts:74-76`).
- Strategies keep throwing instead of fabricating (`strategies.ts:14-16`).
- Merge stays highest-confidence-per-field with ties to the incumbent (`resolution.ts:228-231`) — a higher tier must never automatically outrank a cheaper exact source.
- Vision confidences stay capped (`strategies.ts:338-339`) — "treating it as equal to an API's certainty would let a confident hallucination outrank an authoritative fact."
- Vision output never writes a monetary record directly; a model-supplied price is a candidate the procurement guard re-checks before money moves (`strategies.ts:291-292`), consistent with `CLAUDE.md`'s "AI never produces or writes a financial record."
- Hostname matching stays exact, never substring (`marketplace.ts:141-146`) — substring matching would accept `amazon.ae.attacker.example`.
- Adding a marketplace stays "data plus one adapter" (`marketplace.ts:5-9`).
