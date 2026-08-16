# Journey Map

> Phase 3 of `docs/program/MASTER-PROMPT.md` — "complete journey architecture." Built on Phase 0–2 outputs (`docs/program/00-current-state-assessment.md`, `docs/product/*.md`) and verified against source (`platform/apps/api/src/domain/order-state-machine.ts`, `platform/packages/sandbox/src/scenario.ts`, `platform/apps/api/src/modules/admin.module.ts`, `platform/apps/api/src/common/http.ts`). Every journey below is modeled to the full element set MASTER-PROMPT §PHASE 3 requires; `docs/ux/service-blueprint.md` maps each to its frontstage/backstage mechanics and `docs/ux/state-matrix.md` maps order-state visibility/actions per role.

## How to read this

**Status tags:**
- **EXISTS** — built and wired end-to-end today (sandbox-complete unless noted).
- **PARTIAL** — built but structurally incomplete or inconsistent (Phase 0 finding).
- **GAP** — no UI/API surface exists; this journey is a genuine design deliverable of Phase 3, not a description of shipped behavior. These map directly to `mvp-vs-platform.md` MVP-now items 1–2 and to `PROJECT-STATE.md`'s unresolved questions.
- **TARGET** — backend today is a simpler mechanism (e.g. flat role string); the journey describes the state Phase 7/12 work should converge on, not current behavior.

Every journey element MASTER-PROMPT requires is present per journey, marked `n/a — <reason>` where genuinely inapplicable (never silently dropped).

## Actor scope for this pass

| Actor | Priority | Journeys |
|---|---|---|
| P1/P2 — Individual / frequent shopper | MVP-now | J1–J8 |
| Merchant's end customer (non-platform identity) | **platform-later (Line B)** — corrected, see note | J9 |
| I2/I3 — Procurement/ops + logistics operator | MVP-now | J10–J11 |
| I1 — Support operator | MVP-now | J12 |
| I4 — Finance/reconciliation operator | MVP-now | J13 |
| I5 — Compliance/risk operator | MVP-now | J14 |
| I6 — System administrator | MVP-now | J15 |
| P3/P4 — Social-commerce seller / small merchant (Line B) | platform-later | J16 |
| P7 — Organization owner (Line B/C) | platform-later | J17 |
| P5/P6 — Company purchaser / enterprise procurement operator (Line C) | platform-later | J18 |
| P8 — Finance approver (Line C) | platform-later | J19 |

> **Correction (Phase 5 review):** the merchant's end customer was originally classified MVP-now (edge). That was wrong. This actor is defined by their relationship to a **Line B merchant**, and merchants (P3/P4) are platform-later — a merchant's end customer cannot exist before merchants do. J9 is therefore platform-later, which is also what Phase 5's route inventory independently concluded when it deferred `/track/<token>`. Correcting the classification here rather than in the downstream doc, because an MVP-now journey with no MVP screen is a defect, whereas a platform-later journey with a reserved route is a plan. Recorded per MASTER-PROMPT §5.

Delegated buyer and first-time-buyer are usage variants of P1, folded into J3/J6 rather than given separate journeys. Anti-personas (`anti-personas.md`) are deliberately *not* journeys — see each journey's "Permission denial" / "Validation" rows for where their paths are cut off.

---

## Part A — MVP-now journeys

### J1 — Paste link → resolve → confirm product
**Actor:** P1/P2 · **Status:** EXISTS (sandbox-complete)

- **Entry point:** landing page paste-link box; a link shared by another user; a re-paste after a prior unsupported-product rejection.
- **Intent:** "I found this exact item abroad — get it to me, priced in Toman, and prove it's the same item."
- **Prerequisites:** none. Unauthenticated by design — auth is deferred to checkout so the highest-friction step never blocks discovery (CLAUDE.md: mobile-first, low cognitive load).
- **Happy path:** paste Amazon UAE URL → resolution ladder runs → title/image/brand/variation confirmed → proceed to J2.
- **Alternate paths:** multiple variations → variation picker; multiple sellers → default to the authoritative/lowest-risk offer, ~~list alternatives~~ (Phase 4 dependency: `docs/product/product-resolution.md`).
  > **Superseded by Phase 4** (`docs/ux/amazon-resolution-journeys.md`, Archetype 3): "list alternatives" is **not** built at MVP. A seller picker is a marketplace-browsing affordance, and the link-first RULE (`CLAUDE.md`: no catalog, search, or merchandising) cuts against it. Offer selection stays inside the strategy layer, and `ResolvedProduct.seller` remains singular so the quote engine never reasons about which offer it is pricing. If the chosen offer differs from what the customer saw, that surfaces as a price difference at checkout revalidation, which the revalidate-at-checkout RULE already handles. Recorded per MASTER-PROMPT §5 (never silently resolve a contradiction); the variation picker half of this alternate path stands unchanged.
- **Loading:** resolution progress indicator with elapsed-time framing — the ladder can fall through to slower fallback stages (`SLOW_RESOLUTION` sandbox scenario, `packages/sandbox/src/scenario.ts`).
- **Validation:** domain allow-list (Amazon UAE only at MVP); non-Amazon URLs get an explicit rejection message, not a silent failure — this is also where the catalog/search RULE is enforced at the edge (no freeform browsing entry point).
- **Empty states:** n/a — single-input form, not a list.
- **Missing data:** confirmed vs. inferred field provenance is a Phase 4 deliverable (`product-resolution.md`); until then, resolved fields are treated as confirmed-or-rejected, no partial-confidence UI.
- **Provider outage:** ladder exhausted → `RESOLUTION_NEEDS_REVIEW` scenario → routed to operator review, customer sees "we're confirming this by hand," not a dead end.
- **Permission denial:** n/a — public entry point.
- **Cancellation:** abandon before quoting — no order row exists yet (first persisted state is `DRAFT`, entered at the quote step; MASTER-PROMPT §PHASE 10 should confirm this precisely during work-package design).
- **Retries:** re-paste / edit URL, no rate limit surfaced to the customer at MVP.
- **Recovery:** `UNSUPPORTED_PRODUCT` scenario → explicit "we can't fulfill this yet" message with a reason, never a generic error.
- **Async waiting:** resolution ladder progress only; no notification needed (synchronous, seconds-scale).
- **Notifications:** none required.
- **Support escalation:** "this isn't the right product" — **GAP**, no link into a support path today; should route into J8.
- **Terminal states:** confirmed product → J2; abandoned → no persisted state; rejected as unsupported → dead-end with reason shown (not silent).

### J2 — Quote → explanation → decision
**Actor:** P1/P2 · **Status:** EXISTS (sandbox-complete)

- **Entry point:** immediately after J1's product confirmation.
- **Intent:** "Show me the true landed cost before I commit to anything, and let me trust the number."
- **Prerequisites:** confirmed product from J1.
- **Happy path:** landed-cost quote computed (item + duties + logistics + margin) → itemized breakdown shown → customer proceeds to J3/J5.
- **Alternate paths:** quote near the v0.3 minimum-order-value viability threshold → explicit "this item alone isn't cost-effective to ship" framing rather than a bare block (viability-gate RULE, CLAUDE.md).
- **Loading:** FX + logistics-rate lookups behind cache-aside — near-instant on cache hit, brief spinner on miss.
- **Validation:** quantity limits / customs-restricted categories surfaced here, not after payment.
- **Empty states:** n/a.
- **Missing data:** if a logistics rate card doesn't cover the destination/category combination, the customer sees "not serviceable to your address yet," not a wrong number.
- **Provider outage:** `FX_PROVIDER_DOWN` scenario (`packages/sandbox/src/scenario.ts`) → quote generation blocked with a retry affordance, never a stale/estimated FX rate presented as final.
- **Permission denial:** n/a — still unauthenticated.
- **Cancellation:** leave without proceeding — quote/DRAFT expires per its TTL (`CLAUDE.md`: "revalidate at checkout" implies the quote is not indefinitely valid).
- **Retries:** re-run quote after an FX-outage failure.
- **Recovery:** viability-blocked quote → no forced dead end; customer can still request manual review for bundling (routes toward J8, currently a **GAP**).
- **Async waiting:** n/a — synchronous.
- **Notifications:** none required (synchronous, same session).
- **Support escalation:** "why is this the price" beyond the itemized breakdown — folds into J8 (**GAP**).
- **Terminal states:** accepted → J3/J5; abandoned → quote expires unused; blocked-by-viability → explicit terminal message, no order created.

### J3 — Authentication (signup / login / OTP)
**Actor:** P1/P2, delegated buyer, first-time buyer · **Status:** EXISTS

- **Entry point:** triggered at checkout (J5), not before — see J1/J2 prerequisites.
- **Intent:** "Prove who I am with the least friction, on a phone number I already trust."
- **Prerequisites:** a quote in hand from J2 (auth is contextual, not a standalone destination).
- **Happy path:** phone number → OTP → session established → return to checkout with quote intact.
- **Alternate paths:** returning user → password or OTP; first-time buyer → same flow, account created implicitly on first successful OTP (no separate "signup" ceremony per link-first product principle).
- **Loading:** OTP dispatch/verify spinner.
- **Validation:** phone format, OTP expiry/attempt limits.
- **Empty states:** n/a.
- **Missing data:** n/a.
- **Provider outage:** SMS provider down → **GAP** — no fallback identity provider or degraded-mode path is documented; `StubSmsAdapter`/`FakeSmsAdapter` exist only for sandbox (`apps/api/src/composition/adapters.ts`), real-provider outage handling is undesigned. Flag for Phase 10/12.
- **Permission denial:** n/a — this journey *establishes* the permission.
- **Cancellation:** abandon mid-OTP → return to J2's quote, unauthenticated.
- **Retries:** resend OTP with backoff/cooldown.
- **Recovery:** wrong number entered → edit before dispatch; too many failed attempts → cooldown, not a hard lockout without recovery path.
- **Async waiting:** OTP delivery latency (seconds).
- **Notifications:** the OTP SMS itself is the only notification in this journey and is the one instance of the notification system that is real today (`StubSmsAdapter`) — everything else in the platform's notification story is a **GAP** (see "Cross-cutting: notifications" below).
- **Support escalation:** can't receive OTP → **GAP**, no alternate-verification or support path documented.
- **Terminal states:** authenticated session → resumes checkout at J5; delegated-buyer session scoping — **GAP**, no delegated-buyer mechanism exists in the account model beyond the conceptual note in `account-and-organization-model.md`.

### J4 — Address management
**Actor:** P1/P2 · **Status:** GAP (mvp-vs-platform.md item 3 — today inline-only in checkout, no standalone add/edit/delete)

- **Entry point:** profile/settings, or "manage addresses" link from checkout.
- **Intent:** "Save my address once, reuse it, fix it without re-entering it inside a purchase."
- **Prerequisites:** authenticated session (J3).
- **Happy path:** list saved addresses → add/edit/set-default → return to caller (checkout or settings).
- **Alternate paths:** first address ever → prompted inline during first checkout (existing behavior), but a return visit should find it saved and reusable — this reuse path is exactly what's missing today.
- **Loading:** address list fetch.
- **Validation:** address-field validation bilingual (fa/en) per CLAUDE.md; delivery-serviceability check against supported zones (ties to J2's "not serviceable" case).
- **Empty states:** no saved addresses → prompt to add one, not a blank screen.
- **Missing data:** n/a.
- **Provider outage:** n/a (no external provider in this journey; a future geocoding/validation provider would need a port per CLAUDE.md's "every outbound third-party call goes through a port" rule).
- **Permission denial:** cannot edit another account's address — ties to RBAC (J15) for the operator side; on the customer side this is simple ownership scoping.
- **Cancellation:** discard edit-in-progress.
- **Retries:** re-submit on validation failure.
- **Recovery:** delete an address currently referenced by an in-flight order → must be blocked or handled explicitly (undesigned edge case, flag for Phase 10).
- **Async waiting:** n/a.
- **Notifications:** none required.
- **Support escalation:** n/a.
- **Terminal states:** address saved/updated/deleted and available at next checkout.

### J5 — Checkout → payment → return
**Actor:** P1/P2 · **Status:** EXISTS (sandbox-complete; real gateway is EXTERNAL-GATE)

- **Entry point:** "proceed" from J2, post-authentication (J3).
- **Intent:** "Pay once, in IRR, and know immediately whether it worked."
- **Prerequisites:** authenticated session, address (J4), a quote still within its TTL.
- **Happy path:** revalidate offer/availability/FX and lock the quote (CLAUDE.md "revalidate at checkout" RULE) → select/confirm address → pay → gateway return → `PAID` → order confirmation.
- **Alternate paths:** quote TTL expired at checkout → re-quote before payment, not a silent stale charge.
- **Loading:** gateway redirect/return polling — confirmed in code: `apps/web/app/checkout/return/page.tsx` polls against a `SETTLED_STATES` set including exception states, so the polling loop itself already treats exceptions as terminal-for-polling-purposes.
- **Validation:** idempotency key on the payment-initiating mutation (CLAUDE.md: "every mutating endpoint that touches money... takes an idempotency key").
- **Empty states:** n/a.
- **Missing data:** n/a — checkout requires everything upstream to be resolved first.
- **Provider outage:** `PAYMENT_DECLINED` and `PAYMENT_GATEWAY_TIMEOUT` sandbox scenarios exist and drive `AWAITING_PAYMENT → PAYMENT_FAILED`; the alert copy ("nothing has been charged") is already written (`order-state-machine.ts` `ALERTS.PAYMENT_FAILED`).
- **Permission denial:** n/a — ownership-scoped to the authenticated customer.
- **Cancellation:** abandon at gateway → returns to `AWAITING_PAYMENT`/`PAYMENT_FAILED`, retryable, not stuck.
- **Retries:** `PAYMENT_FAILED → AWAITING_PAYMENT` is a legal transition (`TRANSITIONS` table) — retry is structurally supported.
- **Recovery:** duplicate gateway callback — sandbox scenario list doesn't explicitly name this but MASTER-PROMPT §PHASE 9 requires it; idempotency key is the mechanism, needs an explicit test (flag for Phase 9/12).
- **Async waiting:** gateway round-trip; `AWAITING_PAYMENT` is genuinely pending state, not just a UI spinner.
- **Notifications:** payment success/failure should notify even if the customer closes the tab mid-flow — **GAP**, no notification system is wired (see cross-cutting note).
- **Support escalation:** "I was charged but the order doesn't show it" — **GAP**, folds into J8.
- **Terminal states:** `PAID` (success, proceeds toward fulfillment) or `PAYMENT_FAILED` (retryable) or `CANCELLED` (abandoned).

### J6 — Order list, detail & tracking
**Actor:** P1/P2 · **Status:** EXISTS (sandbox-complete)

- **Entry point:** post-purchase, "my orders" nav, or a direct order-detail link (e.g. from a notification, once J5/J7's notification gaps are closed).
- **Intent:** "Know exactly where my thing is without contacting anyone."
- **Prerequisites:** authenticated session; at least one order.
- **Happy path:** order list → order detail → 8-step normalized timeline (`CONFIRMED → PURCHASED → DISPATCHED → AT_WAREHOUSE → INTERNATIONAL → ARRIVED_IRAN → OUT_FOR_DELIVERY → DELIVERED`, `buildCustomerTimeline()` in `order-state-machine.ts`) — this is the CLAUDE.md "unified tracking normalizes... never leak raw carrier statuses" RULE, confirmed implemented exactly as specified.
- **Alternate paths:** order in an exception state → timeline still renders at its last real step, plus a banner from `alertFor(state)` (already-written bilingual copy) rather than a fabricated new stage — this is a strong existing pattern J7 must not break.
- **Loading:** list/detail fetch, tracking refresh.
- **Validation:** n/a (read surface).
- **Empty states:** no orders yet → prompt back to J1, not a bare "no data."
- **Missing data:** carrier status string with no mapping → `normalizeCarrierStatus()` returns `null` and logs for a human to add (`order-state-machine.ts:110-112`) — correctly never leaks an unmapped raw status to the customer; the "human adds a mapping" side of this has no operator surface (**GAP**, small, flag for Phase 6).
- **Provider outage:** `SHIPMENT_STALLED`/`CUSTOMS_HOLD` scenarios covered; alert copy already exists (`ALERTS.SHIPMENT_EXCEPTION`, `ALERTS.CUSTOMS_EXCEPTION` — though the customs alert route is via `CUSTOMS_EXCEPTION`/`CUSTOMER_ACTION_REQUIRED`, not `CUSTOMS_HOLD` as a distinct customer-visible state).
- **Permission denial:** cannot view another account's order — ownership scoping.
- **Cancellation:** n/a — this is a read journey (cancellation belongs to J2/J5).
- **Retries:** manual refresh.
- **Recovery:** n/a.
- **Async waiting:** tracking updates arrive asynchronously from carrier/worker events — no live push to the customer today beyond polling/refresh (**GAP** ties to notifications).
- **Notifications:** state-change notifications ("your order shipped," "customs hold") — **GAP**, `NotificationPort`/`NotificationChannel` types exist (`packages/core/src/ports.ts`) and a `notification.requested` event constant exists (`packages/core/src/events.ts`) but nothing implements, binds, emits, or consumes it (confirmed: zero adapter, zero worker consumer). This is the single highest-leverage cross-cutting gap in the entire journey set.
- **Support escalation:** "my tracking looks wrong / stuck" → folds into J8 (**GAP**).
- **Terminal states:** `DELIVERED` (success), `REFUNDED` (resolved via exception), `CANCELLED`.

### J7 — Customer exception decision (price-changed / out-of-stock / customer-action-required)
**Actor:** P1/P2 · **Status:** GAP — mvp-vs-platform.md item 1; this is the single most important net-new journey in this document.

- **Entry point:** a banner/notification on the order detail page (J6) when the order enters `PRICE_CHANGED`, `PAYMENT_FAILED` (already actionable via J5's retry), `CUSTOMS_EXCEPTION`, or `CUSTOMER_ACTION_REQUIRED` — precisely the states where `alertFor(state).actionable === true` in `order-state-machine.ts`. `OUT_OF_STOCK`, `PROCUREMENT_FAILED`, and `SHIPMENT_EXCEPTION` are `actionable: false` by existing design — the customer is informed, not asked to decide, because there is nothing for them to decide (refund/retry is automatic or operator-owned). **J7 must respect this existing actionable/non-actionable split, not invent new customer decisions where the code has deliberately decided there isn't one.**
- **Intent:** "The plan changed — let me choose what happens to my money and my order, right now, not by calling someone."
- **Prerequisites:** order in an `actionable: true` exception state; authenticated session (ownership).
- **Happy path (PRICE_CHANGED):** banner shows new vs. approved price and the delta → customer chooses "approve new price and continue" (→ `PROCUREMENT_PENDING`) or "cancel and refund" (→ `REFUND_PENDING`) — both are legal edges from `PRICE_CHANGED` in `TRANSITIONS`, so this journey requires no new backend state, only a customer-facing mutation that exercises existing legal transitions (today only reachable via the operator-only `POST /admin/orders/{id}/transition` and `reprice` endpoints).
- **Alternate paths (CUSTOMS_EXCEPTION / CUSTOMER_ACTION_REQUIRED):** customer supplies a requested document/answer → routes to `DOMESTIC_TRANSIT` (resume) per the existing transition table; customer instead requests cancellation → `REFUND_PENDING`.
- **Loading:** decision-submission spinner.
- **Validation:** decision must be submitted before any operator-side timeout auto-resolves it (see "Recovery" below) — race condition needs an explicit lock/idempotency design, not assumed away.
- **Empty states:** n/a.
- **Missing data:** if the required document type isn't specified by the customs adapter, show a generic "we'll follow up by message" fallback rather than blocking on an unknown field.
- **Provider outage:** n/a within this journey (the outage already happened upstream, causing the exception state).
- **Permission denial:** only the owning customer can decide; an operator can still override via the existing admin endpoint (both paths must write to the same immutable timeline — CLAUDE.md "every order state change goes through the transition table").
- **Cancellation:** "cancel and refund" *is* one of the two decisions, not a separate control.
- **Retries:** re-submit decision if the mutation fails transiently (idempotency key required per CLAUDE.md).
- **Recovery:** customer doesn't respond within an SLA window → **undesigned today** even conceptually; needs a defined timeout policy (e.g. auto-escalate to operator, or auto-refund) before this ships — flag explicitly for Phase 10/12, do not silently assume "wait forever."
- **Async waiting:** the exception state itself is the waiting state; no additional async step once a decision is submitted (the transition is synchronous).
- **Notifications:** this is the journey most urgently blocked by the missing notification system — an exception the customer never sees (because they didn't happen to open the app) defeats the entire journey. Notification-on-exception-raised is a hard prerequisite for J7's real-world value, even though the UI itself can be built independently.
- **Support escalation:** "I don't understand why the price changed" → folds into J8.
- **Terminal states:** decision recorded → order proceeds down `PROCUREMENT_PENDING`/`DOMESTIC_TRANSIT` or `REFUND_PENDING → REFUNDED`.

### J8 — Support & refund request
**Actor:** P1/P2 · **Status:** GAP — mvp-vs-platform.md item 2; ledger/state machine anticipates this (`REFUND_PENDING`/`REFUNDED` states, a `refund` method on the payment port at `apps/api/src/composition/adapters.ts:532,539`) but zero controller, route, or table exists on either side (`ledgerEntries`/`reconciliationItems` are the only related tables; no `support`/`refund` table).

- **Entry point:** every other journey's "support escalation" row (J1, J2, J3, J4, J6, J7) links here; also a standalone "contact support" entry from settings.
- **Intent:** "Get a human (or a fast automated resolution) when something in the automated flow doesn't work for me."
- **Prerequisites:** authenticated session; optionally an order reference.
- **Happy path:** open a case against an order (or general) → describe issue → case created → operator (I1, J12) responds → resolution recorded → case closed, with a refund transition (`X → REFUND_PENDING → REFUNDED`) triggered where applicable through the *existing* state machine, not a parallel money path (must reuse `TRANSITIONS`, never bypass it — CLAUDE.md invariant).
- **Alternate paths:** case doesn't involve an order (general inquiry); case results in no refund (informational only); case results in a partial adjustment (needs a domain decision — full order refund is modeled, *partial* refund is not, per the ledger schema seen — flag for Phase 10).
- **Loading:** case list/detail fetch, submission spinner.
- **Validation:** required fields (order reference format, description length); rate-limiting to prevent spam is a reasonable but undesigned control.
- **Empty states:** no cases yet → prompt, not blank.
- **Missing data:** n/a.
- **Provider outage:** n/a (internal workflow, no third-party in the customer-facing half; the refund's *execution* does call the payment port's `refund` method, which is EXTERNAL-GATE and must go through the same proxy chain — cache→circuit-breaker→retry→timeout→instrumentation→adapter — as every other outbound call).
- **Permission denial:** customer sees only their own cases; operator sees the full queue (J12) scoped by RBAC (J15, still TARGET not current state).
- **Cancellation:** customer withdraws a case before resolution.
- **Retries:** resubmit on transient failure.
- **Recovery:** case stalls with no operator response → needs an SLA/escalation policy (undesigned, same category of gap as J7's recovery row — both should probably share one "exception SLA" design, flag for Phase 12 to avoid building two divergent mechanisms).
- **Async waiting:** case is inherently async (operator response time) — this is the journey where notifications matter most on both sides (customer: "we replied"; operator: "new case").
- **Notifications:** **GAP**, same root cause as J6/J7.
- **Support escalation:** n/a — this *is* the escalation path.
- **Terminal states:** case resolved-no-refund, resolved-with-refund (`REFUNDED`), or withdrawn.

### J9 — Merchant's end customer: branded tracking (no login)
**Actor:** merchant's end customer (not a platform identity) · **Status:** GAP — conceptually named in `personas.md` as an edge case; no surface designed. Kept intentionally light because it is a Line B dependency, not Line A MVP-blocking.

- **Entry point:** a tracking link sent by a Line-B merchant to their own customer (outside this platform's auth boundary).
- **Intent:** "Track a parcel I bought from a shop I know, without creating yet another account."
- **Prerequisites:** a valid, unguessable tracking token (not a session) — must not leak the merchant's or platform's internal order identifiers.
- **Happy path:** open link → read-only normalized 8-step timeline (reuses J6's `buildCustomerTimeline` output), branded with the merchant's identity, not the platform's.
- **Alternate paths:** n/a — deliberately minimal.
- **Loading:** timeline fetch.
- **Validation:** token validity/expiry.
- **Empty states:** n/a.
- **Missing data:** same carrier-normalization gap as J6.
- **Provider outage:** same as J6.
- **Permission denial:** invalid/expired token → generic "not found," never a hint that leaks whether an order ID exists (anti-enumeration).
- **Cancellation:** n/a.
- **Retries:** re-open link.
- **Recovery:** n/a.
- **Async waiting:** same as J6.
- **Notifications:** out of scope for MVP (belongs to the merchant relationship, not this platform, until Line B ships).
- **Support escalation:** routes to the *merchant*, not this platform's support (J8) — an explicit boundary to preserve, since this platform never owns the merchant's end-customer relationship at MVP.
- **Terminal states:** same terminal set as J6, rendered read-only.

---

## Part B — Internal operator journeys (MVP-now)

### J10 — Exception queue triage
**Actor:** I2 (procurement/ops), I3 (logistics, folded in) · **Status:** PARTIAL — queue read + two mutation actions exist; ranking is nominal, not adaptive (`updateRanks()` in `packages/db/src/repositories.ts` is defined but never called; `rankedBy` defaults to `'deterministic'`).

- **Entry point:** admin console default view — CLAUDE.md RULE: "the back office default view is the ranked exception queue... never a list of healthy orders." Confirmed as the actual default (`OpsService.listExceptions`, `admin.module.ts:68-97`).
- **Intent:** "Show me only what needs a human, in the order that matters, so I never have to scan healthy orders."
- **Prerequisites:** `ops`/`admin` role (flat string check today, `apps/api/src/common/http.ts:256`).
- **Happy path:** queue loads, ranked → operator opens an exception (`PRICE_CHANGED`, `OUT_OF_STOCK`, `PROCUREMENT_FAILED`, `SHIPMENT_EXCEPTION`, or `CUSTOMS_EXCEPTION` — all five have localized summaries in `summariseException()`, `admin.module.ts:576-600`) → takes an action → exception clears from the queue.
- **Alternate paths:** each exception type has a different resolving action: `PRICE_CHANGED`/procurement issues → `reprice` (`POST /admin/orders/{id}/reprice`); any type → generic `transition` (`POST /admin/orders/{id}/transition`, gated by the same `TRANSITIONS` table as the automated path — no operator override bypasses domain rules).
- **Loading:** queue fetch/refresh.
- **Validation:** any transition attempted must be a legal edge in `TRANSITIONS` — illegal transitions throw (`assertTransition`), surfaced as an explicit error, not silently ignored.
- **Empty states:** zero open exceptions → explicit "queue clear" state (a genuinely good state for this actor, should be framed positively, not as an error/empty-data pattern).
- **Missing data:** an exception with no clean resolving action available (e.g. `SHIPMENT_EXCEPTION` needing carrier follow-up outside the system) → operator needs a "still working, not stuck" affordance — currently just sits in the queue with no explicit "in progress" sub-state (small gap).
- **Provider outage:** n/a directly — this journey is the human response *to* provider outages surfaced elsewhere.
- **Permission denial:** non-ops/admin role → blocked at the route (`http.ts:256`); flat-role model means no finer scoping (e.g. logistics-only operator seeing procurement exceptions) — acceptable in the TARGET RBAC model (J15) but a real gap today per I3's job description ("logistics operator... folds into ops surface for now").
- **Cancellation:** n/a.
- **Retries:** re-attempt a failed transition/reprice call.
- **Recovery:** wrong action taken → must go through a *further* legal transition, never a raw data edit (no generic update endpoint exists for order state — confirmed, this is correct per CLAUDE.md "no generic update endpoints that permit invalid domain transitions").
- **Async waiting:** n/a — actions are synchronous mutations.
- **Notifications:** operator should be notified of *new* high-rank exceptions rather than relying on manual queue refresh — **GAP**, same root cause as the customer-side notification gaps.
- **Support escalation:** n/a — I2 *is* the escalation target for J1/J2/J6/J7's undesigned support links, until J8/J12 exist as a distinct support layer.
- **Terminal states:** exception resolved → order continues down its normal path or into `REFUND_PENDING`/`CANCELLED`.

### J11 — Manual order transition / override
**Actor:** I2 · **Status:** EXISTS

- **Entry point:** order detail view in admin console, reached from J10 or direct search.
- **Intent:** "Move this specific order forward when the automated path can't, using exactly the rules the system already trusts."
- **Prerequisites:** `ops`/`admin` role.
- **Happy path:** select target state → `TRANSITIONS` table validates → transition recorded to the immutable timeline (CLAUDE.md: "every order state change goes through the transition table... appends to an immutable timeline").
- **Alternate paths:** reprice action (`OpsService.reprice`, `admin.module.ts:268`) as a specialized transition for price-related exceptions.
- **Loading:** submit spinner.
- **Validation:** `assertTransition` — illegal target states are rejected with a clear error, valid targets are the only ones offerable in the UI (should not even present illegal options — a UI-layer requirement, not just a backend guard).
- **Empty states:** n/a.
- **Missing data:** n/a.
- **Provider outage:** n/a.
- **Permission denial:** same as J10.
- **Cancellation:** discard before submit.
- **Retries:** resubmit on transient failure.
- **Recovery:** n/a — by design there is no "undo," only a further legal forward transition, consistent with the immutable-timeline invariant.
- **Async waiting:** n/a.
- **Notifications:** the customer-facing consequence of this action re-triggers J6/J7's (currently missing) notification needs.
- **Support escalation:** n/a.
- **Terminal states:** any legal target state, including terminal ones (`DELIVERED`, `REFUNDED`, `CANCELLED`).

### J12 — Support case handling
**Actor:** I1 (support operator) · **Status:** GAP — no surface exists on either side; this is I1's entire job today with zero tooling ("no surface yet" per `personas.md`/`PROJECT-STATE.md`).

- **Entry point:** support queue (mirrors J10's exception-queue pattern but for J8 cases, not order-state exceptions).
- **Intent:** "Resolve a customer's case with full order/ledger context, without hunting across systems."
- **Prerequisites:** support role (needs its own RBAC scope distinct from `ops`/`admin` — currently there is no such role at all).
- **Happy path:** case queue → open case with linked order/ledger context → respond/resolve → optionally trigger a refund transition (reusing the same state-machine path as J11, not a separate mechanism).
- **Alternate paths:** case requires an ops action (e.g. a reprice) → hand off to I2 rather than duplicate ops capability inside the support surface.
- **Loading:** queue/case fetch.
- **Validation:** resolution requires a recorded outcome (not just closing silently) for audit purposes.
- **Empty states:** empty queue → positive "caught up" state, same pattern as J10.
- **Missing data:** case references an order that no longer exists / was merged — undesigned edge case.
- **Provider outage:** refund execution outage → same payment-port `refund` failure handling as J8.
- **Permission denial:** support role should see case+order+ledger context but not have ops's full transition authority — needs its own scope in the TARGET RBAC model (J15).
- **Cancellation:** n/a.
- **Retries:** resubmit failed resolution/refund action.
- **Recovery:** case reopened after "resolved" if the customer disputes — needs an explicit reopen path, not a new case every time.
- **Async waiting:** waiting on customer reply.
- **Notifications:** **GAP** — operator needs new-case alerts; customer needs reply alerts (shared root cause with every other notification gap in this document).
- **Support escalation:** n/a — I1 is the escalation target.
- **Terminal states:** case resolved (with or without refund), or reopened.

### J13 — Reconciliation review
**Actor:** I4 (finance/reconciliation operator) · **Status:** PARTIAL — `reconciliationItems` table exists (`packages/db/src/schema.ts:400-417`); whether an automated matcher populates/clears it (per `feasibility-revalidation-v0.2.md`) was flagged unconfirmed in `PROJECT-STATE.md` and not verified in this pass — treat as PARTIAL until checked.

- **Entry point:** finance/reconciliation view in admin console.
- **Intent:** "Confirm every rial/dirham in the ledger reconciles against real settlement, and see FX exposure."
- **Prerequisites:** finance role (flat today).
- **Happy path:** reconciliation queue of unmatched/flagged `ledgerEntries` ↔ `reconciliationItems` → operator confirms match or flags a discrepancy.
- **Alternate paths:** discrepancy escalates to a case (ties toward J12/J8 if it's customer-caused, or stays internal if it's provider-caused).
- **Loading:** ledger/reconciliation fetch, likely paginated given volume.
- **Validation:** `Money` value-object invariants (CLAUDE.md: arithmetic throws on currency mismatch) apply throughout — no ad-hoc numeric handling in this surface.
- **Empty states:** fully reconciled period → positive terminal state, not framed as "nothing to show."
- **Missing data:** a ledger entry with no matching external settlement record yet (timing lag) vs. a genuine discrepancy — needs a clear distinguishing UI state, not one generic "unmatched" bucket.
- **Provider outage:** settlement feed from a payment/FX provider is delayed or down — same EXTERNAL-GATE pattern as elsewhere.
- **Permission denial:** finance-only visibility into raw ledger entries — sensitive surface, needs its own RBAC scope (TARGET, J15).
- **Cancellation:** n/a.
- **Retries:** re-run matching after a feed catches up.
- **Recovery:** manual override of a match — must itself be an audited action (CLAUDE.md: AI never produces/writes a financial record; by extension manual overrides need the same auditability as automated ones).
- **Async waiting:** settlement feeds arrive on their own schedule.
- **Notifications:** discrepancies above a threshold should alert I4 proactively — **GAP**, same shared cause.
- **Support escalation:** n/a (I4 is upstream of, not a target for, customer escalation).
- **Terminal states:** entry matched, flagged-and-resolved, or flagged-and-escalated.

### J14 — Compliance/risk review
**Actor:** I5 (compliance/risk operator) · **Status:** GAP — "no surface yet," lighter journey since Line A's compliance exposure is bounded (personal-import/AML limits, not enterprise-scale) but the RULE is non-negotiable: "no architecture path may depend on concealment, account sharing, or bypassing marketplace/AML controls... the compliance gate is the master switch before production" (CLAUDE.md).

- **Entry point:** a flagged-order queue, likely populated by rule-based triggers (customs-limit proximity, repeated-address patterns matching anti-persona AP2/AP3 signatures from `anti-personas.md`) — the triggering logic itself is undesigned (Phase 10/12).
- **Intent:** "Catch structuring/concealment/limit abuse before it becomes a real compliance incident, proactively."
- **Prerequisites:** compliance role (no such role exists today, flat or scoped).
- **Happy path:** flagged order/customer reviewed → cleared or escalated (e.g. hold order, contact customer, involve customs/legal).
- **Alternate paths:** pattern spans multiple orders/customers (structuring) → needs cross-order visibility, not just single-order review.
- **Loading:** flagged-item fetch.
- **Validation:** n/a (review, not data entry).
- **Empty states:** no flags → positive state.
- **Missing data:** insufficient signal to decide → escalate rather than guess.
- **Provider outage:** n/a.
- **Permission denial:** this is one of the most sensitive internal surfaces — must not be visible to ops/support/finance roles by default (TARGET RBAC, J15).
- **Cancellation:** n/a.
- **Retries:** n/a.
- **Recovery:** false positive → clear with a recorded reason (audit trail).
- **Async waiting:** n/a.
- **Notifications:** new flags should alert I5 — **GAP**, same shared cause.
- **Support escalation:** compliance holds may surface to the customer as `CUSTOMS_EXCEPTION`/`CUSTOMER_ACTION_REQUIRED` (existing states) rather than a new customer-visible "compliance" concept — reuse, don't invent.
- **Terminal states:** cleared, order held, or escalated externally (legal/compliance, outside this system).

### J15 — Access grant / revoke (RBAC administration)
**Actor:** I6 (system administrator) · **Status:** TARGET — describes the Permission/Role/Scope model MASTER-PROMPT §PHASE 7 requires; today's reality is a single `actor.role: string` field checked by `@Roles()` decorator membership (`apps/api/src/common/http.ts:200-201,207-208,256`), confirmed to have no Role/Permission/Scope tables at all.

- **Entry point:** admin console user/role management (does not exist today).
- **Intent:** "Grant exactly the access a person needs, see who has what, revoke it instantly and provably."
- **Prerequisites:** admin role, itself subject to the same model it manages (careful bootstrap consideration).
- **Happy path:** find user → assign role(s) scoped appropriately (`PLATFORM` vs `ORGANIZATION` per `account-and-organization-model.md`'s already-decided scoping) → change takes effect immediately, backend-enforced (not just hiding nav — MASTER-PROMPT §PHASE 7 explicit requirement).
- **Alternate paths:** organization-scoped role assignment (Line B/C, platform-later) vs. platform-scoped internal-ops role assignment (MVP-now). *(Updated per ADR-001: internal ops is `PLATFORM` scope, not `Organization(kind=INTERNAL_OPS)`.)*
- **Loading:** user/role list fetch.
- **Validation:** cannot remove the last admin (lockout prevention); cannot self-escalate without a second approver (reasonable control, undesigned in detail).
- **Empty states:** n/a.
- **Missing data:** n/a.
- **Provider outage:** n/a.
- **Permission denial:** only admins reach this surface at all.
- **Cancellation:** discard pending change.
- **Retries:** resubmit on failure.
- **Recovery:** revoke immediately reflects in the next authorization check (no caching staleness allowed for permission checks — a specific constraint to carry into Phase 7/10 design given the platform's cache-aside default elsewhere).
- **Async waiting:** n/a.
- **Notifications:** user should be notified their access changed — minor, same shared gap.
- **Support escalation:** n/a.
- **Terminal states:** role/permission assignment active, with full audit trail (CLAUDE.md/§PHASE 7: "Audit trail" is an explicit modeled concept, not an afterthought).

---

## Cross-cutting: notifications

Every journey above that touches an asynchronous state change (J1 provider-outage recovery, J5 payment result, J6 tracking updates, J7's entire premise, J8 case replies, J10/J12/J13/J14's "new item to review" alerts, J15's access-change confirmation) is blocked on the same root cause: `NotificationPort`/`NotificationChannel` types exist (`packages/core/src/ports.ts:118,148-151`) and a `notification.requested` event constant exists (`packages/core/src/events.ts:61`), but **no adapter, no DI binding, no emitter, and no worker consumer exists anywhere in the tree.** The only real notification today is OTP SMS (J3), which uses a separate, narrower stub adapter, not the `NotificationPort` abstraction.

This is recorded once here rather than as sixteen duplicate GAP rows because it is one architectural piece of work (a `NotificationPort` adapter + worker consumer + trigger points at each state-changing use case), not sixteen. **Assumption, recorded per MASTER-PROMPT §1:** notifications are in-scope for Line A MVP (not platform-later) because J7 — an explicit MVP-boundary item — is structurally unusable without them. **Confidence: high. Alternatives considered:** treat J7 as "banner-only, no push notification" for MVP and defer the notification system — rejected because a customer who doesn't happen to open the app during the SLA window (see J7's "Recovery" gap) has no way to know a decision is needed, which fails CLAUDE.md's "manage-by-exception" principle from the customer's own side. **Reversal cost:** low — deferring is always possible later by simply not building the adapter yet; the port/event already exist, so no rework would be needed if deferred and revisited.

---

## Part C — Platform-later journeys (directional only)

These are intentionally not modeled to the full 18-element depth above — full-depth modeling before Line B/C's own discovery phases (deferred per `mvp-vs-platform.md`) would be premature design. Each is a placeholder naming what's reused vs. net-new, to keep Phase 3 honest about scope rather than silently omitting these actors.

### J16 — Merchant order submission & panel (P3/P4, Line B)
**Reuses from D:** resolution (J1), quote (J2), payment rails (J5, wallet-mode delta), procurement engine, tracking (J6) with per-merchant branding (extends J9's pattern). **Net-new:** wholesaler-mode pricing, prepaid wallet balance/top-up, embedded panel UX, bulk/multi-order submission. **Status:** platform-later, reversal cost low (`mvp-vs-platform.md`).

### J17 — Organization setup & team access (P7, Line B/C)
**Reuses from D:** the `Organization`/`OrganizationMembership`/`Role`/`Permission` model already designed scope-ready in `account-and-organization-model.md` (Phase 2) specifically so this doesn't require a rebuild. **Net-new:** invite/join flows, org-scoped role assignment UI (extends J15's TARGET model to organization scope). **Status:** platform-later; the open architectural fork (internal-ops-as-Organization, Phase 7 ADR) must resolve before this journey is finalized.

### J18 — Enterprise procurement request (P5/P6, Line C)
**Reuses from D:** resolution/quote/procurement/tracking engine, generalized beyond single-item paste-link toward spec/BOM-style requests (per `business-lines.md` §C). **Net-new:** managed-desk entry wedge (consolidation + tracking dashboard first, not full self-serve procurement), deposit/milestone money model (needs the wallet/escrow abstraction flagged platform-later for Phase 10). **Status:** platform-later, entered last per explicit governing-doc sequencing.

### J19 — Spend approval (P8, Line C)
**Net-new, no reuse:** no approval-workflow entity exists in the domain model at all today — this is the least-built journey in the entire program (`PROJECT-STATE.md`: "not designed yet"). **Status:** platform-later, blocks Line C's finance-approver JTBD entirely until designed.

---

## Traceability forward

Every GAP/TARGET journey above becomes a work-package candidate for Phase 12; every EXISTS/PARTIAL journey's file:line citations feed `docs/ux/service-blueprint.md` directly. `docs/program/journey-capability-traceability.md` (Phase 11) will formalize the full journey→screen→API→domain→persistence→adapter→permission→test matrix once Phase 5/6/10 produce the corresponding screens and APIs — this document is the input to that, not a substitute for it.
