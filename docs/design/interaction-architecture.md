# Interaction Architecture

> Phase 8 of `docs/program/MASTER-PROMPT.md`. **Experience architecture and design only — no mass screen implementation.** Companions: `docs/design/design-system.md` (visual language, tokens), `docs/design/component-architecture.md` (layers, inventory, existing-UI assessment).
>
> Inputs: Phase 3 journeys (J1–J15), Phase 4 resolution archetypes, Phase 5 front-office IA, Phase 6 backoffice operating model (F1–F9), Phase 7 authorization model + ADR-001.
>
> **This document exists to stop the system regressing to page-per-resource CRUD.** Where it states a pattern, it states the reasoning, so a later implementer can tell a deliberate choice from an arbitrary one.

## 1. Experience principles

Six principles, each traceable to a finding rather than to taste.

1. **Context is expensive; preserve it.** An operator who loses a filtered queue position to inspect one order pays that cost again on every subsequent record. Derived from Phase 6's manage-by-exception model, where the queue *is* the job.
2. **The interaction cost that matters is cognitive, not click count.** Fewer clicks that produce an ambiguous or unsafe action is a worse design. Explicitly rejected: optimizing to minimum clicks.
3. **Commands, not forms, for domain actions.** Phase 6 verified structurally that no generic CRUD mutation exists on the admin surface (one `@Delete`, on an ephemeral sandbox session; no `PATCH`/`PUT` anywhere). The UI must not reintroduce what the API refused.
4. **Show uncertainty; never manufacture certainty.** From Phase 4: a field's provenance and confidence are first-class, and a defaulted value (weight → 1kg, seller → `'Unknown'`) must never render as observed.
5. **The customer sees a service; the operator sees a system.** The same order is one honest promise to a customer and twenty-four states to an operator. Divergence here is correct, not inconsistency.
6. **RTL is the substrate, not a mode.** Already true in the front office (`dir="rtl"` on `<html>`, logical properties throughout) — extend rather than retrofit.

## 2. Front office — experience philosophy

**The customer product must feel simpler than the system behind it.** The link-first premise (`CLAUDE.md`: no catalog, search, or merchandising) means the front office has exactly one entry and one spine: paste → recognize → price → decide → pay → track.

**What the customer must understand**, in priority order: what was resolved; what it costs, all-in, in Toman; what is uncertain; what they must do next; what is happening now; whether their action worked; what happens when it doesn't.

**What is deliberately hidden.** The twenty-four internal states project to eight customer steps (`buildCustomerTimeline`) — already implemented and correct. Exceptions never become timeline steps; they surface as a banner over a timeline the customer already understands. Internal vocabulary (`PROCUREMENT_PENDING`, `procurement order`, `outbox`, `tier`, `cost units`) never reaches the customer.

**Progressive disclosure, concretely:** the landed-cost total is the headline; its itemization is one interaction away, never collapsed *out* of reach and never expanded by default on mobile. A total that can be decomposed is a total that can be believed — but decomposition is a trust affordance, not the primary reading.

**Density:** low. Generous spacing, one primary action per screen, mobile-first. The front office is used occasionally by a first-time user under mild financial anxiety; the back office is used all day by an expert. Applying one density to both would fail both.

## 3. Backoffice — interaction philosophy

### The core problem

Phase 6 established that the back office is an **operational workspace**, and that the ranked exception queue is the home screen by RULE. Phase 3's J10 described the operator loop: open a queue item, understand it, act, return, take the next.

Today's implementation makes that loop expensive. `apps/admin` is four pages with query-param detail (`/order/?id=`). The loop is:

```
queue → click → full page nav → inspect → browser back →
queue refetches → filters reconstructed? → find position → next
```

Every step after "inspect" is pure overhead, repeated per record. At ten exceptions a day it is an annoyance; at a hundred it is the job.

### The decision: persistent list + detail for queue-driven work

**For high-frequency queue processing — exception triage (J10), order operations, resolution review, support, reconciliation — the working surface is a persistent list beside a detail region**, not a list page that navigates away.

Specifically: global module navigation persists; the filtered, sorted, paginated queue persists and keeps its selection; the selected record's detail occupies the working region and may itself carry tabs or sections.

**Why this pattern, argued rather than asserted:**

| Property | Page-per-record | Persistent list + detail |
|---|---|---|
| Queue state after inspecting | reconstructed (refetch, scroll, filters) | retained |
| Cost of "next record" | back + find + click | one key or click |
| Comparing two records | impossible without two tabs | adjacent in time, same frame |
| Deep-linking a record | natural | requires explicit URL sync |
| Small viewport | works | needs a degradation strategy |
| Implementation cost | lower | higher |

The first three rows are the operator's actual day; the last three are real costs I accept and mitigate below. **The decisive factor is repetition** — this loop runs tens to hundreds of times per shift, and each of the first three rows compounds per iteration while the costs are paid once by the implementer.

**Explicit mitigations, because the costs are real:**
- **Deep-linking is mandatory, not optional.** Selection state lives in the URL (`/exceptions?state=…&cursor=…&selected=<id>`), so a workspace is shareable and reloadable. A workspace that cannot be linked to is worse than pages for support handoffs — "look at this order" is a message operators send each other constantly.
- **Below the split's viable width the workspace degrades to list-then-detail navigation** with queue state preserved in the URL — see §9. It degrades to conventional navigation; it does not shrink into unusability.
- **Next/previous record navigation** with keyboard binding, so the loop never requires returning to the list at all.

### Where this pattern is *wrong*

Applying it everywhere would be the same mistake as page-per-resource, inverted.

- **Configuration and reference data** (`/config/*`, rate cards, routes, warehouses, internal users) — conventional list → detail/form. These are low-frequency, high-deliberation, often long-form. A split view adds chrome and steals width from a form that wants it. **Phase 6's resource-management vs. operational-workflow distinction maps directly onto this.**
- **Rate-card activation** — a deliberate, consequential, effective-dated action that changes the basis of live quotes. It should feel weighty: a dedicated surface with explicit review before activation, not an inline edit in a side panel.
- **Audit log** — a read-only investigative list. Filter + expandable rows; there is no "act on this record" loop to preserve.
- **Compliance review** — arguably queue-shaped, but each decision is slow and evidence-heavy, and cross-customer pattern comparison matters more than throughput. **Undecided pending real workflow evidence**; Phase 6 flagged that no operator was interviewed, and this is exactly the kind of choice that needs it. Default to queue+detail, revisit.

**The criterion, stated explicitly after review found it applied inconsistently.** The exclusion above is *not* "slow and deliberate" — resolution review (F9) and reconciliation are also slow and evidence-heavy, yet both are assigned to workspaces. The actual discriminator is **whether the operator processes a *sequence* of comparable records**:

| | Sequence of comparable records? | Pattern |
|---|---|---|
| Exceptions, orders, resolution review, reconciliation, support | **yes** — the queue is the unit of work | workspace |
| Config, rate cards, internal users | no — each item is visited for its own sake | list → detail |
| Audit log | no — investigative reading, no per-record action | filter + expandable rows |
| Compliance | **unclear** — low volume, but each case spans multiple customers | workspace by default, flagged for validation |

Deliberation speed affects the *detail* design (more evidence, more tabs, heavier confirmation); it does not change whether the list should persist. An earlier draft conflated the two.

### Contextual investigation without leaving the workspace

Phase 6's F1 and the Phase 7 model established that a finance operator must read order/payment/refund context from a ledger entry **without** order-management authority. That is an *interaction* requirement as much as an authorization one.

**Pattern: contextual inspection layers over the working context, not instead of it.** From a ledger row, the linked order opens as an inspector panel — enough to answer "what is this?" — with an explicit affordance to open it fully if the operator has the permission and the need. Investigation should not cost the reconciliation position.

This generalizes: order → customer, order → procurement, case → order, exception → order. **Cross-resource links open contextually by default and navigate fully only on explicit intent.**

**Bounded to one level.** An inspector may be opened from the working context; it may not open another inspector. A second hop (ledger → order → customer) **replaces** the inspector's content with a back affordance, rather than stacking panels — nested overlays lose the working context they exist to preserve. Above 1280px the inspector overlays the detail region rather than displacing it; where side-by-side comparison of two records is the actual task, that is what pinned comparison (§4) is for, not the inspector.

## 4. Workspace continuity — what persists

Persisted across inspection, and encoded in the URL so it survives reload and sharing: active filters, sort, search query, cursor/page position, selected record, scroll position in the list, active detail tab, and any pinned comparison record.

**Not persisted:** unsaved command input. A half-filled reprice form must not silently follow the operator to another record — a reason field carried onto the wrong order is a genuine hazard.

**Reconciled with fast traversal, after review:** an unconditional confirm-on-discard would fire a modal per record during keyboard next/next/next, destroying the loop the workspace exists to enable. The rule is therefore: **command input is discarded silently when untouched, and confirms only when the operator has actually entered something.** A focused-but-empty reason field is not "in progress." Commands are also **scoped to their record** — navigating away closes the command, it never retargets.

**Consequence for implementation:** queue state belongs in the URL and in a query cache keyed by that state, never in component-local state that unmounts on selection. This is the single most important structural instruction in this document — it is what makes context preservation real rather than aspirational, and it is the thing a later implementer is most likely to get wrong by reaching for local state.

## 5. Information density

Backoffice operators are repeat expert users. Optimize for scanability, comparison, prioritization, and keyboard efficiency — **high information value per viewport without cramming**, achieved through hierarchy, alignment, and grouping rather than shrinking type.

**The four-tier information model**, applied to every operational row and detail:

| Tier | Question | Where it lives |
|---|---|---|
| **Scan** | Which of these needs me first? | queue row — state, age, margin-at-risk, type, assignee |
| **Decide** | What is going on with this one? | detail header + summary — the localized `summariseException` output, key money, timeline position |
| **Act** | What can I do, and is it safe? | command region — legal transitions only, with reason capture |
| **Investigate** | Why did this happen? | tabs/panels — timeline, ledger, procurement, provenance, audit |

**Type never shrinks below the design system's operational minimum to gain density** (`design-system.md` §typography). Density comes from tighter spacing scale, denser row height, and alignment discipline — not from 11px text an operator squints at for eight hours.

## 6. Resource management vs. operational workspaces

Preserved from Phase 6, and the mapping is now an interaction rule:

| | Resource management | Operational workspace |
|---|---|---|
| Examples | rate cards, routes, warehouses, marketplaces, internal users, roles | exceptions, orders, procurement, resolution review, support, reconciliation, payments/refunds |
| Frequency | rare, deliberate | constant, repetitive |
| Pattern | list → detail/form | persistent list + detail |
| Mutations | create/update/archive (CRUD is appropriate) | **domain commands only** |
| Density | moderate | high |

**The rule that prevents the regression this document exists to prevent:** *CRUD is permitted only for reference data with no state machine and no financial effect.* Anything touching an order, procurement, money, or live provider routing is a command with preconditions, confirmation, reason capture, and audit.

## 7. Commands — interaction patterns for domain actions

Phase 6 named the vocabulary: approve, retry, assign, resolve, refund, reprice, advance, cancel. These are **not** forms with a Save button.

**Command interaction contract:**
- **Only legal actions are offered.** The UI must never present an illegal target and rely on the backend to reject it — offering an action that will fail is a design defect.

  > **Blocking gap found in review, and it has no sanctioned implementation today.** `TRANSITIONS` lives in `apps/api/src/domain/order-state-machine.ts` and is exported to **neither** `packages/contracts` **nor** either frontend (verified: zero references outside the API). The component layers forbid data fetching, and there is no domain-logic package in the architecture — so as written, the only ways to satisfy this rule are a second copy of the authority table in the admin app (which would drift from the real one, and the state machine is explicitly the single authority) or an endpoint that does not exist.
  >
  > **Resolution, chosen:** the **order detail response carries its legal next states**, computed server-side from `TRANSITIONS`. The UI renders what it is given and holds no transition knowledge. This keeps one authority, survives state changes between fetch and render (combined with `If-Match`), and needs no new package. *Alternative rejected:* exporting `TRANSITIONS` through `@xb/contracts` — it would work, but it duplicates domain logic into a schema package and lets the client compute an answer it should be told. **Recorded as required API work (Phase 10), and until it exists this rule is unimplementable.**
- **Consequence stated before commit** — the resulting state, named, in the confirmation.
- **Reason capture where the domain requires it** (`transition` and `reprice` both mandate a reason today; preserve that).
- **Optimistic-concurrency conflict is a normal outcome, not an error.** `If-Match` already exists on `transition` and `reprice`. A version conflict means "someone else acted" → reload, re-present, let the operator re-decide. Phase 5 identified the same need for the customer decision panel.
- **Irreversible and money-moving commands** (`refund:issue`, `config:activate`, `provider:control`) get a distinct confirmation treatment and, per Phase 7, an approval threshold where designed.
- **No undo.** Recovery is a further legal forward transition, matching the immutable-timeline invariant.

**Inline editing** is permitted only for reference data fields with no domain consequence. It is never permitted on an order, procurement, ledger entry, or provider routing.

### Degradation and edge cases in the workspace

Named because a workspace has failure modes a page does not:

- **The selected record leaves the filter** (a poll or another operator's action moves it out of scope): the detail **stays open and is marked as no longer matching the current filter**, with an affordance to clear the filter or move on. It is never silently closed — an operator mid-decision losing the record to a background refresh is the worst possible behaviour.
- **The list refreshes under the operator:** selection is preserved by id, not by index. New items enter without reordering the operator's current position.
- **Deep link to a module the actor lacks permission for:** `404`, matching §10's information-disclosure rule — the module is omitted from navigation, so confirming its existence via a deep link would defeat that.
- **Deep link to a record that no longer exists or was never theirs:** `404`, never `403`.
- **The permission fetch fails:** navigation **fails closed** — modules are hidden and commands disabled until permissions resolve. A permission fetch failure must never fall open to a full-capability UI.
- **Backoffice offline / API unreachable:** the workspace retains its last-loaded list and detail as explicitly stale (last-updated shown, commands disabled), rather than blanking. Eight-hour shifts on imperfect connectivity make this an operational surface concern, not just a front-office one.

## 7a. Tables as operational components

A backoffice table is not a rendered list — it is the operator's primary working surface, and its behavior is part of the interaction architecture rather than a styling concern.

**Row activation does not navigate.** In an operational workspace, activating a row **selects** it and swaps the detail region; the list keeps its position, filters, and scroll. This is the single most consequential table decision in the system, and it is the default assumption most implementations get wrong. Navigation happens only on explicit intent (open in new tab, or a resource-management table where detail is a separate page).

**Capabilities, where the domain justifies them:**

| Capability | Notes |
|---|---|
| Sorting | server-side; `adminOrderSearchQuery` already defines five sorts |
| Filtering | persistent, URL-synced, visible as removable chips so active filters are never invisible |
| Pagination | cursor for queues (append-friendly), offset where total counts matter |
| Selection | single (drives detail) and multi (drives bulk) are **distinct interactions** and must not be conflated |
| Row actions | only for safe, frequent commands; consequential ones live in the detail's command region where confirmation and reason capture belong |
| Search | free text across the identifiers an operator actually quotes — public ref, order id, phone, name |
| Saved views | a named filter+sort+column set; the mechanism that stops operators rebuilding the same query daily |
| Column management | show/hide and reorder, persisted per operator |
| Keyboard | up/down moves the cursor, enter selects, and the cursor is **visually distinct from selection** |
| Loading | skeleton rows preserving column widths — no layout shift |
| Empty | filtered vs. unfiltered vs. queue-clear are three different messages |
| Accessibility | real table semantics with `aria-sort`; a grid of `div`s is not acceptable |

**Density belongs to the table, not the page:** compact row height and cell padding, with type at the operational floor and never below.

## 8. Navigation

**Front office** — minimal and task-oriented. Unauthenticated: brand, and a single entry to `/login`. Authenticated: brand, orders, account menu. An attention badge on orders when any order sits in an `actionable: true` exception state — until notifications exist this is the only mechanism bringing a customer back to a decision they must make. No mega-menu, no catalog nav, no breadcrumbs (the hierarchy is one level deep).

**Backoffice** — two distinct levels, deliberately separated:
- **Global module navigation** (persistent rail): the operating areas the operator holds permissions for. Queue first, always.
- **Local working context** (within the workspace): selection, detail tabs, contextual panels.

**Breadcrumbs are not used in the operational workspace** — the list *is* the parent, and it is visible. They are appropriate in `/config`, which is genuinely hierarchical.

**Navigation is permission-shaped but not permission-secured** (§10).

## 9. Responsive strategy

Not global breakpoints alone — component behavior at the points where layout materially changes.

**Front office: mobile-first.** Single column below ~640px. Money never truncates or wraps mid-figure. Decision panels for actionable exceptions are never below the fold. Touch targets ≥44px. Pinch-zoom stays enabled — the existing `maximumScale: 5` and its rationale are correct and must not be "fixed."

**Backoffice: desktop-operational-first**, with defined degradation rather than shrinkage:

| Width | Workspace behavior |
|---|---|
| ≥1280px | list + detail side by side; contextual inspector overlays detail |
| 1024–1280px | list + detail persist, list narrows to a compact row variant. **The Scan tier is preserved, not trimmed** — state, ref, age **and margin-at-risk**, since §5 makes margin-at-risk load-bearing for prioritization. Assignee and summary drop instead; ranking without the ranking signal is not a queue |
| 768–1024px | **degrade to list-then-detail navigation**, queue state preserved in the URL; next/prev remains available so the loop survives |
| <768px | single column, read-and-triage only; consequential commands available but not optimized for. Not the intended operating environment, and it should not pretend to be |

**The degradation is a pattern change, not a squeeze.** A three-pane layout compressed to 700px is unusable; the same workflow as navigation with preserved state is merely slower.

## 10. Authorization-aware UX

Applying Phase 7. Backend authorization is authoritative; the frontend shapes experience from a resolved permission set delivered by **`GET /v1/me/permissions` — an endpoint that does not exist yet** (`authorization-model.md` §16 lists it as Phase 10 work). Every statement in this section is a design target, not current behaviour.

**When to hide, disable, or explain** — the rule is about information disclosure:

| Situation | Treatment | Why |
|---|---|---|
| Operator lacks the permission, and the action's existence is not sensitive | **Visible, disabled, with an explanation on interaction** | Teaches the system's shape; "ask your admin for refund authority" is useful |
| Operator lacks permission, and the action's existence reveals sensitive capability | **Hidden** | e.g. compliance actions should not advertise themselves to ops |
| Resource exists but is not the actor's (customer side) | **404, never 403** | A 403 confirms existence — an enumeration oracle. Already implemented correctly |
| Environment-gated route (dev gateway, sandbox in production) | **404** | Matches `dev-gateway.module.ts:42`'s existing reasoning |
| Whole module not permitted | **Omitted from navigation** | |

**The leak surfaces to watch**, called out because they are easy to miss: item counts on hidden modules; empty-state copy that names a resource the actor may not know exists; error messages that distinguish "no such order" from "not your order"; and disabled actions whose tooltip names a customer or amount. **A disabled control must not carry data the actor could not otherwise see.**

**And the rule that makes this safe:** every hidden or disabled action must still fail closed if called directly. Hiding is UX; the check is the control. Phase 7 records that this property is *achievable* but not yet true — the sandbox surface (P0-SEC-001) is currently bypassable.

## 11. Multi-business-line extensibility

The system must extend to Lines B/C without today's B2C customer meeting enterprise complexity.

**Mechanism: progressive capability composition.** The same shell, navigation model, and component vocabulary; what appears is a function of the actor's permissions and account context (Phase 7's `SELF` / `ORGANIZATION` / `PLATFORM`).

- A B2C customer at `SELF` sees the link-first spine and nothing else. **No organization switcher, no approval concepts, no empty "Team" nav item.**
- A future merchant at `ORGANIZATION` gains an organization context indicator, org-scoped order lists, member management, and wallet surfaces — reusing the same order card, timeline, money presentation, and status vocabulary.
- An enterprise user additionally gains approval queues and consolidation views.

**The seam is the account-context indicator**, which renders as nothing at all for a personal account. That single decision is what lets the shell be identical without B2C inheriting B2B chrome.

**What is explicitly not built now:** no org switcher, no placeholder screens, no speculative approval UI. Phase 5's reasoning holds — an empty business surface implies a capability that does not exist.

## 12. Validation scenarios

Each scenario names the pattern and, for operational ones, compares conventional navigation against the chosen alternative.

**1. Resolved product + quote (J1/J2, customer).** Single column. Product card with per-field provenance markers; landed-cost total headline with itemization one interaction away. Variation shown explicitly as its own labelled line. *Pattern: progressive disclosure, no navigation.*

**2. Checkout / payment (J5).** Linear steps, no branching navigation. Gateway departure is unmistakable. Return polls with pending as a real state. *Conventional linear flow is correct here — a workspace pattern would be actively harmful during a payment.*

**3. Order tracking (J6/J7).** Eight-step normalized timeline; exception banner over it, never a new step; decision panel above the fold when actionable. *Pattern: one screen, progressive disclosure.*

**4. Backoffice order queue.** Persistent list; rich filter set (the existing `adminOrderSearchQuery` already supports free text, multi-state, customer, total range, date range, sandbox mode, five sorts, pagination — the gap is UI, not contract). Saved views. *Conventional: each order opens a page, filters rebuilt on return. Chosen: persistent list + detail, because the search is expensive to reconstruct and operators re-run the same searches all day.*

**5. Inspecting many orders sequentially — the decisive scenario.** Conventional costs per record: back-navigation, queue refetch, scroll restoration, re-find, click. Chosen: selection stays in the list, detail swaps, **next/previous by keyboard**, queue never refetched. *This scenario alone justifies the pattern; it is the operator's most repeated action.*

**6. Exception queue (J10).** As above, plus: ranked ordering **must not be presented as risk-ranked while `updateRanks` has no caller** (F4) — showing a false ranking is worse than showing none. Empty queue is framed as achievement. Assign/resolve are commands (F2/F3 — no endpoints yet; the UI is designed, not built).

**7. Order/exception detail workspace.** Detail region with tabs: Summary, Timeline, Procurement, Money, Provenance, Audit. Commands in a persistent region, not buried in a tab. *Tabs rather than one long scroll because the operator returns to the same tab across records — active tab persists across selection, which turns "check the ledger for each of these" into one tab choice instead of N scrolls.*

**With a reset rule, added after review:** persisting the tab can hide the Decide tier (§5) when the operator last used Audit or Provenance. **Summary is always shown on selecting a record whose exception *type* differs from the previous one**; the tab persists only while traversing like-for-like records. Persistence serves a batch of similar work; it must not hide why *this* record is here.

**8. Finance reconciliation investigation (F1).** Ledger list persists; selected entry's context opens as an inspector showing the linked order, payment, and refund — read-only, matching `finance`'s permission set exactly. *Conventional: navigate to the order, lose reconciliation position, navigate back. Chosen: inspector layer, because the investigation is a lookup in service of the reconciliation, not a departure from it.* **Note the permission dependency:** this matches `finance`'s **proposed** Phase 7 composition. Today F1 blocks it entirely — a finance operator can reach no order endpoint — and `authorization-model.md` records the `order:read` grant as a deliberate widening. The workspace is undeliverable until that lands.

**9. Manual product-resolution review (F9).** Queue of `NEEDS_REVIEW`/`FAILED` requests + detail showing per-field provenance, confidence, and what the ladder tried; operator supplies overrides field by field. **Every field must show what was inferred vs. confirmed, and the operator's own entry becomes confidence 1.0** — the UI must make that consequence visible. *No endpoint exists (F9, P0); this is design for a capability that is currently unreachable.*

**10. Permission-denied action.** Per §10's table. Validated specifically against `finance` attempting `order:transition`: the command is **visible and disabled with explanation**, because a finance operator legitimately knows orders exist and can read them — hiding it would be confusing, and the explanation is genuinely useful.

**11. Sandbox / mock payment.** Persistent, non-dismissible sandbox indication; mock gateway visually unmistakable and explicitly labelled a simulation. *Must remain usable enough to test real journeys — the treatment marks the frame, not the content.*

**12. Future B2B context.** Same shell; organization indicator appears; order list scopes to the org; member management appears in the account menu. *Verifies the seam works without B2C seeing any of it.*

## 13. What this document forbids

For the avoidance of doubt, and because these are the specific regressions likely under implementation pressure:

- A queue whose selection navigates away and loses filter state.
- A generic `DataTable` reused identically for exceptions, rate cards, and the audit log.
- Editable form fields on an order, procurement, or ledger entry.
- A command that offers an illegal state transition and relies on the API to reject it.
- Component-local queue state that unmounts on selection.
- A three-pane layout compressed below its viable width instead of degrading.
- Density achieved by shrinking type.
- Enterprise chrome (org switchers, approval nav) visible to B2C customers.
- Internal domain vocabulary in customer-facing copy.
