# Backoffice Operating Model

> Phase 6 of `docs/program/MASTER-PROMPT.md`, scoped per the sequencing clarification in `docs/program/PROJECT-STATE.md`: **discovery and design only.** The Vite + React migration and screen build-out are Phase 12 work packages. Companion: `docs/ux/backoffice-ia.md` (information architecture, capability matrix, RBAC requirements).
>
> Inputs: `docs/product/personas.md` (internal actors I1–I6), `docs/ux/journey-map.md` (J10–J15), `docs/ux/service-blueprint.md`, `docs/ux/state-matrix.md`. Verified against `apps/api/src/modules/admin.module.ts`, `apps/admin/`, `packages/contracts/src/schemas.ts`, `apps/api/src/common/http.ts`.

## The operating principle

**Manage by exception.** The back office default view is the ranked exception queue, never a list of healthy orders (`CLAUDE.md` RULE). This is implemented and load-bearing: `OpsService.searchOrders`' own docstring states it is "the counterpart to the exception queue rather than a replacement for it. The queue stays the default view and still shows only what needs a human."

Everything below follows from that. An operator's day is *clearing a queue*, not *browsing records*. Resource-management screens exist to answer questions raised by the queue, not to be the primary surface.

## Operator personas reconciled with the model

Phase 2 defines six internal actors. Reconciling them against what the system actually enforces:

| Actor | Job (JTBD) | Enforced role today | Surface today | Verdict |
|---|---|---|---|---|
| **I2** procurement/ops | Clear only exceptions that need a human, fast | `ops` \| `admin` | queue, order search, order detail, procurement copilot | **Best-served.** The core loop works |
| **I3** logistics | Keep parcels moving; resolve shipment/customs holds | *none — folds into `ops`* | same as I2 | **Merged by default, not by decision.** See finding F4 |
| **I4** finance/reconciliation | Every rial reconciles; see FX exposure | `finance` \| `admin` | ledger + balances only | **Structurally blocked.** See finding F1 |
| **I1** support | Resolve cases with full order + ledger context | *none exists* | none | No surface (Phase 3 finding, confirmed) |
| **I5** compliance/risk | Keep orders within personal-import/AML limits | *none exists* | none | No surface |
| **I6** system administrator | Grant/revoke exact access, audit trail | `admin` (implicitly) | none | No surface; blocked on RBAC (Phase 7) |

**Reconciliation conclusion:** the operating model the code implements serves **one and a half** of six actors well (I2 fully, I3 by accident of sharing I2's role). The remaining four are either structurally blocked or absent. That is the honest shape of Phase 6's scope.

## Resource management vs. operational workflows

MASTER-PROMPT requires these be distinguished rather than generating CRUD from tables. The distinction that matters here:

- **Operational workflow** — a *task* with an intent and a completion condition, expressed as a **domain command** with its own preconditions, audit trail, and (where money or a third party is involved) idempotency. "Retry procurement." "Resolve a price breach." Never a field mutation.
- **Resource management** — *reference and configuration data* with a lifecycle: list, detail, create, update, archive. Rate cards, routes, warehouses, providers.

**Where the current system sits:** it is almost entirely workflow, with essentially no resource management. Every mutating admin endpoint is a domain command (`transition`, `reprice`, `confirm`). Order state changes go through `OpsService.transition`, which is gated by the same `TRANSITIONS` table as the automated path, so an operator cannot drive an order into an illegal state.

**Verified, not asserted:** grepping the entire API for `@Patch`/`@Put`/`@Delete` returns **exactly one hit across the whole service** — `@Delete('sessions/:id')` in `apps/api/src/modules/sandbox.module.ts:148`, which deletes an ephemeral sandbox session, not a domain aggregate. There is no `PATCH`/`PUT` anywhere in the codebase, admin or customer-facing, and no field-level mutation of any aggregate.

**This is a genuine architectural strength and the criterion "dangerous generic CRUD mutations are not used where domain commands are required" is already satisfied — not by policy, but structurally.** The risk in Phase 12 is *regression*: building configuration screens (rate cards, providers, warehouses) will introduce the first real CRUD surface in the back office, and the temptation will be to reach for a generic update endpoint. The rule to carry forward: resource CRUD is acceptable **only** for reference data with no state machine and no financial effect. Anything touching an order, a procurement, money, or a provider's live routing is a command.

## Workflow inventory

Nine operating areas, mapped to their status. **Wired** = command exists and is reachable by an operator; **partial**; **absent**.

### 1. Exception triage — I2/I3 — *partial*
The primary loop. `GET /v1/admin/exceptions` returns ranked open exceptions with `marginAtRisk`, `ageMinutes`, `rank`, `rankedBy`, `assignee`, and a localized `summary`, cursor-paginated with an optional `type` filter. Resolving actions: `transition` and `reprice`, both `If-Match`-guarded.

**Three half-wired mechanisms** — see findings F2, F3, F4.

### 2. Procurement — I2 — *wired*
The strongest workflow in the system. `GET /procurements/:id/copilot` recomputes the **live** price rather than reading the stored expectation, "because the whole point of this screen is telling the operator what the price is *now*." `POST /procurements/:id/confirm` records `externalOrderId` + `actualPaid` + optional note. This is assisted procurement done properly: the human buys, the system records deterministically.

### 3. Logistics — I3 — *partial*
No dedicated commands. Shipment and customs exceptions are handled through the generic `transition` against the state machine's shipment/customs edges. Workable, but there is no leg-level or carrier-level operator surface, and no way to record a carrier-status mapping when `normalizeCarrierStatus` returns `null` (Phase 3 finding).

### 4. Finance — I4 — *partial, and role-blocked*
`GET /finance/ledger` (optional `refId` filter, limit ≤200) and `GET /finance/balances`. Read-only, correctly — the ledger is deterministic and double-entry, and no operator should mutate it. See F1.

### 5. Reconciliation — I4 — *absent*
`reconciliationItems` exists as a table (Phase 3). No endpoint, no service method, no screen. Whether an automated matcher populates it remains unconfirmed — a carried-forward Phase 0 item that Phase 6 did not resolve either.

### 6. Customer support — I1 — *absent*
No case entity, no endpoints, no screen. Confirmed again this phase.

### 7. Configuration — *absent*
No surface for rate cards, routes, service zones, warehouses, marketplaces, customs config, restrictions, or feature flags. This is the area where resource-management CRUD will first appear.

### 8. Integration health — *wired (read-only)*
`GET /providers` projects the circuit-breaker registry into `HEALTHY | PROBING | QUARANTINED` with `lastError` — "the same state the failover selector reads," so operators see the truth the system acts on, not a parallel dashboard. Genuinely good. Read-only: no manual quarantine, force-close, or provider-priority override.

### 9. Product-resolution review — I2 (or a dedicated reviewer) — *absent* — **added after review**
Phase 4's resolution ladder terminates in a `manual` tier: `ManualResolutionStrategy` is "the floor that stops a resolution from ever being silently wrong," and it reads operator-supplied values from `ResolutionContext.manualOverrides`. There is **no operator surface to supply them** — see finding F9. Product requests in `NEEDS_REVIEW` or `FAILED` have no queue, no review screen, and no completion command.

### 10. Sandbox operations — *absent from the back office*
Sandbox endpoints exist and are consumed by the **front** office's `DemoPanel`. The back office has no sandbox surface — no scenario management, session list, or clock control for operators demonstrating or reproducing an issue.

---

## Findings

### F1 — Finance operators cannot see order context *(P1, operator-usability)*

`AdminController` is annotated `@Roles('ops','admin')` at class level; `finance/ledger` and `finance/balances` carry `@Roles('finance','admin')` at method level. The guard resolves with `reflector.getAllAndOverride([handler, class])` — **method-level overrides class-level**.

Consequences, both real:
- An `ops` operator **cannot** read the ledger. Correct — finance data is sensitive.
- A `finance` operator **cannot** call any other admin endpoint — not order search, not order detail. So I4's stated job ("every rial reconciles, with visibility into what it belongs to") is structurally impossible: they can see a ledger entry's `refId` but cannot look up the order it refers to.

Not a bug in the guard — the guard behaves correctly. It is an **operating-model gap**: the role matrix was never designed for an operator who needs read-only order context plus full ledger access. Phase 7 must model this as a permission (`order:read` + `ledger:read`) rather than as a single role string. Recorded as the sharpest concrete argument for Phase 7's scoped-permission model.

### F2 — `resolveException` exists but no operator can invoke it *(P0, orphaned capability)*

`OpsService.resolveException(id, note)` (`admin.module.ts:305-308`) calls `ExceptionRepository.resolve(id, note)`. Repository-wide search finds **exactly one reference: its own definition.** No controller route, no client method, no UI.

Why this matters more than an ordinary dead method: the exception queue is the back office's primary surface, and the only way to clear an item today is to **transition the order**. An exception needing no state change — investigated and found benign, a transient carrier blip, a duplicate — has **no exit from the queue**. In a manage-by-exception operating model, a queue that accumulates un-clearable items degrades the one screen the whole model depends on.

This is precisely MASTER-PROMPT §PHASE 3's rule inverted: *"No backend workflow may remain operationally inaccessible when a human is expected to manage it."* The workflow exists; the human cannot reach it.

### F3 — `assignee` is read but never written *(P1, half-modelled workflow)*

`assignee` is a DB column (`packages/db/src/schema.ts:434`), a contract field (`schemas.ts:292`), and is read into the queue DTO (`admin.module.ts:90`). **Nothing writes it** — no assign command, no service method, no endpoint. It is structurally always `null`.

MASTER-PROMPT §PHASE 6 names "reassign case" as an example workflow command. The data model anticipated it; the command was never built. Consequence: no work-in-progress concept. Two operators can pick up the same exception, and an item being actively worked is indistinguishable from an untouched one — the "still working, not stuck" gap flagged in J10.

### F4 — Exception ranking is nominal *(P1, confirmed from Phase 3)*

`rank` and `rankedBy` are surfaced, `rankedBy` defaults to `'deterministic'`, and `updateRanks()` (`packages/db/src/repositories.ts:656`) is **never called**. The queue's ordering — the mechanism that makes "margin-at-risk × urgency" real rather than aspirational — does not run. `marginAtRisk` and `ageMinutes` *are* computed per item, so the ingredients are present and the queue could rank client-side or on read as an interim step.

**F2, F3 and F4 together:** the exception queue is designed as a work-management system (rank, assign, resolve) and implemented as a **read-only list with two order-level commands**. That is the single most important structural finding of Phase 6, because it is the surface the entire operating model rests on.

### F9 — The resolution ladder's manual tier can never run *(P0, orphaned capability — found on review, initially missed)*

`ManualResolutionStrategy.resolve` throws `UpstreamError('Manual resolution requires operator input')` unless `ctx.manualOverrides` is populated. Repository-wide, `manualOverrides` has **exactly two references**: its declaration (`packages/commerce/src/types.ts:94`) and its consumer (`packages/commerce/src/strategies.ts:381`). **Nothing produces it.** There is no endpoint, no service method, and no screen through which an operator supplies overrides.

The consequence is the same shape as F2 but lands harder. The manual tier is the ladder's designed backstop — its own docstring calls it "the floor that stops a resolution from ever being silently wrong," and it is the only tier with confidence 1.0. A product request that reaches `NEEDS_REVIEW` or `FAILED` therefore has **no path to completion at all**: the automated tiers have already failed, and the human tier is unreachable. Phase 4 recorded the ladder as architecturally complete, which is true of the *strategies*; what is missing is the operator surface that feeds the last one.

Also confirmed: `NEEDS_REVIEW` appears nowhere in `apps/api/src`, so no queue or filter exists over product requests needing review.

**Together with F2 and F3, this is a pattern rather than three coincidences:** the system has three designed operator capabilities — resolve an exception, assign an exception, complete a resolution — each with data model and/or domain logic in place and **no reachable surface**. All three are on the operator side, and all three were built up to the controller boundary and stopped.

### F5 — I3 (logistics) is merged into I2 by default, not by decision

There is no `logistics` role. Any `ops` operator sees and can act on every exception type, including repricing — a procurement/commercial decision. Phase 2 recorded logistics "folds into ops surface for now"; this phase confirms it is a consequence of the flat role string rather than a deliberate scoping choice. Phase 7 input.

### F6 — The back office covers three of nine operating areas

`apps/admin/` has three nav entries (Queue, Orders, Finance) and four pages (`page.tsx` queue, `orders/`, `order/`, `finance/`). Against the nine areas above: exception triage, procurement (inside order detail), finance read, and integration health (`providers` is in the API client but has no page of its own) — against absent reconciliation, support, compliance, configuration, sandbox ops, and all administration.

### F7 — Optimistic concurrency already exists and should be reused *(positive finding)*

`transition` and `reprice` accept `If-Match` → `expectedVersion` (`admin.module.ts:496-527`), and the admin client sends it (`apps/admin/lib/api.ts`). This is the mechanism Phase 5 said was needed for the customer/operator decision race on the same exception (J7). **No new concurrency design is required** — the customer-facing decision endpoint should adopt the same `If-Match` contract, and "already decided" should surface as a version conflict rather than an error.

### F8 — Order search is genuinely well-specified *(positive finding)*

`adminOrderSearchQuery` supports free text across public ref / order id / phone / name; repeatable `state`; `customerId`; inclusive `minTotal`/`maxTotal`; `createdFrom`/`createdTo`; a three-way `sandbox` filter defaulting to `exclude` (with the reasoning that an operator hunting a customer's order almost never wants demo rows); five sort options; and `limit`/`offset` pagination. Validation goes through `parseOrThrow` specifically so a bad sort key returns a bilingual 400 rather than a 500. Phase 6 should **not** redesign this; the gap is UI, not contract.

## What Phase 6 does not decide

Role and permission *modelling* is Phase 7 — this document identifies requirements (F1, F5, and the per-area needs in `backoffice-ia.md`) but does not design the model. The Vite + React migration strategy (incremental vs. parallel) remains open and is a Phase 12 work-package decision; nothing in this operating model depends on which is chosen, because the design is framework-independent.
