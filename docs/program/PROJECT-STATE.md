# Program State — Cross-Border Assisted Commerce Platform Convergence

> Compact, continuously maintained state per `docs/program/MASTER-PROMPT.md` §4. Do not duplicate large content here — link to deeper artifacts.

## Current phase

**Phase 0, 1, 2, 3, and 4 complete.** See `docs/program/00-current-state-assessment.md` (Phase 0), `docs/product/{product-boundary,capability-map,business-lines,mvp-vs-platform}.md` (Phase 1), `docs/product/{personas,jobs-to-be-done,account-and-organization-model,anti-personas}.md` (Phase 2), `docs/ux/{journey-map,service-blueprint,state-matrix}.md` (Phase 3), and `docs/product/product-resolution.md` + `docs/ux/amazon-resolution-journeys.md` + `docs/architecture/product-resolution-architecture.md` (Phase 4). **Phase 5 (front office) next.**

## Approved product boundaries

Four business lines, adopted from governing docs at high confidence (see `docs/product/business-lines.md`):
- **A — B2C Assisted Commerce.** MVP-now. Beachhead: Amazon UAE → Iran, paste-link → quote → pay → track.
- **B — B2B Merchant Fulfillment Platform.** In-boundary, platform-later (next after A). Wholesaler-mode pricing, prepaid wallet, embedded panel, modular per-leg fulfillment — reuses the Line A engine.
- **C — Enterprise Import/Export Procurement.** In-boundary, platform-later (after B). Managed-desk model, entered via a consolidation+tracking wedge, not full self-serve.
- **D — Shared Platform Capabilities.** The engine (resolution/quote/procurement/tracking/money/identity) all three lines sit on. Built for Line A only today; must generalize (esp. identity/account model and money model) without a Line-A rebuild — this is the core architectural bet of the program.

**One contradiction recorded, not silently resolved** (`docs/product/product-boundary.md`): `CLAUDE.md`'s RULE "link-first only, no catalog/search" vs. `technical-blueprint-v1.md`'s post-MVP list which mentions "catalog/discovery." Resolution: catalog/discovery stays permanently out-of-scope pending an explicit future ADR — not scheduled as platform-later.

## Personas / actors

Full roster in `docs/product/personas.md`. Summary:
- **Primary:** individual/frequent shopper (Line A), social-commerce seller / small online merchant / org owner (Line B), company purchaser / enterprise procurement operator / finance approver (Line C).
- **Internal:** support operator (no surface yet — MVP gap), procurement/"ops" operator (COMPLETE surface), logistics operator (folds into ops surface for now), finance/reconciliation operator, compliance/risk operator (no surface yet), system administrator (blocked on RBAC generalization).
- **Anti-personas** (`docs/product/anti-personas.md`): value-transfer arbitrageur, customs-limit/structuring abuser, account-sharing/concealment user, marketplace-ToS-bypass reseller, catalog-browsing user, uncollateralized enterprise credit-seeker — all traced to explicit RULEs in `CLAUDE.md` / `phase-0.3-logistics-feasibility.md`, not invented.

**Account/org model** (`docs/product/account-and-organization-model.md`): `User` (identity) ↔ `PersonalAccount` (Line A) or `OrganizationMembership` → `Organization` (kind: MERCHANT/ENTERPRISE/**INTERNAL_OPS**). MVP-now populates only `PersonalAccount` and `kind=INTERNAL_OPS` orgs (replacing today's flat `customers`/`operators` tables); `Role`/`Permission`/`RolePermission` are scoped (`PLATFORM` vs `ORGANIZATION`) from the start so Line B/C don't require a rebuild. Open architectural fork flagged for a Phase 7 ADR: whether internal ops belongs under the `Organization` concept at all (recommended, medium confidence) or stays separate.

## Major architecture decisions (accepted this program)

- **Superseding decision (from MASTER-PROMPT §6):** Backoffice/admin migrates from Next.js to **Vite + React**. Front office stays Next.js. Backend/workers stay NestJS. Requires an ADR before/alongside the migration (Phase 6, task #7) — not yet written.

## Major UX decisions

- **Notifications are in-scope for Line A MVP, not platform-later** (Phase 3, `docs/ux/journey-map.md` "Cross-cutting: notifications"). J7 (customer exception decision) is structurally unusable without a working notification system, and J7 is an explicit MVP-boundary item — so the gap can't be deferred without silently breaking an already-committed MVP item. Confidence: high. Alternatives considered: banner-only with no push, rejected. Reversal cost: low — port/event types already exist unused, so deferring later costs nothing extra.
- **The customer exception decision journey (J7) must reuse the existing `actionable` flag on `ALERTS`** (`order-state-machine.ts`) rather than inventing new customer decision points. Only `PRICE_CHANGED`, `PAYMENT_FAILED` (already handled via J5 retry), `CUSTOMER_ACTION_REQUIRED`, and `CUSTOMS_EXCEPTION` get customer decision UI; `OUT_OF_STOCK`, `PROCUREMENT_FAILED`, `SHIPMENT_EXCEPTION` remain informational-only, matching a distinction already encoded in the backend. Confidence: high — this is reading an existing deliberate design, not inferring one.
- **Support, refund, and refund-adjacent operator workflows (J8, J12) must all converge on the single existing `X → REFUND_PENDING → REFUNDED` transition path and the one unused `refund` method on the payment port** — never a parallel money-movement mechanism. Confirmed: `REFUND_PENDING`'s only legal edge is `REFUNDED`, so every refund-triggering exception state already converges on one execution path today; the gap is wiring, not design. Confidence: high.

## External gates (pre-existing, from `handoff.md` and `CLAUDE.md`)

- **Payment** — real Iranian gateway (e.g. Zarinpal/Sadad) behind `PaymentPort`. Sandboxed today via a simulated gateway HTML page.
- **Procurement** — real purchasing method behind `ProcurementPort`. Sandboxed today.
- **Logistics/carrier** — real carrier/customs integration behind `LogisticsPort`. Sandboxed today.
- **Compliance gate** — master switch before production; not yet reviewed.

Each gated integration must still ship with complete domain contract, port, sandbox adapter, UX states, config model, failure states, tests, and docs (MASTER-PROMPT §1) — existing sandbox architecture already does this for the three ports above per `handoff.md`; Phase 0 will verify actual coverage.

## Completed work packages

- **Phase 4 product resolution** (`docs/product/product-resolution.md`, `docs/ux/amazon-resolution-journeys.md`, `docs/architecture/product-resolution-architecture.md`) — discovered that a full 4-tier resolution ladder (`api → structured → vision → manual`) with per-field provenance/confidence, cost-budgeted escalation, and risk propagation into pricing **already exists** in `platform/packages/commerce/`; Phase 4 formalizes and extends it rather than designing new. Nine Amazon UAE PDP archetypes modeled against it. Live-fetch research confirmed Amazon UAE blocks plain server-side fetching (6 of 7 attempts → HTTP 503), and surfaced that Amazon's PA-API 5.0 was deprecated 2026-05-15 in favour of a narrower-access Creators API — which changes the `api` tier from a credentials question to an availability question.
- **Phase 3 journey architecture** (`docs/ux/journey-map.md`, `service-blueprint.md`, `state-matrix.md`) — 15 MVP-now journeys modeled to full depth (customer J1–J9, internal operator J10–J15) plus 4 platform-later journeys named directionally; verified against source (`order-state-machine.ts`'s exact 24-state/`TRANSITIONS`/`ALERTS`/`actionable` model, `admin.module.ts`'s exception-queue and RBAC enforcement, `scenario.ts`'s 12 sandbox scenarios, `packages/core/src/ports.ts`'s unwired `NotificationPort`). Confirmed and precisely located the two live "no dead ends" violations MASTER-PROMPT §PHASE 3 forbids: J7 (customer decision UI missing though backend transitions already support it) and J8/J12 (support/refund workflow missing though ledger/state machine/payment-port `refund` already anticipate it). Found one previously-unrecorded small gap: `ALERTS` has no copy for `REFUNDED`/`CANCELLED` terminal states.
- **Phase 2 personas/accounts** (`docs/product/personas.md`, `jobs-to-be-done.md`, `account-and-organization-model.md`, `anti-personas.md`) — full actor roster across all four lines incl. internal operators; JTBD per actor; greenfield `User`/`PersonalAccount`/`Organization`/`OrganizationMembership`/`Role`/`Permission` model designed to make Line A MVP-now while keeping Line B/C additive; anti-personas traced to explicit compliance RULEs, not invented.
- **Phase 0 assessment** (`docs/program/00-current-state-assessment.md`) — `handoff.md`'s claims spot-checked against source and confirmed accurate (24-state machine exact match, 120 test cases exact match, 5 apps / 11 packages confirmed, admin API surface confirmed). Full capability matrix produced. Key verified state: quote/auth/checkout/tracking/exception-queue/procurement-copilot/finance-ledger/sandbox are COMPLETE on sandbox adapters; real payment/procurement/logistics/FX providers are EXTERNAL-GATE as expected.
- **Phase 1 product boundary discovery** (`docs/product/product-boundary.md`, `capability-map.md`, `business-lines.md`, `mvp-vs-platform.md`) — adopted governing docs' already-decided A→B→C sequencing at high confidence; produced the shared-spine (D) capability map; recorded and resolved the catalog/search RULE-vs-blueprint contradiction (excluded pending future ADR, not scheduled).
- Repo baseline + Ruflo/Graphify orchestration tooling committed (`8116e15`, `f22eed2`).

## Active work packages

- None currently in progress. Phase 4 (Amazon UAE PDP and product resolution) is next and unblocked.

## Unresolved high-impact questions

New from Phase 4:

- **Live defect recorded, not fixed: `ApiResolutionStrategy` never triggers weight escalation.** It sets `weightKg` confidence to 0.6 with a comment claiming that is "deliberately below the escalation floor," but the floor is `MIN_FIELD_CONFIDENCE = 0.5` and the test is `confidence < floor` — so 0.6 passes and the `vision` tier (the only rung that can estimate true *shipping* weight) is never consulted. Verified nothing overrides `confidenceFloor` in production. Zero impact today (the `api` tier isn't wired), but a live margin defect the moment that gate clears, since freight is most of landed cost and catalogue weight systematically understates it. Three candidate fixes weighed in `docs/architecture/product-resolution-architecture.md`; decide in Phase 10/12 alongside the api-gate work.
- **Amazon PA-API 5.0 deprecated (2026-05-15), superseded by a Creators API requiring an active Associates account with recent qualifying sales.** `marketplace.ts` asserts `productApi: true` for `amazon.ae` and existing docs treat the `api` tier as "blocked on credentials." Whether that capability still holds needs re-checking against Creators API's actual product-data coverage — not investigated in depth this pass.
- **Amazon UAE blocks plain server-side fetching** (empirically confirmed). The `structured` and `vision` tiers both need a fetcher Amazon will serve (realistic browser fingerprint/session, or a licensed fetching provider) behind the existing `PageFetcher` seam. No pipeline change required.
- **Seven fields the resolution model lacks** (`selectableVariations`, `fulfillmentParty`, `itemCondition`, `originalPrice`/`discountPercent`, `quantityRestrictions`, `estimatedMarketplaceDelivery`, `eligibility`/`restrictions`). Highest-consequence is **eligibility/restrictions** — nothing checks import-eligibility at resolution today, so an ineligible item resolves, quotes, and fails at customs *after payment*.
- **Not verified against a rendered Amazon UAE PDP.** Direct fetch was blocked, so structural claims about image galleries, badge placement, and discount markup come from search-snippet evidence and general marketplace knowledge, not a live page. Re-verify with browser automation before Phase 5 commits to layout.

New from Phase 3:

- **Notification system is entirely unbuilt** (`NotificationPort`/`NotificationChannel` types and a `notification.requested` event constant exist; zero adapter, DI binding, emitter, or worker consumer). Now scoped as MVP-now (see Major UX decisions above), not platform-later — this is the single highest-leverage Phase 10/12 work item, since it unblocks the Notify column across nearly every journey in `state-matrix.md` §3 at once.
- **Customer decision SLA/timeout policy for J7 is undesigned** — what happens if a customer never responds to an actionable exception (race with operator override, auto-escalate, auto-refund) has no defined policy. Same open question shape as J8/J12's support-case SLA — flagged to design once, not twice, in Phase 12.
- **Real-provider (non-sandbox) SMS/OTP outage has no fallback identity path** — sandbox stubs exist, real-provider degraded-mode handling does not.
- **Partial refunds are not modeled** — only full-order refund exists in the ledger/state-machine shape; J8/J12 assumed full-refund-only, partial-adjustment needs a domain decision before it can ship if required.

Carried forward from Phase 0/1/2 (see the linked docs for detail):

- **Whether internal ops should live under the `Organization` concept (`kind=INTERNAL_OPS`) or stay a separate mechanism is an open architectural fork, not decided** — recommended (medium confidence) in `account-and-organization-model.md`, needs a Phase 7 ADR before Phase 10/12 schema work.
- **No approval-workflow entity exists for the finance-approver job (P8, Line C)** — flagged platform-later, needed before Line C ships, not designed yet.
- **Customer-facing exception decisions are missing** — price-changed/out-of-stock are fully modeled operator-side with no customer-facing accept/reject UI. Now explicitly in the MVP boundary (`mvp-vs-platform.md` item 1), feeds Phase 3.
- **Support and refunds have domain/ledger scaffolding but no workflow surface on either side.** Now explicitly in the MVP boundary (`mvp-vs-platform.md` item 2). Feeds Phase 3/5/6.
- **RBAC is a flat role string** (`@Roles('ops','admin')` etc.), not a modeled Permission/Role/Scope system. MVP needs it generalized enough not to block launch; full B/C-scoped RBAC is platform-later. Feeds Phase 7.
- **No wallet/escrow money model exists** — Line B's prepaid-wallet MVP shape and Line C's deposit/milestone model both need a money-model abstraction beyond today's direct-pay `Money`/ledger primitives. Not required for Line A MVP; flagged for Phase 10.
- **Whether the 120 tests currently pass, and whether the dev servers still boot, is unverified** — Phase 0 avoided running `pnpm install`/`test`/`dev` due to critical host memory pressure at the time. Re-run once resources allow.
- Admin Next.js → Vite+React migration strategy (incremental vs. parallel) not yet decided — Phase 6 (task #7).
- Whether an automated ledger-reconciliation matcher (described in `feasibility-revalidation-v0.2.md`) exists in code was not confirmed — needs a targeted check, not assumed missing.

## Links

- Governing directive: `docs/program/MASTER-PROMPT.md`
- Prior session handoff: `handoff.md`
- Architectural invariants: `CLAUDE.md`
- Graphify: `graphify-out/GRAPH_REPORT.md`, `graphify-out/graph.json`
- Governing product docs: `technical-blueprint-v1.md`, `feasibility-revalidation-v0.2.md`, `phase-0.3-logistics-feasibility.md`
- Phase 0 assessment: `docs/program/00-current-state-assessment.md`
- Phase 1 product boundary: `docs/product/product-boundary.md`, `docs/product/capability-map.md`, `docs/product/business-lines.md`, `docs/product/mvp-vs-platform.md`
- Phase 2 personas/accounts: `docs/product/personas.md`, `docs/product/jobs-to-be-done.md`, `docs/product/account-and-organization-model.md`, `docs/product/anti-personas.md`
- Phase 3 journey architecture: `docs/ux/journey-map.md`, `docs/ux/service-blueprint.md`, `docs/ux/state-matrix.md`
- Phase 4 product resolution: `docs/product/product-resolution.md`, `docs/ux/amazon-resolution-journeys.md`, `docs/architecture/product-resolution-architecture.md`
