# Tranche 4 — Experience convergence (WP-17 … WP-22)

---

## WP-17 — Design tokens & money presentation

**P1 · financial + UI · Contexts:** design tokens, shared components · **Depends on: none**

**Why.** **G-33/G-34.** The canonical model is correct — IRR is stored and transmitted in **rial**, `formatMoney` converts to **toman** at the display boundary (`apps/web/lib/api.ts:351-359`), and the reasoning ("converting only at the display boundary keeps every stored and transmitted figure in one unit") is sound. **The risk is the field name and the scattering**: a bare `amount` is interpretable as toman, and `QuoteBreakdown.tsx:49-50` currently shows a total in تومان beside an FX rate in ریال.

**Scheduling constraint found in review.** The `amountMinor` + explicit `unit` change is a **field rename in `packages/contracts/src/schemas.ts`**, which this program's own parallelization rule marks additive-only during Tranches 1–2. **Resolution: split WP-17.** `WP-17a` (tokens, spacing, the single conversion primitive) runs in Wave 1; `WP-17b` (contract field rename) takes a scheduled slot after Tranche 2, coordinated with its clients. Shipping the rename in Wave 1 would collide with every package touching schemas.

**Scope.** `@xb/design-tokens` extracted from `apps/web/app/globals.css` (semantic + domain layers, density attribute, dark mode defined once — **both apps already implement it independently**); **one authoritative conversion primitive** — the toman division is currently duplicated in **both** clients (`apps/web/lib/api.ts:356`, `apps/admin/lib/api.ts:190`); `packages/core/src/money.ts:214` divides by a generic minor-unit exponent, which is a *different* operation and not the defect. No caller divides by 10 after this; explicit `unit` on every money object; remove mixed-unit surfaces.

**Honest sizing.** The token migration is **not** a no-op: the front office has **26 `font-size: …px` declarations across 13 distinct values**, including a **15px body**, against a declared 16px floor (an earlier draft cited 13, which is the distinct-value count — **the migration is roughly twice the stated size**). Either type changes visibly or the floor is abandoned. **Recommendation: accept the change** (15px is small for Persian letterforms) and migrate **spacing tokens separately**, since those genuinely are low-risk.

**Also:** `--ok #17705f` is a **fourth green**, distinct from `turquoise-dark`, and is what success actually renders as. Reconcile deliberately.

**Tests.** Known quote total → API in **rial**, rendered figure = ÷10 with a toman label. **A 10× error fails the suite.** No component performs its own conversion.

---

## WP-18 — State presentation totality

**P1 · UI · Contexts:** presentation, Order domain · **Depends on: WP-04**

**Why.** **G-19** — `STATE_TO_STEP_INDEX` covers **12 of 24** states (`order-state-machine.ts:148`), and `buildCustomerTimeline` falls back to `-1` (`:170`), so for the 12 unmapped states **all eight timeline steps render `PENDING` while `firstTimestampForStep` still returns real timestamps** — internally contradictory and arguably worse than a blank timeline. **G-20** — `STATE_BADGES` is `Partial` with 21/24; `DRAFT`, `QUOTING`, `QUOTED` fall through to `label: order.state`, **printing raw enum text to Persian customers** (`track/page.tsx:95`).

**Scope.** Make every state-keyed map **total** — `Record<OrderState, …>` with no fallback, so an unmapped state is a **compile error**; customer copy for `REFUNDED` and `CANCELLED` (neither has an `ALERTS` entry today); correct timeline semantics for exception and terminal states.

**Note:** `AWAITING_PAYMENT: -1` is an *explicit* mapping, showing the sentinel is intentional pre-payment — the defect is specifically the 12 **unmapped** states.

**Acceptance.** Adding a state without a presentation mapping fails the build. No raw enum reaches a customer. Every terminal state has closure copy.

---

## WP-19 — Available-actions API

**P1 · API · Contexts:** Order, authorization · **Depends on: WP-04, WP-06**

**Why (G-39).** Phase 8/10 decided clients never compute transition legality, and `TRANSITIONS` is exported **nowhere** outside the API — so the rule currently has no sanctioned implementation. `availableActions` has no producer, consumer, or test.

**Design.** The order detail response carries **authorized business actions**, not raw target states:
`{ action: "accept-price-change", enabled: true }`, with `reason: NOT_PERMITTED | PRECONDITION_UNMET`. An action appears only if **domain-legal for this resource in this state**; `enabled` additionally reflects **actor authorization**; actions the actor may not know exist are **omitted entirely**, not disabled.

**Rejected:** exporting `TRANSITIONS` through `@xb/contracts` — it duplicates domain logic into a schema package and lets the client compute an answer it should be told.

**Acceptance.** No client computes legality; no domain-legal action is offered to an unauthorized actor; the server re-checks on execution regardless — the payload is an affordance, not an authorization.

---

## WP-20 — Admin Vite migration

**P2 · migration · Contexts:** backoffice client · **Depends on: WP-10, WP-17**

**Why.** The superseding decision (MASTER-PROMPT §6) stands: backoffice moves to **Vite + React**. It is currently **Next.js 15 static export** (`apps/admin/package.json`) — an earlier draft described it as already Vite.

**Strategy: parallel shell, then capability-by-capability.** Rationale: `apps/admin/lib/api.ts` wraps every call in one module, so the view layer can be replaced without touching the contract. It is **hand-written, not generated** (an earlier claim overstated this), and `If-Match` is sent on two calls only — generating it from `@xb/contracts` is worth considering *during* the migration.

**Do not rebuild every screen before the operational architecture is ready** — WP-10's read models and WP-17's tokens land first, or the migration ports a page-per-resource shape that Phase 8 explicitly rejected.

**Preserve:** design system, workspace behaviour, permission model, API client seam, sandbox context, routing state. **Do not introduce a second design system during migration.**

---

## WP-21 — Front-office journey slices

**P1 · UI · Contexts:** front office · **Depends on: WP-17, WP-18, WP-19**

**Owns:** G-26, and the *customer surface* half of G-27 (cancellation). **It does not own "C1–C28"** — an earlier draft claimed the whole journey, which overlaps WP-02 (C12), WP-13 (C18) and WP-14 (C25).

**Sliced by outcome, not by page.** Five sub-slices, each independently valuable: (a) product request + resolution incl. provenance markers and the variation picker; (b) quote + explanation; (c) checkout/payment incl. the three return states; (d) order list + tracking + `/orders/:id`; (e) exception decisions (WP-13's UI half) and support/refund entry.

**Also owns G-26** — address update/delete (only `list`/`create` exist server-side) and the standalone `/addresses` surface, plus the `/login` route that does not exist today (auth lives only inside `/checkout`, so `/orders` is a **one-click dead end from every page**).

**Preserve:** minimal navigation, progressive disclosure, Persian-first RTL, and **no speculative B2B chrome** — the account-context indicator renders as nothing for a personal account, which is the whole extensibility seam.

---

## WP-22 — Sandbox executable parity

**P1 · sandbox · Contexts:** admin client, sandbox · **Depends on: WP-03, WP-07, WP-20**

**Depends on: WP-03, WP-07, WP-20.** *(Note: this places WP-22 downstream of packages the critical path lists as off-path — see `critical-path.md`, which now reconciles this.)*

**Why (G-21) — and state the gap precisely.** `apps/admin` **does** have sandbox references: a full "Demo orders" filter (`app/orders/page.tsx:71-125,298-306`). An earlier claim of "zero references" was wrong. **The actual missing behaviour is session propagation** — `apps/admin/lib/api.ts` never sends `X-Sandbox-Session`, so the admin can *filter* sandbox rows it cannot *create or enter*.

**Acceptance is executable, not architectural.** The criterion is a **passing E2E run**, not a document: a customer completes a journey in a sandbox session, an operator opens *the same order* in *the same session*, works the exception, and both see consistent state — with provider simulation, ledger isolation, notifications, and the virtual clock participating.

**Do not mark complete because the Demo filter exists.**

**Scope.** Centralized header propagation in the API client (no component sets it); session selection in the app shell; unmistakable sandbox visual treatment; leaving sandbox mode clears context and the header is never sent from persisted state that outlived the session; server-side validation reuses WP-03.
