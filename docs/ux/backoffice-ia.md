# Backoffice — Information Architecture

> Phase 6 of `docs/program/MASTER-PROMPT.md`. Discovery/design only — no implementation. Companion to `docs/ux/backoffice-operating-model.md` (operating principle, operator reconciliation, workflow inventory, findings F1–F8).
>
> Target stack: **Vite + React** (superseding decision, MASTER-PROMPT §6). Reflected here as constraints on the design, not as implementation.

## Current inventory (verified)

`apps/admin/` — Next.js today, three nav entries (`layout.tsx:17-19`), four pages:

| Route | Screen | Operating area | Actor |
|---|---|---|---|
| `/` | Exception queue ("Needs a decision") | exception triage | I2/I3 |
| `/orders/` | Order search | lookup | I2, support-by-proxy |
| `/order/?id=` | Order detail + procurement copilot + commands | triage, procurement | I2 |
| `/finance/` | Ledger + balances | finance | I4 |

API surface (`apps/api/src/modules/admin.module.ts`): 10 endpoints — `exceptions`, `orders`, `orders/:id`, `procurements/:id/copilot`, `procurements/:id/confirm`, `orders/:id/transition`, `orders/:id/reprice`, `finance/ledger`, `finance/balances`, `providers`.

**Note the asymmetry:** `providers` is implemented, exposed, and present in the admin API client — with no screen. Integration health is the cheapest missing screen in the entire back office.

## IA principles

1. **The queue is the home screen.** Not a dashboard of charts. Opening the back office means seeing what needs a human, ranked. (`CLAUDE.md` RULE.)
2. **Workflows are commands, not forms.** A screen offers *actions with intent* ("resolve price breach"), never a generic field editor. Structurally true today — preserve it (operating model §"Resource management vs. operational workflows").
3. **Resource CRUD only for reference data** with no state machine and no financial effect.
4. **Desktop-first, information-dense.** The inverse of the front office. Operators use large screens, keyboard, and repetition; density and shortcuts beat whitespace.
5. **Every destructive or money-touching action is confirmed, authorized, audited, and version-checked** (`If-Match`, finding F7).
6. **English UI.** Customer-facing strings are Persian (`CLAUDE.md`); the back office is already English (`apps/admin`). Operator-facing *content* (customer names, addresses) is Persian and needs correct bidi isolation inside an LTR shell — the mirror of the front office's problem.
7. **Sandbox rows are visible but never silently mixed** — `sandbox` defaults to `exclude` in order search; any screen showing sandbox data must label it.

## Target route inventory

**E** exists · **X** extend · **N** new. Priority: **P0** blocks a working operating model · **P1** required for MVP operations · **P2** post-MVP.

### Operational workflows (task-oriented)

| Route | Screen | Area | Actor | Status | Pri |
|---|---|---|---|---|---|
| `/` | Exception queue — ranked, filterable, assignable | triage | I2/I3 | **X** | P0 |
| `/orders` | Order search | lookup | I2/I1/I4 | **E** | — |
| `/orders/:id` | Order detail: timeline, commands, procurement copilot | triage, procurement | I2 | **X** | P0 |
| `/procurements/:id` | Procurement copilot + confirm (own route, not nested in order) | procurement | I2 | **X** | P1 |
| `/shipments` | Leg-level view; carrier-status mapping gaps | logistics | I3 | **N** | P2 |
| `/reconciliation` | Unmatched ledger ↔ settlement queue | reconciliation | I4 | **N** | P1 |
| `/support` | Case queue | support | I1 | **N** | P1 |
| `/support/:id` | Case detail with order + ledger context | support | I1 | **N** | P1 |
| `/compliance` | Flagged-order review queue | compliance | I5 | **N** | P2 |
| `/sandbox` | Scenario list, session control, virtual clock | sandbox ops | I2 | **N** | P2 |

### Resource management (reference data)

| Route | Screen | Actor | Status | Pri | CRUD shape |
|---|---|---|---|---|---|
| `/customers` | Customer list/detail (read-mostly) | I1/I2 | **N** | P1 | list, detail — **no delete** (orders reference them) |
| `/providers` | Integration health | I2/I6 | **N** *(API exists)* | P1 | list only; control actions are commands, not edits |
| `/config/rate-cards` | Economic configuration | I6/finance | **N** | P2 | full CRUD + **versioning** — see below |
| `/config/routes` | Routes, service zones, warehouses | I6 | **N** | P2 | full CRUD, archive not delete |
| `/config/marketplaces` | Marketplace enable/disable, capabilities | I6 | **N** | P2 | update only (descriptors are code today) |
| `/admin/users` | Internal users | I6 | **N** | P1 | list, create, update, **deactivate not delete** |
| `/admin/roles` | Roles/permissions | I6 | **N** | P1 | blocked on Phase 7 |
| `/audit` | Audit log | I6/I5 | **N** | P1 | list + filter, **append-only, never editable** |

**Rate cards are not ordinary CRUD.** They determine landed cost on live quotes. Editing one in place would retroactively change the basis of quotes already given. They need **versioned, effective-dated records with an activation command** — closer to a workflow than a resource, and the clearest example of why "generate CRUD from tables" is the wrong instinct. Flagged for Phase 10.

**Organizations** (`/organizations`) are deliberately absent: Line B/C are platform-later, and an empty org surface implies a capability that doesn't exist (same reasoning as the front office's business surfaces).

## Capability matrix

Per MASTER-PROMPT §PHASE 6, "where domain-appropriate" — the qualifier is doing real work here, and each omission below is a decision with a reason.

| Screen | List | Detail | Create | Update | Archive | Bulk | Filter | Search | Paginate | Audit |
|---|---|---|---|---|---|---|---|---|---|---|
| Exception queue | E | via order | — | — | **resolve (N)** | **N** | E (`type`) | **N** | E (cursor) | **N** |
| Order search | E | E | — ¹ | — ¹ | — ¹ | **N** | E (rich) | E | E (offset) | X ² |
| Order detail | — | E | — ¹ | — ¹ | — ¹ | — | — | — | — | X ² |
| Procurement | — | E | — ¹ | — ¹ | — | — | — | — | — | X ² |
| Reconciliation | **N** | **N** | — | — | **N** ³ | **N** | **N** | **N** | **N** | **N** |
| Support cases | **N** | **N** | **N** | **N** ⁴ | **N** | **N** | **N** | **N** | **N** | **N** |
| Compliance | **N** | **N** | — | — | **N** ³ | **N** | **N** | — | **N** | **N** |
| Customers | **N** | **N** | — ⁵ | **N** | — ⁶ | — | **N** | **N** | **N** | **N** |
| Providers | **N** | **N** | — ⁷ | — ⁷ | — | — | — | — | — | — |
| Config (all) | **N** | **N** | **N** | **N** | **N** | — | **N** | **N** | **N** | **N** |
| Internal users | **N** | **N** | **N** | **N** | **N** ⁸ | — | **N** | **N** | **N** | **N** |
| Audit log | **N** | **N** | — ⁹ | — ⁹ | — ⁹ | — | **N** | **N** | **N** | — |

¹ **Deliberately absent.** Orders and procurements are state machines. Every mutation is a command (`transition`, `reprice`, `confirm`), never create/update/archive. Adding CRUD here would let an operator bypass `TRANSITIONS` — the exact failure `CLAUDE.md` forbids.
² Audit exists in the domain (immutable timeline, every transition appended) but is not *surfaced* as an operator-visible history panel.
³ Resolution is a command (clear / flag / escalate), not an archive.
⁴ Case update = reply/resolve/reopen commands, not field edits.
⁵ Customers self-register; operators do not create them.
⁶ Deleting a customer with orders is domain-unsafe. Deactivation only, if ever.
⁷ Provider *health* is derived state and never editable. Manual quarantine / force-close / priority override are **commands** — see below.
⁸ Deactivate, never delete: audit records must keep referencing the actor.
⁹ Append-only by definition. A mutable audit log is not an audit log.

**Bulk actions are `N` everywhere and that is a genuine gap**, not a deliberate omission: at real volume, "resolve these twelve stale shipment exceptions" is a routine operator need. Bulk must still execute as N individual domain commands with per-item results (partial success is normal), never as a batch mutation that bypasses per-item validation.

## Operator action → domain capability

Every action, mapped to the capability that serves it. **This is the criterion "every operator action maps to an explicit application/domain capability or a documented missing capability."**

| Operator action | Domain/application capability | Status |
|---|---|---|
| View ranked exception queue | `OpsService.listExceptions` → `ExceptionRepository.listOpen` | ✅ wired |
| Rank the queue meaningfully | `updateRanks()` | ⚠️ **exists, never called** (F4) |
| Assign / reassign an exception | *none* — `assignee` column is written by nothing | ❌ **missing command** (F3) |
| Resolve an exception without changing order state | `OpsService.resolveException` | ⚠️ **exists, unreachable** (F2) |
| Bulk-resolve exceptions | *none* | ❌ missing |
| Search orders | `OpsService.searchOrders` | ✅ wired (F8) |
| Open one order | `OpsService.getOrder` (accepts id or `XB-` public ref) | ✅ wired |
| Advance / correct order state | `OpsService.transition` (gated by `TRANSITIONS`, `If-Match`) | ✅ wired |
| Raise the procurement ceiling | `OpsService.reprice` (`If-Match`) | ✅ wired |
| See live procurement context | `OpsService.copilot` (recomputes live price) | ✅ wired |
| Record a completed purchase | `OpsService.confirmProcurement` | ✅ wired |
| Retry a failed procurement | `transition` → `PROCUREMENT_FAILED → PROCUREMENT_PENDING` | ✅ via state machine |
| Issue a refund | `transition` → `REFUND_PENDING`; execution unwired | ⚠️ **partial** — port method has no callers |
| Read the ledger | `FinanceService.ledger` | ✅ wired (role-gated, F1) |
| See account balances | `FinanceService.balances` | ✅ wired |
| Reconcile a settlement | *none* — table exists, no service | ❌ missing |
| Open/answer/resolve a support case | *none* | ❌ missing |
| Review a compliance flag | *none* | ❌ missing |
| See provider health | `breakerRegistry.snapshot()` via `GET /providers` | ✅ wired, no screen |
| Quarantine / force-close a provider | *none* | ❌ missing command |
| Add a carrier-status mapping | *none* — `normalizeCarrierStatus` logs unknowns for a human | ❌ missing |
| Edit rate cards / routes / warehouses | *none* | ❌ missing |
| Manage internal users and roles | *none* | ❌ missing (Phase 7) |
| View an audit trail | timeline is persisted; no read surface | ⚠️ **data exists, no surface** |
| Run/inspect a sandbox scenario | sandbox API exists; consumed only by the **front** office | ⚠️ exists, no operator surface |

**Summary: 11 wired, 6 partial-or-orphaned, 9 missing.** The partials matter most — each is a capability already paid for that no operator can use.

## Per-screen state specification

Operator screens need the same state discipline as customer screens, with different emphasis: an operator hits empty states constantly (a cleared queue is *success*), works through outages rather than around them, and must never be left unsure whether a command took effect.

### Exception queue `/` — J10
| State | Behaviour |
|---|---|
| Loading | Skeleton rows; never a blocking spinner on the home screen |
| Empty | **"Queue clear" — framed as achievement, not absence.** The one empty state in the product that is good news |
| Populated | Ranked; `marginAtRisk`, `ageMinutes`, type, assignee, summary per row |
| Filter | By `type` (exists); by state, age band, assignee (**N**) |
| Search | **N** — no free-text search over exceptions |
| Paginate | Cursor-based (exists) |
| Assign / claim | **N** — no command (F3). Until it exists, two operators can collide silently |
| Resolve without transition | **N** — capability exists but is unreachable (F2) |
| Bulk resolve | **N**; must execute as N commands with per-item results |
| Stale rank | Rank is static (F4) — until `updateRanks` runs, do not present the order as risk-ranked when it is insertion-ordered. **Showing a false ranking is worse than showing none** |
| Outage | Queue fetch fails → keep last-known list with a "couldn't refresh" notice; never blank the primary surface |
| Permission denial | Non-`ops`/`admin` blocked at the route |
| Terminal | Item leaves the queue on resolution — with the resolving action named in its audit trail |

### Order detail `/orders/:id` — J11
| State | Behaviour |
|---|---|
| Commands | Only legal `TRANSITIONS` edges offered. **The UI must not present illegal targets and rely on the backend to reject them** |
| Validation | Reason required on `transition` and `reprice` (both schemas mandate it) |
| Concurrency | `If-Match` version conflict → "someone else changed this," reload and re-decide. **Not an error state** (F7) |
| Confirmation | Every command confirms, showing the resulting state before commit |
| Recovery | No undo by design — only a further legal forward transition |
| Audit | Immutable timeline is persisted; needs a visible history panel (currently no read surface) |

### Reconciliation `/reconciliation` — J13 (all **N**)
| State | Behaviour |
|---|---|
| Loading | Paginated; ledger volume makes this mandatory, not optional |
| Empty | Fully reconciled period → positive terminal framing |
| **Missing data** | **Timing lag vs. genuine discrepancy must be visually distinct** — one generic "unmatched" bucket would make the screen useless, since most unmatched rows at any moment are simply early |
| Validation | `Money` invariants throughout; currency mismatch throws rather than coerces |
| Outage | Settlement feed delayed/down → say so; do not present a stale reconciliation as complete |
| Retry | Re-run matching after a feed catches up |
| Recovery | Manual match override — **itself an audited action**, same auditability as automated matching |
| Async | Feeds arrive on their own schedule; show last-feed time |
| Notification | Discrepancy above threshold should alert I4 (blocked on notification system) |
| Permission | `ledger:read` + `reconciliation:resolve`; sensitive surface |
| Terminal | Matched · flagged-and-resolved · flagged-and-escalated |

### Access administration `/admin/users`, `/admin/roles` — J15 (all **N**, blocked on Phase 7)
| State | Behaviour |
|---|---|
| Validation | **Cannot remove the last admin** — lockout prevention is a hard precondition |
| Permission | Admin-only; the surface is subject to the model it manages |
| Recovery | Revocation takes effect at the next authorization check — **permission checks must not be cached**, a specific constraint given cache-aside is the platform default elsewhere |
| Cancellation | Discard pending grant before commit |
| Audit | Every grant/revoke recorded with actor, target, and time |
| Terminal | Assignment active, with audit trail |
| Deactivation | Deactivate, never delete — audit references must stay resolvable |

### Support case detail `/support/:id` — J12 (all **N**)
Queue mirrors the exception-queue pattern. Case detail joins order + ledger context. Refund is a **command** reusing `X → REFUND_PENDING → REFUNDED`, never a parallel money path, and needs its own permission distinct from case access. Reopen path required — a disputed resolution must not become a new case.

## RBAC requirements for Phase 7

Concrete requirements this phase surfaced. Phase 7 owns the model; these are its inputs.

1. **Roles must not be a single string.** `actor.role: string` with `required.includes(actor.role)` cannot express "finance + read-only order context," which is F1's blocker and a real operator's real job.
2. **Method-level roles override class-level** (`getAllAndOverride`). Correct behaviour, but it means the *effective* permission of an endpoint isn't visible from the controller annotation alone. Any permission model must be inspectable — ideally enumerable per route for the audit surface.
3. **Permissions to model** (from the areas above): `exception:{read,assign,resolve}`, `order:{read,transition,reprice}`, `procurement:{read,confirm}`, `ledger:read`, `reconciliation:{read,resolve}`, `support:{read,respond,refund}`, `compliance:{read,clear,escalate}`, `provider:{read,control}`, `config:{read,write,activate}`, `user:{read,manage}`, `audit:read`, `sandbox:operate`.
4. **Separate `logistics` from `ops`** (F5) — currently any `ops` operator can reprice, a commercial decision.
5. **Refund authority is its own permission**, distinct from support access — the money-moving action within a support workflow needs a separate grant and likely an approval threshold.
6. **Backend authorization stays authoritative.** The Vite admin consumes permissions to shape UI; hiding a nav item is never the control (MASTER-PROMPT §PHASE 7).
7. **Deactivate, never delete, internal users** — audit references must stay resolvable.
8. **Bootstrap:** the first admin, and prevention of last-admin lockout.

## Vite + React implications

The target stack shapes the design in three ways worth recording now, though implementation is Phase 12:

- **No static-export constraint.** Unlike the front office (`output: 'export'`, which forces client-side routing for `/orders/<id>`), a Vite SPA routes dynamic segments natively. `/orders/:id`, `/support/:id`, `/procurements/:id` are ordinary routes.
- **Client-side data layer.** No SSR, so the app is a pure API consumer against `/v1/admin/*` — which suits an authenticated, desktop, session-bound tool.
- **The generated API client is the migration seam.** `apps/admin/lib/api.ts` already wraps every call and handles `If-Match`; keeping that boundary intact means the migration replaces the view layer without touching the contract. This is what makes an incremental migration viable, and is the strongest argument for it over a parallel rewrite.

## Feeds

Phase 7 (RBAC — the requirements above), Phase 8 (design system — operator-density primitives: data table, queue row, command bar, confirm dialog, timeline, audit panel, provider-health badge), Phase 9 (sandbox — operator-facing scenario control), Phase 10 (missing APIs: resolve/assign exception, bulk commands, reconciliation, support, compliance, provider control, config with rate-card versioning, audit read), Phase 11 (traceability), Phase 12 (work packages; the exception-queue completion — F2/F3/F4 — is the highest-value operator package, since it restores the surface the whole operating model rests on).
