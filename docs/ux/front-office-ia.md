# Front Office — Information Architecture

> Phase 5 of `docs/program/MASTER-PROMPT.md`, scoped per the sequencing clarification in `docs/program/PROJECT-STATE.md`: **product/UX architecture only, not implementation.** Route/screen inventory, navigation model, and journey→screen mapping. Interaction detail, state coverage, responsive behaviour and trust patterns live in `docs/ux/front-office-interaction-spec.md`.
>
> Inputs: `docs/ux/journey-map.md` (J1–J9), `docs/ux/state-matrix.md`, `docs/ux/amazon-resolution-journeys.md` (nine PDP archetypes), `docs/product/mvp-vs-platform.md`. Verified against `platform/apps/web/` as it stands today.

## Current route inventory (verified)

Five routes exist (`platform/apps/web/app/`):

| Route | Screen | Journeys | Auth | Notes |
|---|---|---|---|---|
| `/` | Paste link → resolve → quote | J1, J2 | none | Single screen through to quote by design (`page.tsx:10-16`: "the link *is* the interface") |
| `/checkout?quote=<id>` | Login → OTP → address → pay | J3, J4 (inline), J5 | becomes authed | Step machine: `'loading' \| 'login' \| 'otp' \| 'address' \| 'paying' \| 'error'` (`checkout/page.tsx:28`) |
| `/checkout/return` | Payment return polling | J5 | authed | Polls until a `SETTLED_STATES` member (`return/page.tsx:37-38`) |
| `/orders` | Order list | J6 | authed | |
| `/track?id=<orderId>` | Order detail + timeline | J6 | **authed** | Polls rather than holding a socket (`track/page.tsx:13-18`) |

Global: `DemoPanel` renders app-wide when the sandbox is reachable (`layout.tsx:62`). Shell is `lang="fa" dir="rtl"` set statically, "because Persian RTL is the product's default rather than a preference" (`layout.tsx:24-27`). Top bar carries brand + a single "سفارش‌های من" link (`layout.tsx:42-46`).

API surface backing these (`lib/api.ts:226-330`): `auth.{startOtp,verifyOtp,logout}`, `catalog.{resolve,get}`, `quotes.{create,refresh}`, `addresses.{list,create}`, `orders.{create,list,get,startPayment}`, `sandbox.*`.

## IA defects found this pass

Three are structural, not cosmetic:

1. **There is no login route.** Authentication exists *only* as two steps inside `/checkout` (`checkout/page.tsx:28,184-243`). This is correct as the *primary* path — J3's premise is that auth is contextual, triggered at checkout rather than gating discovery — but it means authentication is unreachable except by having a quote in hand.

2. **`/orders` is a dead end when unauthenticated.** It checks `auth.isAuthenticated`, sets the message "برای مشاهدهٔ سفارش‌ها وارد حساب خود شوید" and renders an empty list (`orders/page.tsx:14-18`) — telling the user to log in while offering no way to do so, because of defect 1. The top bar links here unconditionally (`layout.tsx:43`), so this is reachable in one click from every page. **This is the highest-priority front-office IA fix**; it is a complete dead end on a primary nav item.

3. **`/track` is not a public tracking surface.** Despite the name it calls `api.orders.get(orderId)` — the authenticated, ownership-scoped endpoint. There is no tokenized public tracking, so J9 (merchant's end customer, no login) has no surface at all, and a tracking link cannot be forwarded to anyone who isn't the buyer. Consistent with J9's GAP status; recording it here because the route name implies otherwise.

Also confirming Phase 3 gaps precisely at the API layer: `addresses` exposes only `list` and `create` (with `isDefault: true` hardcoded, `lib/api.ts:269-284`) — no update or delete, so J4 is a genuine gap, not just a missing screen. There are no support, refund, decision, profile, or notification endpoints at all.

## IA principles

Derived from `CLAUDE.md` RULEs and Phase 1–3 decisions; these constrain every choice below.

- **Link-first.** No catalog, search, browse, or merchandising surface — ever. The paste box is the only entry to product selection. Ruled permanently out of scope pending an explicit future ADR (`docs/product/product-boundary.md`).
- **Auth is contextual, not a destination.** Keep the checkout-triggered flow as the primary path; add a standalone route as a *fallback* for returning users, not as a gate in front of discovery.
- **Progressive disclosure toward one number.** Everything before checkout serves "what will this actually cost me in Toman." Quote breakdown detail is available but not the default reading (`QuoteBreakdown` component exists today).
- **Persian-first, RTL, mobile-first.** Non-negotiable, already structurally enforced in the shell.
- **Exceptions surface where the customer already looks** — on order detail, not in a separate "problems" area. This follows the existing backend design where exceptions never become timeline steps (`order-state-machine.ts:116-121`).
- **No dead ends.** Every terminal state names a reason and offers a next action. Defect 2 above is the current violation.

## Target route inventory

**MVP-now.** Status: **E** = exists, **X** = extend existing, **N** = new.

| Route | Screen | Journeys | Auth | Status | Rationale |
|---|---|---|---|---|---|
| `/` | Paste link → resolve → confirm → quote | J1, J2 | none | **X** | Add per-field provenance markers, variant display, ladder-progress states (Phase 4 archetypes 2, 8, 9) |
| `/login` | Phone → OTP | J3 | none | **N** | Fixes defect 1. Returning-user entry; also the redirect target for defect 2. Reuses the same two steps already built in checkout |
| `/checkout?quote=<id>` | Address → review → pay | J3, J5 | authed | **X** | Keep inline login/OTP steps; add saved-address selection once J4 exists |
| `/checkout/return` | Payment result | J5 | authed | **E** | Already handles pending/success/failure via polling |
| `/orders` | Order list | J6 | authed | **X** | Add authenticated empty state (distinct from unauthenticated), and a real unauthenticated path to `/login` |
| `/orders/<id>` | Order detail, timeline, exceptions, decisions | J6, **J7** | authed | **N** | Replaces `/track?id=` with a canonical, linkable, ownership-scoped URL. Hosts the exception decision UI — the single most important net-new front-office surface |
| `/addresses` | Address list / add / edit / delete | J4 | authed | **N** | `mvp-vs-platform.md` item 3. Needs API extension (update/delete) |
| `/support` | Case list + new case | J8 | authed | **N** | `mvp-vs-platform.md` item 2. Needs a full API — no endpoints exist |
| `/support/<id>` | Case detail + replies | J8 | authed | **N** | |
| `/settings` | Profile, phone, language, notification prefs | — | authed | **N** | Minimal; the home for logout, which has no surface today despite `auth.logout()` existing |

**Deferred, with reasons.** `/track/<token>` (public tokenized tracking) — J9, blocked on Line B and on a tokenized endpoint; keep the route name reserved so the authed detail page doesn't claim it. `/notifications` — blocked on the notification system (cross-cutting gap); notification *preferences* live in `/settings` from the start so the surface exists when delivery does. Organization/business onboarding, org settings, wholesaler pricing — Line B/C, platform-later per `mvp-vs-platform.md`; **no placeholder routes**, since an empty business surface implies a capability that doesn't exist.

**Retired.** `/track?id=<orderId>` → `/orders/<id>`. Query-param identity for an owned resource is wrong: it isn't canonical, doesn't nest under the collection, and the name implies public access it doesn't have. Redirect rather than break existing links.

### On `/orders/<id>` and static export

`next.config` uses `output: 'export'` (`CLAUDE.md`), so a dynamic segment needs either `generateStaticParams` (impossible — order IDs are unbounded) or a client-side-routed shell that reads the id and fetches. The second is the correct approach and is the same pattern `/track` already uses successfully (`useSearchParams` + client fetch, `track/page.tsx:29-31`); the change is reading the id from the path instead of the query string. **Flagging this explicitly because it's the one place where the static-export deviation from the blueprint touches the target IA** — it constrains implementation, not the IA itself.

## Journey → screen mapping

Every journey in `docs/ux/journey-map.md` maps to at least one screen; every screen serves at least one journey.

| Journey | Screens | Status |
|---|---|---|
| J1 resolve | `/` | X — provenance markers, variant display, ladder progress |
| J2 quote | `/` | X — quote explanation already componentized |
| J3 auth | `/checkout` (primary), `/login` (fallback) | X + N |
| J4 addresses | `/addresses`, selection in `/checkout` | N — needs API update/delete |
| J5 checkout/pay | `/checkout`, `/checkout/return` | E/X |
| J6 orders/tracking | `/orders`, `/orders/<id>` | X + N |
| **J7 exception decision** | `/orders/<id>` | **N — highest product priority** |
| J8 support/refund | `/support`, `/support/<id>` | N — needs full API |
| J9 merchant end customer | `/track/<token>` | Deferred (Line B) |

**Coverage check.** MASTER-PROMPT §PHASE 5 enumerates ~30 candidate surfaces. Accounted for: landing, resolution, product confirmation, variation confirmation, quote, quote explanation, authentication, signup (implicit on first OTP — no separate ceremony, per link-first), login, OTP, personal onboarding (folded into first checkout; a separate onboarding step would add friction to a flow whose premise is having none), addresses, checkout, payment, payment return, pending payment, payment failure, order confirmation, order list, order detail, tracking, order exceptions, price-changed decisions, out-of-stock decisions, refunds, support, profile/settings, notifications (preferences only), sandbox/demo controls (global `DemoPanel`). Deliberately excluded with reasons above: business onboarding, organization creation/joining, organization/business settings.

## Navigation model

Today: brand + one unconditional link (`layout.tsx:42-46`). That single link causes defect 2.

**Target — authentication-aware:**

- **Unauthenticated:** brand → `/`; "ورود" → `/login`. No "my orders" link, because it leads somewhere unusable. This alone fixes defect 2.
- **Authenticated:** brand → `/`; "سفارش‌های من" → `/orders`; account menu → `/settings`, `/addresses`, `/support`, logout.
- **Attention badge** on "سفارش‌های من" when any order sits in an `actionable: true` exception state (`PRICE_CHANGED`, `PAYMENT_FAILED`, `CUSTOMER_ACTION_REQUIRED`, `CUSTOMS_EXCEPTION` — per `order-state-machine.ts` and `state-matrix.md` §1). Until notifications exist, this in-app badge is the *only* mechanism that brings a customer back to a decision they must make — it partially mitigates the notification gap rather than waiting on it. Non-actionable exceptions get no badge; they are informational by deliberate backend design.
- **Mobile:** brand + account affordance in the bar, remaining items in a sheet. Reachable one-handed; the badge must remain visible in the collapsed state or it does nothing.

**Deep-link/auth rule:** an unauthenticated request for an authed route routes to `/login` with a return target, then continues to the original destination. Currently no route does this — `/orders` just fails in place.

## Feeds

Phase 6 (backoffice IA — same treatment for the operator side), Phase 7 (RBAC; front office consumes permissions to shape UX but backend stays authoritative), Phase 8 (design system — the component inventory implied here: product card, quote breakdown, timeline, exception banner, decision panel, address card, case thread, empty/loading/error states), Phase 11 (traceability), Phase 12 (work packages; `/orders/<id>` with J7 is the highest-value first package).
