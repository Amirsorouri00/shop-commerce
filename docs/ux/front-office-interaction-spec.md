# Front Office — Interaction Specification

> Phase 5 of `docs/program/MASTER-PROMPT.md`, discovery/design only per the sequencing clarification in `docs/program/PROJECT-STATE.md`. Companion to `docs/ux/front-office-ia.md`: per-screen interaction behaviour, state coverage, responsive rules, and trust/conversion patterns. **No implementation in this phase.**
>
> State vocabulary is the twelve categories MASTER-PROMPT §PHASE 3 requires, already applied per-journey in `docs/ux/journey-map.md` and cross-referenced in `docs/ux/state-matrix.md` §3. This document takes them screen-by-screen rather than journey-by-journey, because screens are what Phase 8 and Phase 12 build.

## Cross-cutting interaction rules

These hold on every screen; per-screen sections below note only departures.

- **Loading is never a bare spinner past ~1s.** Skeletons for content whose shape is known (already the pattern: `page.tsx:132`, `orders/page.tsx:31-35`); staged progress copy for genuinely multi-stage work (resolution escalation — Phase 4 archetype 9).
- **Errors state what happened, whether it's retryable, and what to do next.** Never a raw code. Validation errors arrive from the API in both fa and en (`CLAUDE.md`) and the client picks fa; `ApiError.text('fa')` / `.fieldErrors('fa')` already implement this (`lib/api.ts`).
- **Field-level errors bind to their input** via `aria-invalid` + `aria-describedby`, as `page.tsx:94-104` already does. Form-level errors use `role="alert"`.
- **Destructive and money-moving actions confirm**, and carry an idempotency key (`CLAUDE.md`; `newKey()` already applied to resolve, quote, order create, payment start).
- **Empty states prompt the next action.** An empty list is a moment to guide, not a blank panel.
- **Nothing inferred is presented as confirmed.** Phase 4's rule, and the one most easily lost in implementation: pricing-safety defaults (weight → 1kg, seller → `'Unknown'`, `resolution.ts:281,287-289`) must never render as observed data.
- **Polling, not sockets, on customer surfaces** — the existing rationale is sound and should be preserved: a tracking page "is left open for days on a phone that sleeps and changes network; a polling client reconnects by simply making its next request" (`track/page.tsx:13-18`).

## Per-screen specification

### `/` — Paste, resolve, confirm, quote (J1, J2)

**Intent:** "Show me the true landed cost of this exact item, and prove it's the item I meant."

| State | Behaviour |
|---|---|
| Idle | Paste field, `dir="ltr"` inside RTL (already `page.tsx:90`), supported-marketplace note. Submit disabled while empty |
| Loading | Skeleton + staged copy: "در حال بررسی کالا…" → "در حال بررسی دقیق‌تر کالا…" on escalation. Never expose tier names or cost units |
| Validation | Unsupported/malformed URL → field-level, naming the supported marketplace. This is also where link-first is enforced at the edge |
| Resolved (`RESOLVED`) | Product card, resolved variant on its own labelled line, quantity, quote CTA |
| Resolved (`NEEDS_REVIEW`) | Same, **plus per-field markers on the fields actually soft** — generalizing the existing weight badge (`ProductCard.tsx:14-15,43-47`) using `provenance` + `missingFields`, both already on the wire. Today's single generic banner (`page.tsx:138-143`) names weight regardless of which field is soft. **See the two-threshold note below — these are different cutoffs and must not be fused** |
| Unavailable | Block the quote (already `page.tsx:145-147`). **Distinguish confirmed-unavailable from unconfirmed** — `assemble` maps absent availability to `false` (`resolution.ts:286`), so today "we couldn't check" reads as "not available" |
| Ineligible | Blocked with a specific reason. **No surface today** — Phase 4 archetype 7, highest-consequence gap: an ineligible item currently resolves, quotes, and fails at customs after payment |
| **Viability-blocked** | Quote below the v0.3 minimum-order-value threshold → **explicit "this item alone isn't cost-effective to ship" framing, not a bare block** (J2 alternate path + terminal state; viability-gate RULE, `CLAUDE.md`). **Distinct from Ineligible**: ineligible means *we may not* import this (compliance/customs); viability-blocked means *it isn't worth* shipping alone (economics). Conflating them would tell a customer their perfectly legal item is prohibited. Offer the bundling/manual-review path rather than a dead end (routes toward J8, itself a gap) |
| Failed (`FAILED`) | Explicit failure + retry + what to try instead. Never a generic error |
| Outage | FX/rate unavailable → quote blocked with retry, never a stale rate shown as final |
| Ladder exhausted | "A specialist is checking this" with an expectation of when — the one path where the honest answer is that a human finishes it |
| Cancellation | Abandoning before quote persists nothing |

**Two distinct confidence thresholds — do not fuse them.** There are two different cutoffs in play and an earlier draft of this spec conflated them:

- **0.5 — the pipeline's escalation floor** (`MIN_FIELD_CONFIDENCE`, `packages/commerce/src/types.ts:62`, applied at `resolution.ts:259`). Below this a field is *treated as missing* and drives `missingFields` and the `RESOLVED`/`NEEDS_REVIEW` status.
- **0.7 — the UI's "this was estimated" threshold** (`ProductCard.tsx:15`). Between 0.5 and 0.7 a field is good enough to use but honest to flag.

The band between them is exactly the "show it, but say it's soft" zone, and it is the right model. The UI must read **both**: `missingFields` for the record-level warning, per-field `provenance[f].confidence` for the per-field markers.

> **Defect found this pass — record, don't silently fix.** The vision tier caps its self-reported confidences (`cap(v, ceiling)` = `Math.min(v ?? 0.5, ceiling)`, `strategies.ts:358-360`), and for `weightKg`, `seller`, `variant`, and `available` that **ceiling is exactly 0.7** (`strategies.ts:341-346`). The UI badge fires on `confidence < 0.7` (`ProductCard.tsx:15`). So a vision-estimated weight whose model confidence lands at or above the ceiling becomes exactly `0.7`, and `0.7 < 0.7` is false — **the "estimated weight" badge does not render, and a model's guess is presented to the customer as confirmed data.** This is precisely the case the badge exists for. The cheaper tiers are unaffected (`api` weight is 0.6, `structured` 0.55 — both below 0.7 and correctly flagged), so the bug is invisible until the vision tier goes live, and it is silent when it strikes. Weight drives freight, which is most of landed cost. **Fix direction (not applied — Phase 5 is design):** make the UI threshold `<=` the tier ceiling, or better, derive "was this estimated?" from `provenance[f].tier` (`'vision'`/`'manual'` vs `'api'`/`'structured'`) rather than from a float comparison against a boundary that another module owns. The second is more honest: the question the badge answers is *where did this come from*, not *what number did it score*. Related in kind to the `ApiResolutionStrategy` weight-escalation defect recorded in `docs/architecture/product-resolution-architecture.md`.

**Not built:** variation picker (Phase 4 archetype 2). Changing a variant is a **new resolution against that variant's ASIN**, never a local edit — different variants are different ASINs with different price, availability and weight, and mutating client-side decouples what's displayed from what's priced.

### `/login` — Phone, OTP (J3) — new

Reuses the two steps already inside checkout (`checkout/page.tsx:184-243`); this route exists so authentication is reachable without a quote (IA defect 1).

| State | Behaviour |
|---|---|
| Idle | Phone field, `inputMode="tel"`, Persian-digit tolerant |
| Loading | Per-step: sending, verifying |
| Validation | Phone format; OTP length/expiry/attempts |
| Async | OTP delivery latency — say a code was sent and where |
| Retry | Resend with visible cooldown, not a dead button |
| Recovery | Edit number before dispatch; cooldown after repeated failures, never a lockout without a path out |
| Outage | SMS provider down → **no fallback designed** (J3 gap). Must at minimum fail honestly and not strand the user mid-checkout |
| Permission | n/a — this establishes it |
| Terminal | Session established → continue to return target, or `/orders` by default |

### `/checkout?quote=<id>` (J3, J4, J5)

Existing step machine (`checkout/page.tsx:28`), extended with saved-address selection once `/addresses` exists.

| State | Behaviour |
|---|---|
| Loading | Quote fetch |
| Login/OTP | Inline, as today — the primary auth path |
| Address | First-ever address inline (as today); once J4 exists, saved-address selection with inline add |
| Validation | Address fields bilingual; serviceability checked before payment, not after |
| Quote expired | Re-quote before payment. **Never a silent stale charge** — the revalidate-at-checkout RULE |
| Paying | Gateway redirect; make it unmistakable the customer is leaving |
| Cancellation | Abandoning at the gateway returns to a retryable state, never stuck |
| Outage | Gateway unavailable → explicit, retryable, and clear that no money moved |

### `/checkout/return` (J5)

| State | Behaviour |
|---|---|
| Polling | Pending payment is a real state, not a spinner — say settlement can take a moment |
| Success | `PAID` → confirmation + link to `/orders/<id>` |
| Failure | `PAYMENT_FAILED` → retry, carrying the existing reassurance "nothing has been charged" (`ALERTS.PAYMENT_FAILED`) |
| Duplicate callback | Idempotency-keyed; must never double-charge or double-confirm |
| Abandoned tab | Order state is authoritative — the customer can close the tab and find the truth in `/orders/<id>` |
| Terminal `CANCELLED` | A quote abandoned or an order cancelled before payment ends here (J5 terminal). Must state that no money moved and offer a route back to `/` — not silently drop the customer on an order list |
| Support escalation | "I was charged but the order doesn't show it" — the highest-anxiety moment in the product. Needs a visible route into J8 from both `/checkout` and `/checkout/return`, **not** only from order detail. Currently **N** (no support surface) |

### `/orders` — list (J6)

| State | Behaviour |
|---|---|
| Loading | Skeleton rows (already) |
| Empty (authed) | "No orders yet" → prompt back to `/` |
| Empty (unauthed) | **Must route to `/login`** — today it says "log in" with no way to (IA defect 2) |
| Populated | Normalized status per order; **actionable exceptions visually prioritized** |
| Error | Retry |

### `/orders/<id>` — detail, timeline, decisions (J6, J7) — new, highest priority

Replaces `/track?id=`. Hosts the exception decision UI — the surface whose absence is the program's clearest "no dead ends" violation: the backend already has the legal transitions, the frontend never asks.

| State | Behaviour |
|---|---|
| Loading | Skeleton |
| Timeline | Eight normalized steps from `buildCustomerTimeline()`. **Never leak raw carrier statuses** — unmapped statuses already resolve to `null` server-side (`order-state-machine.ts:110-112`) |
| Exception, informational | Banner from `alertFor(state)` where `actionable: false` — `OUT_OF_STOCK`, `PROCUREMENT_FAILED`, `SHIPMENT_EXCEPTION`. Inform, don't ask. Reassure and state what happens next |
| Exception, actionable | Decision panel where `actionable: true` — `PRICE_CHANGED`, `CUSTOMER_ACTION_REQUIRED`, `CUSTOMS_EXCEPTION` (plus `PAYMENT_FAILED`, whose action is retry via checkout) |
| `PRICE_CHANGED` | Show approved vs. new price **and the delta**, then two explicit choices: approve and continue, or cancel and refund. Both are already legal transitions (`TRANSITIONS`, `order-state-machine.ts:33`) — this needs a customer-facing endpoint, not a new state |
| `CUSTOMS_EXCEPTION` / `CUSTOMER_ACTION_REQUIRED` | Supply requested document/answer to resume, or request cancellation. If the required document type is unknown, fall back to "we'll follow up" rather than blocking on an unknown field |
| Decision submitting | Idempotency-keyed; disable both choices to prevent double-submit |
| Decision race | An operator may resolve the same exception concurrently (`POST /admin/orders/{id}/transition`). The screen must handle "already decided" as a **normal outcome**, not an error — reload and show the resulting state |
| SLA timeout | **Undesigned** (J7 gap). Until a policy exists, do not imply an unlimited window |
| Terminal | `DELIVERED` / `REFUNDED` / `CANCELLED` — explicit closure. `ALERTS` has copy for neither `REFUNDED` nor `CANCELLED` (`state-matrix.md` §2) |
| Permission | Ownership-scoped; a non-owner gets not-found, never a hint the order exists |
| Async / polling | The screen polls (inherited from `/track`); show last-updated time so a quiet order is distinguishable from a stalled page |
| Outage / fetch error | Order fetch fails → keep the last-known state visible with a "couldn't refresh" notice rather than blanking the screen; a tracking page left open for days will hit transient failures routinely |
| Retry | Manual refresh alongside the automatic poll |
| Decision submit failed | Transient failure on a J7 decision → explicit retry, same idempotency key, choices re-enabled. **Distinct from "already decided"** (below), which is not an error |
| Document validation | Where a customs document is requested: accepted file types, size limit, and a clear rejection message. Validation happens before submission, not after |
| Support escalation | Route into J8 from any order state, not only `DELIVERED` — "my tracking looks wrong" and "I don't understand this price change" are the two most likely entry points, and the decision panel itself must carry one |

**The `actionable` split is inherited, not invented.** It is already encoded in the backend and must not be overridden by adding customer decisions where the code deliberately decided there isn't one.

### `/addresses` (J4) — new

List, add, edit, set default, delete. Needs API extension: only `list` and `create` exist, with `isDefault: true` hardcoded (`lib/api.ts:269-284`).

Notable states: empty → prompt (not blank); serviceability validation shared with checkout; **deleting an address referenced by an in-flight order must be blocked or reassigned** — undesigned, flagged in J4.

### `/support`, `/support/<id>` (J8) — new

Case list, new case, case thread. **No API exists** — the largest net-new backend surface implied by Phase 5.

Notable states: empty → prompt; case optionally bound to an order; async by nature (waiting on an operator) — the journey most damaged by the missing notification system, since neither side learns of a reply; stalled-case SLA undesigned (shares a root with J7's timeout — design once, not twice).

**Refund status within a case.** J8's happy path can end in a refund, so `/support/<id>` must show refund *status*, not just the fact that one was requested: requested → in progress (`REFUND_PENDING`) → completed (`REFUNDED`), with amount and expected timescale. This must read from the order's own state rather than a case-local copy — the order state machine is the single source of truth, and a case showing "refunded" while the order says `REFUND_PENDING` would be a trust failure at the worst moment. Resolution-without-refund and withdrawn cases need equally explicit closure.

### `/settings` — new

Profile, phone, language, notification preferences (present before delivery exists, so the surface is ready), and **logout** — which has no surface today despite `auth.logout()` existing (`lib/api.ts:244`).

## State coverage matrix

Screens × required state categories. **E** exists, **X** extend, **N** new, **—** not applicable.

| Screen | Load | Empty | Valid | Missing data | Outage | Perm | Cancel | Retry | Recover | Async | Notify | Support | **Terminal** | **Refund** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/` | E | — | E | **N** | E | — | E | E | E | E | — | **N** | X | — |
| `/login` | E* | — | E* | — | **N** | — | E* | E* | E* | E* | E* | **N** | E* | — |
| `/checkout` | E | — | E | — | E | — | E | E | X | E | **N** | **N** | E | — |
| `/checkout/return` | E | — | — | — | E | — | — | E | X | E | **N** | **N** | E | — |
| `/orders` | E | X | — | — | E | **N** | — | E | — | — | **N** | — | E | — |
| `/orders/<id>` | X | — | **N** | X | X | X | **N** | X | **N** | X | **N** | **N** | X | **N** |
| `/addresses` | **N** | **N** | **N** | — | — | **N** | **N** | **N** | **N** | — | — | — | **N** | — |
| `/support` | **N** | **N** | **N** | — | — | **N** | **N** | **N** | **N** | **N** | **N** | — | **N** | **N** |
| `/settings` | **N** | — | **N** | — | — | **N** | **N** | **N** | — | — | **N** | — | **N** | — |

\* exists inside `/checkout` today; moves to `/login` as a shared surface.

**Reading it:** the Notify column is **N** almost everywhere — one architectural gap (an unwired `NotificationPort`), not nine screen gaps. `/` and `/checkout` are largely covered, matching Phase 0's finding that the core journey is complete on sandbox adapters.

**On `/orders/<id>` being X rather than N.** An earlier draft marked this row entirely **N** ("the screen doesn't exist"), which contradicted `state-matrix.md` §3's J6 row marking loading/empty/outage/permission/retry as **E**. Both cannot be true of the same journey. The reconciliation: **J6 is genuinely served today by `/track?id=`** — it renders the timeline, polls, and handles fetch errors. `/orders/<id>` *replaces and extends* that screen rather than inventing one, so its inherited states are **X** (migrate) and only genuinely new capability — the J7 decision panel, its validation and recovery, notifications, support escalation, refund display — is **N**. This matters for Phase 12 sizing: the work is "extend a working screen and move it to a canonical URL," not "build order tracking."

### Terminal-state coverage

Every terminal state must give the customer explicit closure — the "no dead ends" rule applied to *endings*, not just navigation. Order terminals are the three in `TERMINAL_STATES` (`order-state-machine.ts:61`):

| Terminal | Where seen | Copy exists? | Treatment |
|---|---|---|---|
| `DELIVERED` | `/orders/<id>`, `/orders` | timeline step 8 | Completed timeline; route to support if something's wrong on arrival |
| `REFUNDED` | `/orders/<id>`, `/orders` | **no `ALERTS` entry** | Confirm amount and where the money went. **Gap** (`state-matrix.md` §2) |
| `CANCELLED` | `/orders/<id>`, `/orders` | **no `ALERTS` entry** | State who cancelled (customer vs. platform) and why. **Gap** |

Non-order terminals: resolution rejected as unsupported/ineligible (`/`) — explicit reason, never a silent stop; support case resolved or withdrawn (`/support/<id>`); address deleted (`/addresses`). Each is specified in its screen section above.

### Refund-state coverage

Refunds are a customer-visible *money* path and need their own treatment; they surface in three distinct ways, all converging on the single existing `X → REFUND_PENDING → REFUNDED` transition path (never a parallel money mechanism):

1. **Automatic** — `OUT_OF_STOCK` is designed to refund without asking (`actionable: false`, and its `ALERTS` copy already promises "your refund is being processed"). **Target state, not current behaviour:** the payment port's `refund()` has no callers, and nothing in the system transitions an order into `REFUND_PENDING` today. So the copy makes a promise the machinery cannot yet keep — worth fixing early, because it is customer-facing and already written.
2. **Customer-chosen** — the "cancel and refund" branch of a J7 decision on `PRICE_CHANGED` / `CUSTOMS_EXCEPTION` / `CUSTOMER_ACTION_REQUIRED`. **New**.
3. **Support-mediated** — outcome of a J8 case. **New**, needs the API that doesn't exist.

All three must show: that a refund is in progress, the amount, and an expected timescale. The existing `ALERTS.REFUND_PENDING` copy covers in-progress; `REFUNDED` completion copy is the gap above. **Partial refunds are not modeled anywhere** in the domain — full-order refund only — so no UI may imply partial adjustment is possible.

## Sandbox / demo customer journeys

Sandbox is a first-class platform capability (MASTER-PROMPT §PHASE 9), not a frontend mock. The same domain and application flows execute; only provider adapters and configuration differ. The front office's job is to make that switch **visible and safe**, never to simulate anything itself.

**Existing surface:** `DemoPanel` renders app-wide but only when the sandbox is reachable (`layout.tsx:61-62`), backed by `api.sandbox.{scenarios,create,get,advance,reset}` (`lib/api.ts:308-331`). Preserve that reachability gating exactly — it is what keeps demo controls from ever appearing in production.

**Twelve deterministic scenarios exist** (`packages/sandbox/src/scenario.ts`). Each maps to customer-visible states already specified above, which is the point: a demo walks the *real* journey, not a parallel one.

| Scenario | Customer-visible outcome | Screen |
|---|---|---|
| `HAPPY_PATH` | clean resolve → quote → pay → deliver | all |
| `SLOW_RESOLUTION` | staged escalation copy | `/` |
| `RESOLUTION_NEEDS_REVIEW` | `NEEDS_REVIEW` + per-field markers | `/` |
| `UNSUPPORTED_PRODUCT` | explicit rejection with reason | `/` |
| `PRICE_DRIFT_WITHIN_TOLERANCE` | quote holds; no customer action | `/`, `/checkout` |
| `PRICE_CHANGED_BREACH` | **J7 decision panel** | `/orders/<id>` |
| `OUT_OF_STOCK_AT_PROCUREMENT` | informational banner + automatic refund | `/orders/<id>` |
| `PAYMENT_DECLINED` | `PAYMENT_FAILED` + retry, "nothing has been charged" | `/checkout/return` |
| `PAYMENT_GATEWAY_TIMEOUT` | pending-payment state, then resolution | `/checkout/return` |
| `CUSTOMS_HOLD` | `CUSTOMS_EXCEPTION` — actionable, document request | `/orders/<id>` |
| `SHIPMENT_STALLED` | informational banner, "we're chasing the carrier" | `/orders/<id>` |
| `FX_PROVIDER_DOWN` | quote blocked with retry, never a stale rate | `/` |

**Requirements on the front office:**

- **Sandbox must be unmistakable.** A persistent, non-dismissible indicator whenever a sandbox session is active. Mock payment screens must be visibly sandbox and must never claim to contact a real provider (MASTER-PROMPT §PHASE 9) — the one demo rule with a real integrity cost if broken.
- **Virtual clock is a first-class control.** `advance(hours)` is how a multi-day fulfilment journey becomes demonstrable in minutes; the UI should make time advancement legible ("advanced 24h → order now at customs") rather than silently mutating state.
- **Scenario switching is explicit**, never inferred from environment alone.
- **Demo controls never occupy customer-journey space** — an overlay/panel, so the journey being demonstrated is the one a real customer sees.
- **Sandbox parity is the acceptance test:** every state in the coverage matrix above should be reachable via some scenario. Two are not reachable today — `notification`-dependent states (no system) and support/refund states (no domain surface) — which is a scenario-coverage gap to close alongside those features, tracked in the completeness review.

## Design-intelligence findings applied

Run against the installed `ui-ux-pro-max` guideline database (domains `ux`, `product`). Rules below either **confirmed** an existing decision or **added** a requirement; only material ones are listed.

**Added requirements:**
- **Inline validation on blur, not on keystroke.** Validating mid-typing on a Persian phone number or a postal code produces errors for input that isn't finished. Applies to `/login`, `/checkout` address, `/addresses`.
- **Disable the control during async submission to prevent double submission** (severity: high). Most consequential on the **J7 decision panel**, where a double-submit is a double state transition on a money-bearing order — reinforcing the idempotency-key requirement from the frontend side too, not just the API.
- **Errors announced, not just shown** — `role="alert"` / `aria-live` on every error surface. Partially present today (`page.tsx:100`); make it universal.
- **`inputmode` per field type** so mobile keyboards match (`type="url"`/`inputMode="url"` already on the paste field; needs `tel` on phone, `numeric` on OTP and postal code).
- **`prefers-reduced-motion` respected** (severity: high) — relevant to the timeline and any decision-panel transitions.
- **Skip-link to main content**, absent today.
- **Visible focus rings**, never removed without replacement.
- **Tabular figures for prices and totals**, so digits don't shift width as amounts change — matters on a screen whose headline is a number.
- **Animate 1–2 elements per view maximum.** A trust-first commerce surface should not be motion-heavy.

**Confirmed (already specified):** skeletons over spinners past ~1s; labels visible rather than placeholder-only; errors adjacent to their field; error messages carrying a recovery path; ≥44px touch targets; no horizontal scroll; ≥4.5:1 contrast; colour never the sole state carrier.

**Recorded tension, not adopted:** the database's style recommendation for the "E-commerce" product type is *Vibrant & Block-based* with a "brand primary + success green" palette. That optimizes for merchandising energy, which this product deliberately does not do — it is link-first with no catalog, and its conversion mechanism is *trust and pricing transparency* (see below), closer to the fintech/service end than to retail. **Recommendation for Phase 8:** treat the e-commerce style guidance as an input, not a default; the calmer, transparency-first direction is the better fit. Flagged rather than silently discarded, since Phase 8 owns the decision.

## Responsive behaviour

Mobile-first is a product constraint, not a preference — the beachhead audience is phone-first.

- **Single-column below ~640px.** No horizontal scroll on any customer surface.
- **Money is never truncated or wrapped mid-figure.** The landed-cost total is the most important glyph run in the product.
- **Timeline** is vertical on mobile (natural for RTL reading order), and may go horizontal ≥1024px if it stays legible — vertical is the safe default.
- **Decision panels are never below the fold on mobile** when the order is in an actionable exception state. A decision the customer must scroll to find is a decision they miss.
- **Quote breakdown** collapses to total + expand on mobile; expanded by default on wide screens.
- **Touch targets ≥44px**; primary CTAs full-width on mobile (already the pattern, `btn-block`).
- **Pinch-zoom stays enabled** — `maximumScale: 5` with the existing rationale that disabling it to feel native "takes that away from the people who need it most" (`layout.tsx:16-18`). Preserve this.

## Trust and conversion patterns

The product asks an Iranian consumer to pay in advance, in IRR, for a foreign item they cannot inspect, from a platform they don't yet know. Trust *is* the conversion mechanism.

- **One number, early, honestly.** Landed cost in Toman before any account is required. The existing decision to defer auth to checkout is the single strongest conversion choice in the product — preserve it.
- **Itemized breakdown available on demand.** A total that can be decomposed is a total that can be believed.
- **Show uncertainty rather than hiding it** — the existing weight-badge rationale: "a customer who was told the number might move is a customer who is not surprised later" (`ProductCard.tsx:6-11`). Generalize to all soft fields.
- **Recognition before commitment.** Image, title, brand, seller, and the resolved variant, explicitly — Phase 4's objective (1).
- **Reassure precisely at money moments.** "Nothing has been charged" on payment failure already does this well.
- **Never claim savings the customer can't reconcile.** Marketplace discounts display in AED at product level; do not translate into a Toman "you saved X" — FX and duty sit in between.
- **The sandbox must be unmistakably a sandbox.** Mock payment screens must never appear to contact a real provider (MASTER-PROMPT §PHASE 9). `DemoPanel` renders only when the sandbox is reachable (`layout.tsx:61-62`) — preserve that gating.

## Accessibility, RTL, localization

- `lang="fa" dir="rtl"` statically at the root; LTR content (URLs, seller names, tracking numbers) isolated via the existing `.ltr`/`.mono` helpers. Bidirectional isolation matters most where an LTR run sits inside a Persian sentence.
- Persian digits for display (`toPersianDigits` exists); inputs accept both Persian and Latin digits — a customer typing a phone number should never be told their own keyboard is wrong.
- Semantic landmarks (`header`/`main`/`footer` already present), one `h1` per screen, meaningful focus order, visible focus rings.
- Status changes announced via live regions — critical on `/checkout/return` (polling) and `/orders/<id>` (state changes during a session).
- Colour never the sole carrier of state: exception badges pair colour with text (already the pattern in `STATE_BADGES` / `ProductCard`).
- Target WCAG 2.1 AA contrast; verify in Phase 8 against real tokens rather than asserting it here.

## Open questions carried forward

1. **J7 decision SLA/timeout** — undesigned; shares a root with J8's stalled-case SLA. Design once (Phase 12).
2. **Notification system unwired** — the in-app attention badge (`front-office-ia.md`) mitigates but does not replace it.
3. **`REFUNDED`/`CANCELLED` have no customer-facing alert copy** (`state-matrix.md` §2).
4. **Address deletion with an in-flight order** — undesigned.
5. **SMS-provider outage has no fallback identity path** — J3.
6. **Layout not verified against a rendered Amazon UAE PDP** — direct fetch was blocked (Phase 4 limitation); re-verify before committing to product-card layout.

## Feeds

Phase 8 (design system — component inventory: product card, quote breakdown, timeline, exception banner, decision panel, address card, case thread, badge/skeleton/empty/error primitives), Phase 10 (APIs this IA requires but that don't exist: customer decision endpoint, address update/delete, support/refund, profile, notification preferences), Phase 11 (traceability), Phase 12 (`/orders/<id>` with J7 is the highest-value first work package — it closes a live "no dead ends" violation using transitions the backend already supports).
