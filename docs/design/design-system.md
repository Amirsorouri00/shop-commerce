# Design System

> Phase 8 of `docs/program/MASTER-PROMPT.md`. **Design only — no mass screen implementation.** Companions: `docs/design/interaction-architecture.md` (experience and workspace patterns), `docs/design/component-architecture.md` (layers, inventory, existing-UI assessment).
>
> Every token below carries its reasoning. A token list without rationale is a paint chart, and the next implementer will override it.

## 1. Visual direction

### The brief, from the product rather than from taste

This product asks an Iranian consumer to pay in advance, in IRR, for a foreign item they cannot inspect, shipped through customs by a company they have not used before. Simultaneously it asks operators to spend eight-hour shifts making margin-affecting decisions in a dense queue. The visual language must serve **financial trust** and **operational seriousness**, in Persian-first RTL, without looking like either a bank or a generic dashboard.

### Decision: keep and extend the existing Persian-tilework palette

The front office already uses lapis, turquoise, saffron and a "stamp" red over a cool paper neutral, with the greys biased toward the accent "so they read as chosen" (`apps/web/app/globals.css`).

**This is kept — on merits, not inheritance.** The phase brief warns against inheriting the MVP palette merely because it exists; it equally warns against replacing a considered direction for novelty. Assessed on its own terms this palette is:

- **Culturally grounded rather than decorative.** Lapis lazuli, turquoise, and saffron are Persian materials with centuries of association in tilework and manuscript, not an arbitrary "make it feel Middle Eastern" gesture. For a Persian-first product this reads as belonging rather than as localization.
- **Differentiated.** It is emphatically not the indigo-violet gradient of contemporary SaaS. A cross-border commerce service competing on trust benefits from not looking like a startup dashboard.
- **Semantically workable.** Deep lapis carries institutional weight for primary actions; turquoise is distinct enough from lapis to signal success without colliding; saffron and stamp-red give warning and critical without either reading as generic.
- **Durable.** Earth-and-mineral pigments age better than saturated trend colors.

**What it lacks, and this phase adds:** a semantic layer (components currently reference `--lapis` directly), a spacing scale, motion/z-index/focus tokens, financial and status semantics beyond three colors, an operational density scale, and a shared source — the admin app duplicates the same hex values in a separate stylesheet with drift already visible (`--paper` `#f2f5f5` vs `#eef1f3`, radius `10px` vs `8px`, and two independently-maintained dark-mode blocks).

**Rejected alternatives:** a neutral grey-blue "fintech" palette (credible but anonymous, and would discard genuine differentiation); a high-saturation modern palette (fails long-session fatigue and financial seriousness); dark-first (wrong default for a mobile consumer product in daylight, and the front office already handles dark as a preference).

### Character

Precise, calm, and material. Flat surfaces with restrained elevation; borders doing more work than shadows; generous type; no gradients as decoration; motion only where it explains a change. **Not** playful, not luxurious, not brutalist.

## 2. Color tokens

Three layers. **Components reference only layer 3.** A raw hex or a primitive name in a component is a defect.

### Layer 1 — primitives (the palette; never referenced by components)

Preserved from the existing implementation, which is already correct:

```
lapis        #1b3a6b   lapis-tint      #e7ebf2
turquoise    #0e8a80   turquoise-dark  #0a6d65   turquoise-tint  #e3edec
saffron      #b67618   saffron-tint    #fbf2e2
stamp        #a32a28   stamp-tint      #f7e9e9
ink #0d2430  ink-2 #37505c  ink-3 #647c88
paper #f2f5f5  surface #ffffff  surface-2 #e8eeee
line #cfdada   line-soft #dfe7e7
ok #17705f   warn #b67618 (= saffron)   crit #a32a28 (= stamp)
```

**Note the fourth green.** `--ok #17705f` is *not* `turquoise-dark #0a6d65`, yet `--ok` is what success actually renders as in both apps today. An earlier draft of this document omitted it and named `turquoise-dark` as `state.success`, which would have silently changed every success indicator. Token extraction must reconcile these two deliberately — they are close enough to look like a mistake and different enough to be one.

### Layer 2 — semantic roles

`action.primary` (lapis) · `action.primary.hover` · `action.secondary` · `action.destructive` (stamp) · `surface.page` / `.raised` / `.sunken` / `.overlay` · `border.default` / `.subtle` / `.strong` / `.focus` · `text.primary` (ink) / `.secondary` (ink-2) / `.tertiary` (ink-3) / `.inverse` / `.link` · `state.success` (turquoise-dark) / `.warning` (saffron) / `.critical` (stamp) / `.info` (lapis) / `.neutral`, each with a paired `.surface` tint for backgrounds.

### Layer 3 — domain semantics

This is where the system stops being generic. **Status color is assigned by meaning, never by domain**, so that a customer and an operator reading the same order agree.

| Semantic | Role | Applies to |
|---|---|---|
| `status.progressing` | info (lapis) | in-transit, procurement pending, quoting |
| `status.settled` | success (turquoise-dark) | delivered, paid, matched, resolved |
| `status.attention` | warning (saffron) | needs review, price drift within tolerance, provider probing |
| `status.blocked` | critical (stamp) | customs hold, payment failed, out of stock, provider quarantined |
| `status.awaiting-customer` | **distinct — saffron with a dedicated icon and label** | **all four `actionable: true` states**: `PRICE_CHANGED`, `PAYMENT_FAILED`, `CUSTOMER_ACTION_REQUIRED`, `CUSTOMS_EXCEPTION` |
| `status.terminal-neutral` | neutral | cancelled, refunded |
| `status.inactive` | tertiary | draft, archived, unpopulated |

`status.awaiting-customer` is separated from generic `attention` deliberately: Phase 3 established that `actionable: true` states are the only ones where a human must do something, and conflating "we are looking at it" with "you must decide" is the difference between an order that resolves and one that expires.

**Corrected after review:** an earlier draft applied this semantic to only two of the four actionable states, routing `PAYMENT_FAILED` and `CUSTOMS_EXCEPTION` to `status.blocked` — committing the exact conflation the paragraph above warns against. `alertFor` (`order-state-machine.ts:213-278`) is the authority: **four** states carry `actionable: true`, and all four get this treatment. `status.blocked` is reserved for states where the customer genuinely cannot act (`OUT_OF_STOCK`, `PROCUREMENT_FAILED`, `SHIPMENT_EXCEPTION`).

**Full 24-state mapping is not duplicated here.** `STATE_BADGES` and `alertFor` are the runtime authority; this table defines the *semantics they map onto*. Any state absent from `STATE_BADGES` (see §9a) must be added there, not given a parallel mapping in the design system — two sources of status truth is the failure this avoids.

**Financial semantics** (§7) and **provenance semantics** (§8) get their own tokens rather than reusing status colors, because "this price is an estimate" and "this order needs attention" are different claims.

## 3. Contrast and accessibility

**Target: WCAG 2.1 AA minimum** — 4.5:1 body, 3:1 large text and non-text indicators. **Not yet measured.** The palette was designed against a light paper ground and the ink ramp is deep, so compliance is likely for text roles; `saffron` on light surfaces is the known risk and must be verified before use as text rather than as a fill. **Verification is a Phase 12 gate, not a claim made here.**

Requirements, all mandatory:
- **Color is never the sole carrier of meaning.** Every status pairs color with a **label**; an icon is added where the status is actionable or critical. **Correction:** an earlier draft claimed color+label+icon was "already the existing pattern (`STATE_BADGES`)" — `STATE_BADGES` (`apps/web/lib/order-display.ts:10`) is `{tone, label}` with **no icon**. The label pairing is existing and correct; the icon is new.
- **Focus is always visible**, 2px minimum, using `border.focus`, never removed without replacement. Critical for the keyboard-driven backoffice loop.
- **Keyboard navigation is a first-class requirement in the backoffice**, not an accessibility afterthought: next/previous record, command invocation, filter focus, and escape-to-close must all be reachable without a mouse. The operator loop in `interaction-architecture.md` §3 is faster by keyboard than by pointer, and that is the intent.
- **`prefers-reduced-motion` respected** — all non-essential motion suppressed.
- **Touch targets ≥44px wherever the input is touch**, including the backoffice below 768px — the rule keys on **input modality, not on app**. Pointer-primary backoffice surfaces may go to 32px. An earlier draft keyed it to the app, which would have left touch targets at 32px on the small-viewport backoffice the responsive strategy explicitly supports.
- **Errors are programmatically associated** with their field (`aria-describedby`, `aria-invalid` — already the existing pattern) and announced (`role="alert"` / live regions).
- **Dialogs, drawers, and inspector panels** trap focus, restore it on close, and are escapable.
- **Tables** use real semantics with `aria-sort`; a data grid that is a pile of `div`s is not acceptable for an operator using a screen reader.
- **Dynamic updates** (polling tracking, queue refresh) announce politely and never steal focus. **The one exception is a command's own outcome** — a version conflict on a command the operator just invoked moves focus to the re-presented decision, because it is the direct result of their action rather than a background update.

## 4. Typography

**Persian UI:** `Vazirmatn` with a system fallback stack (already implemented, and correctly not pulling a webfont the user must wait for). **English/back office:** system sans. **Numerals, identifiers, money:** a tabular-figure face.

**Tabular figures are required for all financial values, identifiers, and timestamps** — proportional digits cause column jitter and make comparison, the operator's core scanning task, measurably harder.

**With an honest caveat:** `font-variant-numeric: tabular-nums` is only guaranteed where the rendering font supports it. The Persian stack deliberately degrades to system fallbacks (Tahoma, Segoe UI) rather than blocking on a webfont, and tabular support for Arabic-Indic numerals in an unknown fallback **cannot be guaranteed**. Where alignment is load-bearing — ledger columns, the reconciliation view — the backoffice uses Latin digits (§4 digit rules) where the guarantee holds. For Persian-digit surfaces, alignment falls back to `text-align: end` plus fixed column widths rather than relying on glyph metrics.

**Scale** (rem-based, 16px root): `xs 0.75` (metadata only, never body) · `sm 0.875` (secondary, dense table cells) · `base 1` (body — the floor for anything read continuously) · `lg 1.125` · `xl 1.25` · `2xl 1.5` · `3xl 1.875`.

**Density is never achieved by shrinking type below `sm` in the backoffice or below `base` in the front office.** Denser rows come from line-height and padding, not font size. An operator squinting for eight hours is a health issue, not a design trade-off.

**Mixed-script handling** is a first-class rule, not a special case:
- Persian body text, LTR runs isolated with `dir="ltr"` and `unicode-bidi: isolate` — URLs, ASINs, tracking numbers, seller names, emails.
- **Identifiers never take Persian digits.** `XB-4F2A` and an ASIN are opaque tokens; localizing their digits breaks copy-paste and search.
**Digit locale is decided by value type first, surface second** — an earlier draft gave two rules with no single determinant:

| Value type | Digits | Rationale |
|---|---|---|
| **Identifiers** (order ref, ASIN, tracking no., phone, postal code) | **always Latin**, both apps | Opaque tokens; localizing breaks copy, paste, and search |
| **Money, quantities, counts, percentages, dates** | front office **Persian**, backoffice **Latin** | Reader expectation vs. cross-system reconciliation |
| **Anything the customer will retype elsewhere** (an amount entered into a banking app) | **Persian, with the Latin form available on copy** | The copy-paste argument that justifies Latin identifiers applies here too, and an earlier draft failed to apply it |

- **`toPersianDigits` is a blind `/\d/g` replacement** (`apps/web/lib/api.ts:340`) — safe on prose, **corrosive on identifiers**. It must never be applied to an `Identifier` component's content. Money is in fact localized by `Intl.NumberFormat('fa-IR')`, not by this helper; the two must not be confused during token extraction.
- **Inputs accept both Persian and Latin digits.** A customer typing on a Persian keyboard must never be told their own numerals are invalid.

## 5. Spacing, sizing, radius, elevation, motion

**Spacing:** 4px base — `0.5, 1, 1.5, 2, 3, 4, 6, 8, 12, 16` (×4px). Front office composes from the upper range; backoffice from the lower.

**Density modes**, a first-class token dimension rather than two stylesheets: `comfortable` (front office) and `compact` (backoffice operational surfaces) vary row height, cell padding, and control height — **not type size**.

**Radius:** `sm 6px` · `md 10px` (front office default) · `lg 14px` · `full`. The backoffice uses `sm`/`md`; the existing admin `8px` is reconciled to `sm 6px`/`md 10px` rather than kept as a third value.

**Elevation:** four levels, and **borders carry more structural weight than shadows** — a dense operational surface with many shadowed cards reads as noise. `flat` (border only) · `raised` · `overlay` (drawer/inspector) · `modal`.

**Motion:** `instant 0ms` · `fast 120ms` · `base 200ms` · `slow 320ms`, ease-out entering, ease-in exiting. **Motion must explain a change** — a panel sliding from the edge it will return to, a row settling after reorder. Decorative motion is prohibited, and all of it is suppressed under `prefers-reduced-motion`.

**Z-index:** a named scale (`base, dropdown, sticky, overlay, drawer, modal, toast, sandbox-indicator`) — no ad-hoc integers. **The sandbox indicator sits above everything**, deliberately, so it can never be occluded.

## 6. Interactive states

Every interactive component defines: `default`, `hover`, `active`, `focus-visible`, `disabled`, `loading`, `selected`, and — for operational rows — `current` (keyboard cursor) as distinct from `selected`.

`disabled` uses reduced opacity **plus** a non-interactive cursor and the appropriate ARIA state; it must never be the only signal that an action is unavailable (see authorization treatment in `interaction-architecture.md` §10).

## 7. Financial presentation

The system must distinguish these unambiguously, and **never by color alone**:

| Concept | Treatment |
|---|---|
| Estimate | explicit "estimate" label + provenance marker; never styled as final |
| Quote | standard money style |
| **Locked quote** | lock affordance + validity countdown — its TTL is the customer's decision window |
| Amount due | emphasized, primary weight |
| Amount paid | settled treatment + timestamp |
| Marketplace price | shown in **source currency (AED)**, labelled with the marketplace |
| FX conversion | rate and snapshot time shown; a rate without a timestamp is not trustworthy |
| Fees / shipping / customs | itemized in the breakdown, individually labelled |
| **Price changed** | before **and** after, with the delta explicit and signed |
| Refund | direction indicated by label and sign, not by color alone |
| Ledger debit/credit | column position + sign; accounting convention, tabular figures |
| Reconciliation discrepancy | **timing lag and genuine discrepancy are visually distinct** — Phase 6 established that one generic "unmatched" bucket makes the screen useless, since most unmatched rows at any moment are merely early |

**Currency is always explicit.** A bare number is prohibited on any financial surface — IRR and AED both appear in this product and the amounts differ by orders of magnitude.

### The rial/toman unit boundary — the single most dangerous detail in this system

**The API stores and transmits IRR in *rial*. Customers think, quote, and pay in *toman*. One toman = ten rial.** The existing implementation handles this correctly and documents why: `formatMoney` divides by 10 at the display boundary, "converting only at the display boundary keeps every stored and transmitted figure in one unit" (`apps/web/lib/api.ts:347-358`).

**An earlier draft of this document specified a `Money` component as "currency-explicit" and never mentioned the unit boundary at all. A `Money` primitive built to that spec would render every IRR value ten times too large.** That is a defect severe enough to be worth stating as a rule:

- `Money` **owns** the rial→toman conversion. No caller ever divides by 10; no caller ever passes pre-converted values.
- The **unit is displayed, not just the currency**: "تومان" / "Toman", never a bare number and never an ambiguous "IRR".
- **Rial is never shown to a customer.** It is a transport and storage unit only.
- **Backoffice may show rial** where operators reconcile against systems that use it — in which case the unit is labelled explicitly and the two are never adjacent without labels.
- **Mixing units within one panel is prohibited.** `QuoteBreakdown.tsx:49-50` currently shows a total in تومان beside an FX rate in ریال — a live instance of exactly this hazard, and a refactor target.
- AED is unaffected: no sub-unit conversion applies.

## 8. Trust and provenance patterns

From Phase 4. The system must represent **confirmed vs. inferred** at field level, never at record level.

- **Confirmed field:** rendered plainly.
- **Inferred field:** rendered with a provenance marker naming that it was estimated. **Derive "estimated" from `provenance.tier`** (`vision`/`manual` vs `api`/`structured`), not from a float compared against a threshold — Phase 7's review found that a vision-tier confidence capped at exactly `0.7` fails a `< 0.7` test and renders a model's guess as confirmed data. The tier is the honest signal.
- **Unavailable field:** shown as unknown, never defaulted. Pricing-safety defaults (weight → 1kg, seller → `'Unknown'`) must never render as observed data.
- **Unconfirmed availability** is distinct from confirmed-unavailable — recoverable from `provenance.available` without any API change.
- **Restricted / unsupported product:** blocked with a specific reason, never a generic failure.
- **Manual review:** the customer is told a person is checking, with an expectation of when.
- **Operator correction:** visibly attributed, and the operator must see that their entry becomes confidence 1.0.

**The governing rule: do not fabricate certainty through visual presentation.** A confident-looking layout applied to inferred data is a lie the design system tells on the backend's behalf.

## 9. Status architecture

**One shared status *vocabulary* (§2 layer 3); domain-specific *representations*.** A single universal status component would flatten genuinely different semantics — an order's lifecycle position is not a provider's health.

| Domain | Representation |
|---|---|
| Product resolution | resolved / needs-review / failed + per-field provenance |
| Quote | active with validity countdown / expired / blocked-by-viability |
| Payment | pending / paid / failed — pending is a real state, not a spinner |
| Customer order (customer view) | **8-step timeline**, exceptions as banners over it, never as steps |
| Customer order (operator view) | **24-state badge** + timeline + exception detail |
| Procurement | separate lifecycle from the order — Payment ≠ Purchased is an invariant the UI must not blur |
| Shipment | leg-based progression with per-leg carrier state |
| Customs | hold / cleared, with document-request state |
| Exception | type + severity + age + margin-at-risk + assignee |
| Refund | requested / pending / completed, with amount and expected timescale |
| Support case | open / awaiting-customer / awaiting-operator / resolved / reopened |
| Reconciliation | matched / timing-lag / discrepancy / escalated |
| Provider health | healthy / probing / quarantined — mapped from the breaker registry the failover selector actually reads |
| Sandbox | session active + virtual-clock offset |

### 9a. Status coverage is incomplete today — a live defect

`STATE_BADGES` is typed `Partial<Record<OrderState, …>>` and maps **21 of 24** states. `DRAFT`, `QUOTING`, and `QUOTED` have no entry, and the tracking page falls back to `label: order.state` (`apps/web/app/track/page.tsx:95`) — **printing `QUOTED` verbatim to a Persian customer.** That is a live violation of the rule that internal vocabulary never reaches the customer, and it is exactly what the `Partial` type permits.

**Requirement: the customer status map must be total, not partial.** A `Record<OrderState, …>` with no fallback makes an unmapped state a compile error rather than leaked jargon. Recorded as a Phase 12 fix; the type change is the fix.

**Terminal states always get explicit closure copy.** Phase 5 found `ALERTS` has no entry for `REFUNDED` or `CANCELLED`; the design system requires every terminal state to say something.

## 10. System states

Reusable patterns, each with a rule that prevents the lazy version:

- **Loading:** skeletons matching the eventual shape past ~300ms; staged copy for genuinely multi-stage work (resolution escalation). Never a bare spinner past ~1s.
- **Empty:** distinguish *no data yet* (guide to the first action) from *no results for this filter* (offer to clear it) from **queue clear** (an achievement in the backoffice — the one empty state that is good news).
- **Partial data:** show what is known, mark what is missing. Never suppress a whole view because one field failed.
- **Stale data:** show last-updated time and a refresh affordance. Applies to the tracking page (polling, may be open for days) and any operational list.
- **Error:** what happened, whether it is retryable, and what to do next. **"Something went wrong" is prohibited where actionable information exists** — and it usually does, since the API returns a typed taxonomy with bilingual messages.
- **Permission denied:** per `interaction-architecture.md` §10 — and the message must not leak what the actor cannot see.
- **Blocked:** distinguish *you cannot* (permission) from *not yet* (precondition) from *never* (domain rule, e.g. viability or eligibility).
- **Async processing:** a real state with expectation-setting, not an indefinite spinner.
- **Provider unavailable:** name the capability that is degraded, not the vendor. "Payment is temporarily unavailable," not "Zarinpal returned 503."
- **Offline:** front office only; preserve unsent input.

## 10a. Forms

Distinct from commands (`interaction-architecture.md` §7). **Forms capture data; commands express intent.** Most operator actions are commands and must not be built as forms — but forms genuinely exist for addresses, support cases, configuration, resolution overrides, and internal-user management.

| Concern | Rule |
|---|---|
| **Labels** | Always visible, never placeholder-only. Placeholders show format, not meaning |
| **Descriptions** | Persistent helper text below the field, not a tooltip, where the field needs explanation |
| **Client validation** | On **blur**, not on keystroke — validating a half-typed Persian phone number or postal code produces errors for input that isn't finished |
| **Error placement** | Adjacent to the field, programmatically associated, announced |
| **Server errors** | Field-level errors bind back to their field; form-level errors appear once, at the top, and never replace field state. The API returns a typed taxonomy with **bilingual (fa/en)** messages — the client selects the locale and must never invent its own copy for a server-originated failure |
| **Async validation** | (address serviceability, marketplace URL support) — inline pending state on the field, never a blocking overlay; a stale response must never overwrite a newer input |
| **Submission** | Control disabled for the duration; success or failure explicitly stated. Prevents double-submission — most consequential on money-bearing actions |
| **Multi-step** | Progress indicator, back navigation without data loss, and validation per step rather than only at the end. Checkout is the live example |
| **Drafts / autosave** | **Only where re-entry cost is high**: a support case body and a manual resolution override qualify. **Never for commands** — an autosaved reprice reason following an operator to a different order is a real hazard |
| **Destructive actions** | Confirmation naming the specific consequence; the confirm control carries the destructive treatment, and is never the default focus |
| **RTL** | Labels, errors, and required markers use logical properties; validation icons sit inline-end |

**Zero-result vs. empty** are different states with different copy: an unfiltered empty list guides toward the first action; a filtered one offers to clear the filter that produced it.

## 10b. Bulk actions

Phase 6 identified bulk operations as a genuine gap at operational volume (e.g. resolving a batch of stale shipment exceptions).

**The rule that keeps them safe: a bulk action executes as N individual domain commands, never as a batch mutation.** Each item is validated and audited independently, because partial success is the normal outcome — some items will have moved state since selection.

Requirements: explicit selection with a visible count; the action names its scope ("resolve 12 exceptions"); **per-item results** on completion, not a single aggregate toast; failures remain selected so they can be retried; and a reason, captured once, applied to every item and recorded on each. Bulk is offered only where the domain command itself is safe to repeat.

## 11. RTL and localization

**RTL is the substrate.** `dir="rtl"` on `<html>`, and **logical properties everywhere** (`margin-inline-start`, `padding-block`, `inset-inline`) — never `left`/`right`. This is already true in the front office and is the standard for both apps.

Explicit behaviors:

| Element | Rule |
|---|---|
| Reading & navigation direction | right-to-left; primary nav and back affordances mirror |
| **Tables** | column order mirrors; **numeric columns use `text-align: end`** (logical, not physical) so the accounting convention holds in both directions — an earlier draft said "right-aligned," which is a physical rule that inverts the convention under RTL; money stays tabular |
| Numbers & currency | front office Persian digits, backoffice Latin; currency always explicit |
| Mixed content | LTR runs isolated (`dir="ltr"` + `unicode-bidi: isolate`) |
| URLs, ASINs, refs, phones, emails | LTR, Latin digits, never localized |
| Dates | Persian calendar in the front office; ISO/Gregorian in the backoffice for cross-system work. **Both label their calendar** |
| **Directional icons** | mirror (arrows, chevrons, back, next). **Do not mirror** icons with fixed real-world meaning — clocks, logos, media controls, or a checkmark |
| Breadcrumbs / tabs | order mirrors |
| **Split panes & drawers** | the list sits on the **inline-start**, drawers enter from the **inline-end** — expressed logically so the rule holds in either direction. **Note:** split panes exist only in the backoffice, which is `lang="en" dir="ltr"` today (`apps/admin/app/layout.tsx:12`), so inline-start currently resolves to left. The rule is written logically anyway, because the backoffice displays Persian content and may yet need RTL sub-regions |
| Charts | axis and category order mirror; time still flows in the reading direction |
| Progress & timelines | advance in the **reading direction of their own surface** — RTL in the Persian front office, LTR in the English backoffice. **This is deliberate, not an inconsistency:** the same order's timeline flows differently in the two apps because direction follows the reader, not the record. Layer 3's rule that shared components must never *interpret* data differently still holds — the states, order, and meaning are identical; only the axis differs |

**English/LTR coexistence is required**, not optional: the backoffice is an English UI displaying Persian customer content, which is the mirror of the front office's problem and must work equally well.

## 12. Sandbox treatment

Sandbox must be **unmistakable and non-dismissible**, while remaining usable enough to exercise real journeys.

- A persistent frame indicator (top-level band, above all z-index layers) present on every surface of an active sandbox session, stating that this is a simulation.
- **Mock payment screens explicitly identify themselves as simulations and must never imply contact with a real provider.** No vendor logos, no imitation of a real gateway's branding.
- Virtual-clock state is visible whenever it is offset from real time, showing the offset — otherwise timestamps silently lie.
- Sandbox data inside production-shaped lists is labelled per row (the order search already defaults `sandbox: 'exclude'` for exactly this reason).
- **The treatment marks the frame, not the content** — dimming or restyling the application itself would prevent the sandbox from validating the real design.

**Security note, carried not solved:** P0-SEC-001 — the sandbox API is currently unauthenticated, ungated, and fails open. Visual treatment is not a control; this remains a Phase 10 fix.

## 13. Front office ↔ backoffice relationship

**Shared:** brand primitives, semantic color roles, status vocabulary, financial semantics, provenance semantics, accessibility rules, typography foundations, motion and z-index scales.

**Divergent by design:**

| | Front office | Backoffice |
|---|---|---|
| Density | comfortable | compact |
| Primary input | touch, mobile-first | keyboard, desktop-first |
| Navigation | minimal, task-oriented | module rail + working context |
| Disclosure | strong progressive disclosure | high information per viewport |
| Guidance | explanatory | assumes expertise |
| Language | Persian-first RTL | English UI, Persian content |
| Dark mode | supported (implemented) | supported (implemented) — **verified: `apps/admin/app/globals.css:39-40` has the same `prefers-color-scheme` + `[data-theme]` structure.** An earlier draft of this document claimed it was absent; that was wrong |

**Do not force identical component behavior where jobs differ.** A table in the front office (order list) and a table in the backoffice (exception queue) share tokens and status vocabulary, not interaction model.

## 14. Known gaps and gates

- **Contrast is unverified** (§3) — a Phase 12 gate.
- **Backoffice RTL is not implemented.** `apps/admin` uses zero logical properties and one physical `left`/`right` rule, versus twelve logical and zero physical in `apps/web`. The backoffice is an English LTR UI so this is not currently broken, but it means the admin stylesheet cannot host RTL content without rework — and Persian customer content already appears in it. Logical properties should be adopted there regardless of UI language.
- **The two apps duplicate palette values** with drift already present — resolved by the shared token package in `component-architecture.md`.
- **No operator was interviewed** (Phase 6). Density and workspace decisions are reasoned from the domain, not observed. The compact density scale in particular deserves validation.
- **Persian calendar handling** is specified but no library choice is made — Phase 10/12.

---

## 15. Review record

### Review A — self completeness (ran first)

Checked every Phase 8 acceptance criterion for coverage. **Found two genuine gaps:** forms architecture (async validation, server errors, multi-step, drafts/autosave) and bulk actions were absent — both now specified (§10a, §10b). Also caught one of my own false claims before the adversarial pass: I had written that the admin app lacks dark mode; it does not.

**Consistent with Phases 5–7:** self-review found *omissions*. It did not find a single contradiction.

### Review B — independent adversarial (fresh context, source artifacts only)

Twenty-one defects, every one verified against source before acceptance. The most consequential:

| # | Defect | Severity |
|---|---|---|
| B1 | **The rial/toman unit boundary was never mentioned.** The API stores IRR in rial; customers use toman; `formatMoney` divides by 10 at the display boundary. A `Money` primitive built to the original spec would render every IRR value **10× too large** | **critical** — would have shipped a financial defect into the shared component layer |
| B2 | **`TRANSITIONS` is exported nowhere** outside the API (verified: zero references in contracts or either app). The rule "the UI never offers an illegal transition" was therefore unimplementable under the stated architecture. Resolved by having the order detail response carry its legal next states | **blocking** |
| B3 | **`status.awaiting-customer` was applied to 2 of 4 `actionable: true` states**, routing `PAYMENT_FAILED` and `CUSTOMS_EXCEPTION` to `blocked` — committing the exact conflation the section warns against | high |
| B4 | **`STATE_BADGES` is `Partial` (21/24) and has no icon.** The doc claimed color+label+icon was the existing pattern. Worse, unmapped states fall back to printing the raw enum (`QUOTED`) to Persian customers — a **live** violation of "internal vocabulary never reaches the customer" | high |
| B5 | **Migration claimed "low risk, near-identical output."** The front office has 13 hardcoded px type sizes and a **15px body**, below the declared 16px floor. The largest cost in Phase 8 was unnamed and unmeasured while serving as the regression baseline | high — the weakest claim |
| B6 | Backoffice described as Vite + React in the **present tense**; it is Next.js 15 static export today | medium |
| B7 | `GET /v1/me/permissions` and the `finance` order-read grant stated as current; both are Phase 10 targets | medium |
| B8 | **`--ok #17705f` is a fourth green**, not `turquoise-dark`, and is what success actually renders as — omitted from the primitive layer | medium |
| B9 | "Numeric columns stay **right**-aligned" — a physical rule that inverts the accounting convention under RTL | medium |
| B10 | Workspace pattern assigned by "deliberation speed," applied inconsistently to F9/reconciliation/compliance. Real discriminator is *sequence of comparable records* | medium |
| B11 | Missing degradations: selected record leaving the filter, permission-fetch failure (fail-open risk), deep link to an unpermitted module, backoffice offline | medium |
| B12 | Unsaved-input confirmation would fire a modal per record during keyboard traversal, destroying the loop the workspace exists to enable | medium |
| B13 | Tab persistence could hide the Decide tier; compact row dropped margin-at-risk, deleting the Scan tier | medium |
| B14 | Tabular figures declared "non-negotiable" but unguaranteeable for Arabic-Indic glyphs in an unspecified system fallback | medium |
| B15 | Digit rules had two determinants (app vs. value type) with no precedence, leaving quantities/counts/dates unassigned | medium |
| B16 | `toPersianDigits` is a blind `/\d/g` replace — cited as a "correct localization primitive" while being corrosive on identifiers | medium |
| B17 | Touch-target minimum keyed to app rather than input modality | low |
| B18 | Admin's dark block never overrides the accent colors — the real defect, narrower than the "no dark mode" claim | low |
| B19 | Admin API client is hand-written, not generated; `If-Match` on two calls, not all | low |
| B20 | Split-pane RTL parenthetical described an app the pattern doesn't run in | low |
| B21 | Timeline direction differs between apps for the same order — kept, but now stated as deliberate rather than left as an apparent contradiction | low |

**Nothing was rejected.** Every finding was verified and accepted; several (B1, B2, B5) changed the architecture rather than the prose.

**The pattern now holds across four consecutive phases:** self-review finds omissions; only adversarial review finds contradictions the author believes are consistent. Phase 8's most severe defect (B1) was a financial correctness error invisible to a completeness check, because nothing was *missing* — the spec was complete and wrong.
