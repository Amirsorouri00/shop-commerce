# Component & Token Architecture

> Phase 8 of `docs/program/MASTER-PROMPT.md`. **Architecture only — no mass component implementation.** Companions: `docs/design/design-system.md`, `docs/design/interaction-architecture.md`.

## 1. Layers

Five layers. **Each may depend only on layers above it.** The constraint exists so the front office cannot accidentally import an operational workspace component, and so neither app's framework leaks into shared code.

| Layer | Contents | Framework | Package |
|---|---|---|---|
| **1. Tokens** | color, type, spacing, radius, elevation, motion, z-index, density | **none** — CSS custom properties + a TS export | `@xb/design-tokens` |
| **2. Primitives** | Button, Input, Select, Checkbox, Badge, Skeleton, Spinner, Dialog, Drawer, Tooltip, Popover, Tabs | React, no domain knowledge | `@xb/ui` |
| **3. Domain presentation** | Money, StatusBadge, ProvenanceMarker, Timeline, OrderStateBadge, ProviderHealthBadge, ConfidenceIndicator | React, domain-aware, **presentation only** | `@xb/ui-domain` |
| **4a. Front-office compositions** | ProductCard, QuoteBreakdown, DecisionPanel, TrackingTimeline, CaseThread | Next.js app | `apps/web` |
| **4b. Backoffice compositions** | QueueWorkspace, DataTable, InspectorPanel, CommandBar, FilterBar, SavedViews | React app — **Next.js static export today**, Vite + React after the superseding migration | `apps/admin` |

**Layer 3 is the one that earns its keep.** `Money`, `StatusBadge`, and `ProvenanceMarker` must render identically-meaning information in both apps — differently styled by density, never differently *interpreted*. A customer and an operator disagreeing about what an order's state means is a support incident.

**Layer 4a and 4b deliberately do not share.** The front office's order list and the backoffice's exception queue are different interaction models (`interaction-architecture.md` §13); sharing a "DataTable" between them is precisely the generic-CRUD regression this phase exists to prevent.

## 2. Framework decoupling

The front office is Next.js (static export). The backoffice is **Next.js static export today** (`apps/admin/package.json` depends on `next: ^15.1.0`; `next.config.mjs` sets `output: 'export'`) and becomes **Vite + React** under the superseding decision. Shared layers must not couple to either.

**Correcting an earlier draft**, which described the backoffice as Vite in the present tense. It matters for sequencing: the shared packages must work under Next.js static export *first*, and remain framework-neutral so the Vite migration is a view-layer change rather than a token/component rewrite.

**Rules:**
- **Layer 1 ships CSS custom properties plus a typed TS export.** No build-time CSS-in-JS, no Tailwind config as the source of truth — either would bind consumers to a toolchain.
- **Layer 2/3 are plain React** with no router, no data-fetching, no `next/*` imports. A component needing navigation takes an `onSelect`/`href` prop; it never imports a router.
- **No server components in shared layers.** Both apps are static exports today and the backoffice has no server after migration either — so this constraint is satisfied by both the current and target stacks.
- **Icons** as inline SVG components, one set, no icon-font dependency.
- **Styling:** CSS Modules or plain CSS consuming the token custom properties. Runtime CSS-in-JS is rejected — it costs on every render in a dense operational table, which is the worst place to pay it.

**Why not a component library dependency (MUI, Chakra, shadcn wholesale):** the operational patterns here — persistent workspace, inspector layering, keyboard record traversal, RTL-native logical properties, per-field provenance — are the parts that matter, and none come from a library. Adopting one would mean fighting its layout assumptions in RTL and its density assumptions in the queue. Individual **headless** primitives (focus management, dialog semantics) are worth taking; their styling is not.

## 3. Component inventory — derived from need

**Inventory follows product need, not design-system convention.** No component is listed because libraries usually have one.

### Layer 2 — primitives
Button (variants: primary, secondary, ghost, destructive) · IconButton · Input · NumberInput (bidi-aware, accepts Persian and Latin digits) · Select · Combobox · Checkbox · Radio · Switch · Textarea · FormField (label + description + error, correctly associated) · Badge · Tag · Skeleton · Spinner · ProgressBar · Dialog · Drawer · Popover · Tooltip · Tabs · Alert · Toast · EmptyState · ErrorState · Card · Divider · KeyboardHint.

*Not included:* Accordion (Tabs or expandable rows cover every current need), Breadcrumb (only `/config` is hierarchical — deferred until that ships), Avatar (no user imagery anywhere), Carousel.

### Layer 3 — domain presentation
`Money` (currency-explicit, tabular, locale-aware digits) · `MoneyDelta` (signed, for price changes) · `StatusBadge` (semantic vocabulary from `design-system.md` §9) · `OrderStateBadge` (24-state operator view) · `CustomerTimeline` (8-step) · `OperatorTimeline` (full state history) · `ProvenanceMarker` (tier-derived, per §8) · `ConfidenceIndicator` · `ProviderHealthBadge` · `ExceptionSeverity` · `RelativeTime` (with absolute on hover) · `Identifier` (LTR-isolated, copyable) · `SandboxIndicator`.

### Layer 4b — backoffice operational
`QueueWorkspace` (the persistent list + detail shell; owns URL state) · `DataTable` (sorting, column management, keyboard traversal, row selection, saved views) · `InspectorPanel` (contextual cross-resource investigation) · `CommandBar` (domain commands with confirmation and reason capture) · `FilterBar` (persistent, URL-synced) · `RecordPager` (next/previous with keyboard) · `AuditTrail` · `LedgerTable` (accounting-convention columns).

### Layer 4a — front-office
`ProductCard` (with per-field provenance) · `QuoteBreakdown` · `DecisionPanel` (J7 actionable exceptions) · `TrackingTimeline` · `AddressForm` · `CaseThread` · `PaymentReturn`.

## 4. Token package shape

`@xb/design-tokens` exports:
- `tokens.css` — custom properties on `:root`, with `@media (prefers-color-scheme: dark)` and `[data-theme]` overrides, plus `[data-density="compact"]`.
- `tokens.ts` — typed values for programmatic use (chart colors, canvas, tests).

**Density is an attribute, not a separate build.** `[data-density="compact"]` on the backoffice root changes spacing, control height, and row height — never type size or color. One stylesheet serves both apps.

**Dark mode** is defined once in the token layer. **Both apps already implement it independently** (`apps/web/app/globals.css`, `apps/admin/app/globals.css:39-40`) with the same `prefers-color-scheme` + `[data-theme]` structure — which is exactly the duplication the token package removes.

## 5. Existing UI assessment

Assessed against the system above. Classification per the phase brief: **reusable** · **refactorable** · **replaceable**.

### Reusable — keep, and treat as the foundation

| Asset | Why |
|---|---|
| **Persian-tilework palette** (`apps/web/app/globals.css`) | Culturally grounded, differentiated, semantically workable, durable. Kept on merits (`design-system.md` §1) |
| **RTL-native approach** — `dir="rtl"` on `<html>`, logical properties throughout | Exactly the substrate-not-mode requirement; a retrofit would be strictly worse |
| **Dark mode implementation** (front office) | Correct structure (`prefers-color-scheme` + `[data-theme]` override) |
| **Font strategy** — Vazirmatn with system fallback, no blocking webfont | Right call for a mobile Persian audience |
| **`formatMoney`** | Correct — and it owns the **rial→toman** conversion, the most important unit rule in the system (`design-system.md` §7). **`toPersianDigits` moves to refactorable:** a blind `/\d/g` replace, safe on prose but corrosive on identifiers |
| **`ProductCard` provenance hint** and its rationale ("a customer who was told the number might move is a customer who is not surprised later") | The right principle, applied to one field; generalize it |
| **`alertFor`, `buildCustomerTimeline`** | The `actionable` split and the 8-step projection are correct and are the authority the design system maps onto. **`STATE_BADGES` moves to refactorable** — its label/tone pairing is right, but it is `Partial` and has no icon |
| **`maximumScale: 5`** (pinch-zoom enabled) | An accessibility decision with a stated rationale; must not be "fixed" |

### Refactorable — sound, needs restructuring

| Asset | Change |
|---|---|
| Direct `--lapis` / `--turquoise` references in components | Route through layer-2 semantic roles |
| **13 hardcoded px font sizes incl. `15px` body** (`apps/web/app/globals.css`) | The largest migration cost in Phase 8 — see §6 step 4. Not previously named |
| **Admin's dark block never overrides the accents** (`--lapis/--turquoise/--saffron/--stamp` stay at light values under `prefers-color-scheme: dark`) | A real, narrow defect the token layer fixes by construction |
| `STATE_BADGES` typed `Partial` with 21 of 24 states | Make it total; the missing states currently leak raw enum names to customers (`design-system.md` §9a) |
| Hardcoded px spacing in component styles (`marginTop: 14`, `gap: 8`) | Replace with spacing scale |
| `ProductCard` weight-only provenance, thresholded on `< 0.7` | Generalize to all soft fields; derive from `provenance.tier` (the `0.7` cap collision makes the float test unsound) |
| Admin `--sev-*` tokens | Fold into the shared status vocabulary |
| Admin `radius: 8px` | Reconcile to `sm 6px` / `md 10px` |
| `apps/admin` page-per-record (`/order/?id=`) | Becomes `QueueWorkspace` — the interaction change, not a styling one |
| `apps/web` inline `style={{…}}` usage | Move to token-consuming classes |

### Replaceable

| Asset | Why |
|---|---|
| **Duplicated palette across two stylesheets** | Same hexes declared twice with drift already present (`--paper` `#f2f5f5` vs `#eef1f3`, different radius, admin lacks dark mode). Replace with `@xb/design-tokens` |
| **Admin's three-color severity system** | Insufficient for fourteen status domains; replaced by the §9 architecture |
| **Admin's physical `left`/`right` CSS** | Zero logical properties in `apps/admin/app/globals.css` against twelve in `apps/web`. Not currently broken (English LTR UI) but it cannot host the Persian customer content it already displays, and diverges from the platform standard |
| **`/track?id=` route shape** | Replaced by `/orders/:id` (Phase 5); the query-param identity is wrong for an owned resource |

**Nothing is preserved merely because it exists, and nothing is discarded merely because it is MVP.** The palette survives on argument; the duplication does not.

## 6. Implementation sequencing (Phase 12 input — not done here)

1. `@xb/design-tokens` — extract from `apps/web/globals.css`, add semantic + domain layers, density, backoffice dark mode.
2. `@xb/ui` primitives, headless-first, RTL-verified — including converting the admin app's physical CSS to logical properties.
3. `@xb/ui-domain` — `Money`, `StatusBadge`, `ProvenanceMarker`, timelines.
4. Front office migrates to tokens. **This is not low-risk, and an earlier draft's claim that it would be visually near-identical was wrong.**

   `apps/web/app/globals.css` contains **13 distinct hardcoded px font sizes** — `10.5, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5, 16, 17, 18` — and `body` is **`15px`**, below the 16px floor `design-system.md` §4 declares non-negotiable. Adopting the rem scale therefore changes nearly every text size in the front office. There are only two honest options: **accept a deliberate, visible type change** (the recommendation — 15px body is small for Persian, whose diacritics and letterform complexity argue for *more* size, not less), or abandon the floor. Silently keeping 15px while claiming a 16px floor is the outcome to avoid.

   Consequences: this migration is a **visual change requiring review, not a refactor**; it cannot serve as a no-op regression baseline; and it is the largest single cost in Phase 8's implementation, previously both unnamed and unmeasured. **Spacing tokens can migrate independently and *are* low-risk** — do that first, and treat type as its own reviewed change.
5. `QueueWorkspace` + `DataTable`, on the exception queue first (highest operator value).
6. Backoffice migrates to Vite + React, per the superseding decision. **`apps/admin/lib/api.ts` is the migration seam** — it wraps every admin call in one module, so the view layer can be replaced without touching the contract.

   **Two corrections to an earlier draft:** the client is **hand-written, not generated** (it self-describes as deliberately separate from the web client), so "generated API client" overstated it; and `If-Match` is sent on `transition` and `reprice` only, not on every call. The seam property holds — one module, one place to change — but it is a hand-maintained seam, and generating it from `@xb/contracts` is worth considering during the migration rather than assumed.

**Contrast verification (`design-system.md` §3) gates step 4.**

## 7. What this architecture forbids

- Raw hex or primitive token names in components.
- A shared `DataTable` used by both apps.
- Router or data-fetching imports in layers 1–3.
- Runtime CSS-in-JS in operational tables.
- Density implemented by changing font size.
- A second copy of the palette.
- Components created because a design system "should have" them.
