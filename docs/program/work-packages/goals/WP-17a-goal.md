# /goal — WP-17a Design tokens & money foundation

Work in `~/Desktop/shop-wp17a` (branch `feature/wp-17a`). Run `pnpm install` in `platform/` first.

WP-17a is fully implemented and verified per `docs/program/work-packages/WP-17-to-WP-22-tranche-4.md` (WP-17 section).

**WP-17 is one package in two stages. You are implementing stage 17a only.** Stage 17b — the `amountMinor` / explicit-`unit` contract rename — is **out of scope here** and must wait for a scheduled slot after Tranche 2, because renaming a field in `packages/contracts/src/schemas.ts` collides with every package touching schemas during Waves 1–3.

## Before changing code

1. Read the WP-17 section, then `docs/design/design-system.md` (§1 visual direction, §4 typography, §7 financial presentation) and `docs/design/component-architecture.md`.
2. Read `apps/web/app/globals.css`, `apps/web/lib/api.ts`, `apps/admin/app/globals.css`, `apps/admin/lib/api.ts`.
3. **Enumerate the behavioural set.** Derive from source: **every site that converts or formats money** — there are at least three and they are not all the same operation; every `font-size: …px` declaration (26 declarations across 13 distinct values, not 13); every duplicated design token across the two stylesheets.

## The money rule — the reason this package exists

Canonical IRR is **rial** in domain, API and storage. Customer display is **toman**. The conversion belongs in **one** place.

**It is currently duplicated in both clients** — `apps/web/lib/api.ts:356` and `apps/admin/lib/api.ts:190`. Note carefully: `packages/core/src/money.ts:214` divides by a **generic minor-unit exponent**, which is a *different* operation and **not** the defect. An earlier draft of the plan named that file as the home of the 10× error; it is the one place the bug is not. Verify this yourself before touching anything.

**G-34** — `QuoteBreakdown.tsx:49-50` shows a total in تومان beside an FX rate in ریال, in one panel. Remove mixed-unit surfaces.

## What you own

`@xb/design-tokens` extracted from `apps/web/app/globals.css`, with semantic and domain layers, a density attribute, and dark mode defined **once** (both apps already implement it independently — that duplication is the point). One authoritative conversion/display primitive. Reconcile `--ok #17705f`, a **fourth green** distinct from `turquoise-dark`, which is what success actually renders as.

## Honest sizing — do not claim a no-op

The type migration is **not** visually neutral. The front office has a **15px body** against the 16px floor the design system declares. Either type changes visibly or the floor is abandoned. **Recommendation: accept the change** — 15px is small for Persian letterforms — and **migrate spacing tokens separately**, since those genuinely are low-risk. Say which you did.

## What you must not do

- **No contract field renames** (that is 17b).
- **Do not migrate the admin app to Vite** — WP-20.
- **Do not change `apps/admin/lib/api.ts` beyond the money formatter**; WP-20 and WP-22 also touch that file later.
- **Do not alter state→presentation mappings** — WP-18.

## Tests

A known quote total serializes as **rial** and renders as **÷10 with a toman unit label** — **a 10× error must fail the suite**. No component performs its own conversion. Contrast targets verified against real tokens where practical.

Run full `vitest` and `turbo typecheck`. Baseline: **165 tests / 8 files, 16/16**.

## Reviews

Self-review, then adversarial review hunting: a surviving conversion site outside the primitive; a mixed-unit surface; a token duplicated rather than shared; a claim that the migration is visually neutral when type sizes changed; scope leakage into 17b, WP-18 or WP-20.

## Bookkeeping

**Do not edit shared program-state documents.** Record changes in `docs/program/work-packages/completions/WP-17a-completion.md`.

Commit once, descriptively, and stop.
