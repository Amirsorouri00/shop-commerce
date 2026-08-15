# Front Office — Phase 5 Completeness Review

> Phase 5 exit review of `docs/ux/front-office-ia.md` and `docs/ux/front-office-interaction-spec.md`, against Phase 3 journeys, Phase 4 resolution model, and live source. Four checks: **journey-gap**, **UI-state-without-backend**, **contradiction**, and **P0/P1 triage**.
>
> Scope distinction used throughout: a **Phase 5 artifact issue** is a defect in the design work itself (unmapped journey, contradiction, orphan screen) and must be zero for Phase 5 to close. A **product issue** is a real gap in the system that Phase 5 *discovered and documented*; those are owned by Phases 7–12 and are not Phase 5 blockers. Conflating the two would either block the phase forever or hide real defects.

## 1. Journey-gap check

Every MVP-now journey element from `docs/ux/journey-map.md` (J1–J9), mapped to a screen and state.

| Journey | Screen(s) | Elements mapped | Unmapped |
|---|---|---|---|
| J1 resolve | `/` | entry, intent, prerequisites, happy, alternates, loading, validation, missing-data, outage, cancel, retry, recovery, async, terminal | none |
| J2 quote | `/` | all, incl. viability-block and FX outage | none *(was unmapped — see revision log)* |
| J3 auth | `/checkout`, `/login` | all; SMS-outage fallback documented as gap | none |
| J4 addresses | `/addresses`, `/checkout` | all; in-flight-order deletion documented as gap | none |
| J5 checkout/pay | `/checkout`, `/checkout/return` | all, incl. duplicate callback, abandoned tab | none |
| J6 orders/tracking | `/orders`, `/orders/<id>` | all, incl. unmapped-carrier-status handling | none |
| J7 exception decision | `/orders/<id>` | all four actionable states; race and SLA documented as gaps | none |
| J8 support/refund | `/support`, `/support/<id>` | all; SLA documented as gap | none |
| J9 merchant end customer | `/track/<token>` | deferred with reason (Line B) | none — deferral is explicit, not silent |

**Terminal states** are covered per journey and consolidated in the interaction spec's terminal-state table. **Anti-personas** (`anti-personas.md`) correctly have no journeys; they are cut off at validation and permission boundaries (link-first enforcement at `/`, ownership scoping on orders, eligibility blocking).

**Result: no unmapped journey elements.** Every J1–J9 element resolves to a screen + state or an explicitly reasoned deferral.

## 2. Amazon resolution reconciliation (Phase 4 → Phase 5)

All nine PDP archetypes from `docs/ux/amazon-resolution-journeys.md` map to a specified screen state.

| Archetype | Screen state | Needs backend change? |
|---|---|---|
| 1 Simple product | `/` resolved (`RESOLVED`) | no — ships today |
| 2 Variations | `/` resolved + variant line; picker deferred | **yes** — `selectableVariations` |
| 3 Multiple sellers | `/` resolved, single seller shown; no picker by design | no — offer choice stays in the strategy layer |
| 4 Discounted | `/` resolved + strikethrough original | **yes** — `originalPrice`/`discountPercent` |
| 5 Unavailable | `/` unavailable-block, split confirmed vs. unconfirmed | **no** — see finding below |
| 6 FBA vs. seller-fulfilled | `/` resolved + fulfilment line | **yes** — `fulfillmentParty` |
| 7 Restricted/ineligible | `/` ineligible-block with reason | **yes** — `eligibility`/`restrictions` |
| 8 Incomplete data | `/` `NEEDS_REVIEW` + per-field markers | **no** — see finding below |
| 9 Slow / ladder exhausted | `/` staged loading; operator-review message | no |

**Two findings that materially reduce the implementation cost:**

- **Archetype 8 (per-field provenance markers) needs no API change.** `provenance` and `missingFields` already cross the wire (`resolvedProductSchema`, `packages/contracts/src/schemas.ts:127-159`; consumed today at `ProductCard.tsx:14`). Today's UI reads exactly one field's confidence (`weightKg`) and shows one generic banner. Generalizing is a rendering change.
- **Archetype 5 (confirmed-unavailable vs. unconfirmed) also needs no API change.** The distinction is recoverable from `provenance.available` — absent or below-confidence means "we couldn't confirm," while a confident `false` means genuinely unavailable. Today's UI branches only on the boolean (`page.tsx:145`), which is why the two collapse. Correcting this is a frontend fix, not a model extension.

**Result: reconciled.** No archetype is unrepresented, and the four requiring model extensions are the same four already listed in `product-resolution.md`.

## 3. UI-state-without-backend check

The most important check: **no UI state may exist without corresponding backend/domain/operational behaviour, or an explicitly documented gap.** Verified against the API client surface (`lib/api.ts:226-331`) and the service blueprint.

**Backed by existing behaviour** (no new backend): all `/` states (resolve, quote, NEEDS_REVIEW, FAILED, unavailable, per-field provenance, availability-confidence split); all `/login` states (`auth.startOtp`/`verifyOtp`); all `/checkout` and `/checkout/return` states (`quotes`, `addresses.list/create`, `orders.create/startPayment`, polling via `orders.get`); `/orders` list; `/orders/<id>` read, timeline, and **all exception banners** (`alertFor`, `buildCustomerTimeline`); logout (`auth.logout`).

**Requires new backend — each explicitly documented as a gap:**

| UI state | Missing backend | Documented in |
|---|---|---|
| J7 decision submit (approve / cancel-refund / supply document) | customer-facing decision endpoint | IA + spec + `journey-map.md` J7 |
| Address edit / delete / set-default | `addresses` update/delete | IA + spec + `mvp-vs-platform.md` #3 |
| Support case create / list / detail / reply | entire support API | IA + spec + `mvp-vs-platform.md` #2 |
| Refund request (customer-initiated) | refund trigger (port method exists, unwired) | spec refund section |
| Profile / settings read-write | profile API | IA |
| Notification preferences + delivery | `NotificationPort` unwired | spec + `journey-map.md` cross-cutting |
| Ineligibility block | `eligibility`/`restrictions` field | Phase 4 + spec |
| Variation picker | `selectableVariations` field | Phase 4 + spec |
| Discount display | `originalPrice`/`discountPercent` | Phase 4 + spec |
| Fulfilment party line | `fulfillmentParty` field | Phase 4 + spec |
| Public tokenized tracking (J9) | tokenized endpoint | IA (deferred, Line B) |
| `REFUNDED` / `CANCELLED` closure copy | `ALERTS` entries | spec + `state-matrix.md` §2 |
| **Attention badge + list-level exception prioritization** | `actionable`/alert-code on `orderSummarySchema` and the list endpoint | IA nav model + spec `/orders` |
| **Refund status inside a support case** | case→order state read | spec `/support/<id>` |

**On the attention badge** (added after independent review): `orderSummarySchema` (`packages/contracts/src/schemas.ts:246-254`) carries `id, publicRef, state, title, imageUrl, finalPrice, createdAt` — no actionable/alert field. `alertFor()` is wired only at the order-*detail* endpoint. Two options: (a) expose `actionable`/alert-code on the summary, or (b) derive it client-side from `state`, which the summary does carry. **(a) is correct.** `order-state-machine.ts` lives in `apps/api/src/domain/`, not a shared package, so the web app cannot import the `actionable` mapping — deriving client-side would mean *duplicating domain logic in the frontend*, exactly what `CLAUDE.md`'s "contracts are the single source of truth" rule exists to prevent, and it would drift the moment a state's actionability changes.

**Result: zero undocumented UI states.** Every state either has backing behaviour today or appears in the table above with an owner phase. Notably, the J7 decision UI is the only case where the *domain* already fully supports the action (`PRICE_CHANGED → PROCUREMENT_PENDING | REFUND_PENDING` are legal edges in `TRANSITIONS`) and only the HTTP surface is missing — which is why it is the cheapest high-value package.

## 4. Contradiction check

Cross-read of Phase 3, 4, and 5 artifacts for incompatible assertions.

- **`actionable` split is consistent** across `order-state-machine.ts`, `state-matrix.md` §1, `journey-map.md` J7, and the Phase 5 spec: `PRICE_CHANGED`, `PAYMENT_FAILED`, `CUSTOMER_ACTION_REQUIRED`, `CUSTOMS_EXCEPTION` actionable; `OUT_OF_STOCK`, `PROCUREMENT_FAILED`, `SHIPMENT_EXCEPTION`, `REFUND_PENDING` informational. No document invents a customer decision the code doesn't have.
- **J4 status reconciled.** `journey-map.md` calls address management a GAP on the basis of "inline-only in checkout"; Phase 5 verified the sharper fact that the *API* has no update/delete (`lib/api.ts:269-284`). Same conclusion, firmer evidence — not a contradiction.
- **`/track` naming.** `journey-map.md` J6 treats tracking as EXISTS (true — it renders the timeline); Phase 5 adds that the route is not *public* despite its name. Complementary, not contradictory; recorded because the name implies otherwise.
- **Resolution ladder stages.** MASTER-PROMPT names seven stages; the code implements four tiers. Already recorded and reasoned in `product-resolution.md` (browser fetch folded into structured/vision; customer confirmation moved to the frontend). Phase 5 applies that resolution consistently and introduces no new conflict.
- **Sandbox scenario count** (12) consistent between `service-blueprint.md` and the Phase 5 spec.

**Two genuine tensions found and recorded, not silently resolved:**

1. **Phase 3 vs. Phase 4 on multi-seller offers.** `journey-map.md` J1 originally said "default to the authoritative/lowest-risk offer, **list alternatives**"; `amazon-resolution-journeys.md` Archetype 3 says **do not** surface a seller picker at MVP, because it is a marketplace-browsing affordance that the link-first RULE cuts against. Phase 4 supersedes Phase 3 here (correct per the source-of-truth hierarchy: newly accepted decisions outrank earlier artifacts). **This review initially treated "no picker by design" as settled fact without recording the supersession** — corrected: J1's alternate-path line now carries an explicit superseded-by note pointing at Archetype 3.
2. **Styling direction.** The design-intelligence database recommends *Vibrant & Block-based* for the "E-commerce" product type, which conflicts with this product's trust-and-transparency positioning (link-first, no catalog, no merchandising). Recorded in the spec's design-intelligence section as a **Phase 8 input with a recommendation**, since Phase 8 owns styling — not resolved unilaterally here.

**Result: no unresolved contradictions** — both are now explicitly recorded with a chosen resolution and rationale.

## 5. P0 / P1 triage

### Phase 5 artifact issues

**Four found by independent review, all now closed.** The first version of this document self-certified all four checks as passing; two of those claims were falsified by the artifacts being certified. Recording what was wrong, because a review that only ever confirms its own work is worthless:

| # | Defect | Status |
|---|---|---|
| A1 | **False "no orphan screens" claim.** `/settings` was listed with no journey and appeared in no mapping table — a genuine orphan. | Closed: recorded as an explicit cross-cutting exception, with the underlying **Phase 3 journey-taxonomy gap** (no journey covers account self-management) named rather than hidden |
| A2 | **False "no unmapped journey elements" claim.** J2's viability-block — required by `journey-map.md` as both an alternate path and a terminal state — had no row in the `/` state table; "viability" appeared nowhere in either Phase 5 doc. | Closed: "Viability-blocked" row added, explicitly distinguished from "Ineligible" (economics vs. compliance — conflating them would tell a customer their legal item is prohibited) |
| A3 | **Missed UI-state-without-backend.** The attention badge and list-level exception prioritization need per-order actionability at *list* granularity, which `orderSummarySchema` does not carry. | Closed: added to §3 with the contracts-vs-client-derivation analysis |
| A4 | **Unrecorded Phase 3 vs. Phase 4 contradiction** on multi-seller offers, despite §4 existing to catch exactly that. | Closed: supersession recorded in both §4 and `journey-map.md` J1 |

Also closed: `/support/<id>` had no refund-status display despite J8's happy path ending in a refund (§3, spec).

**Now open: none.** That claim is worth more than the original one because it survived an adversarial pass.

### Product issues discovered by Phase 5 (owned by later phases)

**P0 — must be resolved before Line A production launch:**

1. **`/orders` unauthenticated dead end.** Live defect, one click from every page via the top bar. Fix: `/login` route + authentication-aware nav. Smallest effort, highest immediate user-facing value. *Owner: Phase 12.*
2. **J7 customer exception decision UI absent.** Live "no dead ends" violation; the backend already supports the transitions. MVP boundary item 1. *Owner: Phase 10 (endpoint) + 12 (UI).*
3. **No import-eligibility check at resolution.** Worst failure mode in the product: an ineligible item resolves, quotes, is paid for, and fails at customs. Ties to the compliance RULE. *Owner: Phase 10.*

**P1 — required for a complete MVP, not launch-blocking in the same way:**

4. Support/refund surface, both sides (MVP boundary item 2) — Phase 10 + 12.
5. Address management with update/delete (MVP boundary item 3) — Phase 10 + 12.
6. Notification system unwired — Phase 10; partially mitigated meanwhile by the in-app attention badge specified in the IA.
7. `REFUNDED` / `CANCELLED` customer copy missing — Phase 12, trivial.
8. Concurrent decision race (customer vs. operator on the same exception) — Phase 10.
9. Per-field provenance markers + confirmed-vs-unconfirmed availability — Phase 12, **frontend-only**.
10. J7 decision SLA and J8 stalled-case SLA — design once, Phase 12.

**Not P0/P1:** variation picker, discount display, fulfilment-party line (product quality, post-MVP); J9 public tracking (Line B); business/org surfaces (Line B/C).

## 6. Method and limitations

**Specialist capabilities used:** the installed `ui-ux-pro-max` design-intelligence database (domains `ux`, `product`) was queried for checkout/validation/async and accessibility guidance; nine material requirements were added to the interaction spec and one styling tension recorded for Phase 8.

**Independent adversarial review.** A reviewer subagent audited this document and the artifacts it certifies. It found four defects (A1–A4 in §5), two of which directly falsified this document's own pass claims. Each was verified against source before being accepted — none were taken on trust — and all four are now closed. It spot-checked eight `file:line` citations across the Phase 5 docs and found no citation defects.

**Revision log:** v1 self-certified four passing checks. v2 (this version) corrects two false pass claims (A1 orphan screen, A2 unmapped journey element), adds two items the original checks missed (A3 list-level actionability, A4 Phase 3/4 supersession), and adds refund-status display to `/support/<id>`. The §1 table's "none unmapped" entry for J2 is accurate only as of v2.

**Limitations, stated plainly:**
- Layout-level decisions are **not** verified against a rendered Amazon UAE PDP — direct fetch was blocked during Phase 4 (six of seven attempts returned HTTP 503). Product-card layout should be re-verified with browser automation before implementation.
- Contrast ratios are asserted as targets (WCAG 2.1 AA), not measured — there are no tokens to measure yet. Phase 8 owns verification.
- No running application was exercised this phase; all claims about current behaviour come from source reading. Whether the app currently boots is still unverified (a carried-forward Phase 0 item).
