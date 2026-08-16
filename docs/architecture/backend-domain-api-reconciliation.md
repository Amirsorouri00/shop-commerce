# Backend, Domain and API Reconciliation

> Phase 10 of `docs/program/MASTER-PROMPT.md`. Reconciles journeys → use cases → domain → authorization → API → persistence → events → ports → sandbox into one coherent backend architecture. **Architecture only.** Companions: `verified-defect-register.md` (evidence), `state-machine-reconciliation.md`, `api-design-standards.md`, `sandbox-isolation-backend.md`.

## 1. Manual product resolution — the complete use case

**Verified state:** `ManualResolutionStrategy` exists (`packages/commerce/src/strategies.ts:371-395`), requires `ctx.manualOverrides`, and **is never registered** — `buildStoreStrategies` (`apps/api/src/composition/adapters.ts:280-305`) pushes only `StubStoreStrategy`; the commented cases name api/structured/vision and **omit manual entirely**. `manualOverrides` has exactly two references: its declaration and its consumer. `NEEDS_REVIEW` appears nowhere in `apps/api/src`.

So the gap is deeper than "no producer": the tier is not in the pipeline, the order lifecycle has no review state (P0-DOMAIN-002), and no application boundary exists.

### Domain decision: a `ResolutionReview` entity, not a pipeline re-run

Three models were considered:

| Model | Verdict |
|---|---|
| Controller calls `ManualResolutionStrategy` directly | **Rejected** — exactly the "missing button → add endpoint → endpoint writes DB" fragmentation this program exists to eliminate |
| Re-run the pipeline with trusted overrides | **Rejected as the whole answer** — it loses *who* corrected *what*, which is audit-critical for a value that determines landed cost. It also re-invokes paid tiers for fields already answered |
| **`ResolutionReview` entity + resume the pipeline with the manual tier registered** | **Chosen** |

**Chosen model, and why by domain semantics rather than convenience:** the operator's correction is *itself a durable fact* — it has an author, a timestamp, a set of field-level values, and a confidence of 1.0 that outranks every automated tier. Modelling it only as a pipeline input discards the fact and keeps only its effect. A `ResolutionReview` records the human judgement; the pipeline then resumes with the manual tier able to read it.

This also preserves the existing merge semantics (highest-confidence-per-field wins, `resolution.ts:233-250`) rather than bypassing them — an operator override wins because its confidence is 1.0, not because a special code path forced it.

### Use case

```
Operator opens the review queue        query: reviews awaiting action
  ↓
Reads the product request              provenance, missingFields, tiers tried
  ↓
Submits corrected/confirmed values     command: SubmitResolutionReview
  ↓
Application validates                  field schema + eligibility + authorization
  ↓
Persists ResolutionReview              author, values, timestamp, correlation
  ↓
Resumes resolution                     manual tier reads the review
  ↓
Outcome                                RESOLVED → quote possible
                                       REJECTED → RESOLUTION_FAILED (terminal)
  ↓
Timeline + audit record                actor, before/after, reason
```

### Specification

| Aspect | Decision |
|---|---|
| **Command** | `SubmitResolutionReview { productRequestId, fields, decision: 'complete' \| 'reject', reason, expectedVersion }` |
| **API** | `POST /v1/admin/resolutions/:id/actions/submit-review` (command category) |
| **Query** | `GET /v1/admin/resolutions?status=needs-review` — cursor-paginated, per `api-design-standards.md` §6 |
| **Permission** | `resolution:read` to view, `resolution:complete` to submit (Phase 7 vocabulary) |
| **Idempotency** | `Idempotency-Key` required — a resubmitted review must not create a second review or re-resolve |
| **Concurrency** | `If-Match` on the request version; two operators reviewing the same item is a **409**, not a silent overwrite |
| **Audit** | actor, permission, field-level before/after, reason, correlation id — mandatory (Phase 7 §13) |
| **Errors** | `422` for invalid field values; `409` version conflict; `403`/`404` per disclosure rule |
| **Transitions** | `RESOLUTION_REVIEW → QUOTED` on complete; `→ RESOLUTION_FAILED` on reject (both new, per `state-machine-reconciliation.md` §D2) |
| **Sandbox** | `RES-03` must continue to **stop at review** until this ships. Once shipped, the scenario exercises the full loop |
| **Customer-visible** | "a specialist is checking this" while in review; on rejection, a specific reason — never a generic failure |

**Dependency:** this cannot ship before `RESOLUTION_REVIEW` and `RESOLUTION_FAILED` exist (Chain B, steps 1–2). Wiring a review UI against a lifecycle with no failure terminal produces a queue that fills and never drains.

## 2. Exception work management

**Verified state:** `assignee` is a column (`schema.ts:434`), read into the DTO (`admin.module.ts:90`), **written by nothing**. `resolveException` exists (`admin.module.ts:305-308`) with its definition as its sole reference. `updateRanks` (`repositories.ts:656`) is never called.

**These are three separate gaps with one shape: application logic built to the controller boundary and stopped.**

### MVP scope decision

Not every candidate command belongs in MVP. Applying the test *"does the operator loop break without it?"*:

| Command | MVP? | Reasoning |
|---|---|---|
| **Claim** (self-assign) | **yes** | Without it two operators collide silently — the concurrency problem is real at any volume above one operator |
| **Resolve** (without state change) | **yes** | Without it a benign exception has no exit and the queue degrades permanently |
| Release assignment | yes | Trivial once claim exists; without it a claim is a leak |
| Add operator note | yes | Cheap, and the audit trail is otherwise silent on judgement calls |
| Assign to another operator | **no** | Requires a team model that does not exist. Claim covers MVP |
| Reprioritize | **no** | Ranking does not run at all (`updateRanks` uncalled); manual override of an absent ranking is meaningless |
| Escalate | **no** | No escalation target exists — no support, no compliance surface |
| Reopen | **no** | Follows resolve; defer until resolve has usage evidence |

**Ranking:** `updateRanks` has no caller because nothing computes ranks. Until a ranking policy exists, **the queue must not present itself as risk-ranked** (Phase 8) — the honest interim is explicit sort by age or margin-at-risk, both of which are already computed per item.

### Concurrency

Two operators acting on one queue item is the expected case, not an edge case.

- **Claim uses compare-and-set** on `assignee`: claiming an already-claimed exception returns **409 with the current holder**, never a silent overwrite.
- **Resolve requires `If-Match`** on the exception version.
- **Resolution is idempotent** — resolving an already-resolved exception returns the original outcome, not an error.

**Not a generic `PATCH /exceptions/:id`.** Each is a command with its own precondition, authorization, and audit record.

## 3. Notification architecture — what is actually missing

**Verified, correcting Phases 3 and 9:** a consumer **exists** (`apps/worker/src/main.ts:224-231`), bound to `order.*`/`payment.*`/`exception.*` via `QUEUES.notification`, deduped by event id, and writes a log line. `NotificationRequested` (`packages/core/src/events.ts:61`) appears **nowhere else**.

| Element | Status |
|---|---|
| Queue + topology | **exists** |
| Consumer + dedupe | **exists** (logs only) |
| Event constant | exists, **unused** |
| **Event emission** | **missing** — nothing publishes it |
| **`NotificationPort` adapter** | **missing** — no implementation |
| **Delivery persistence** | missing |
| Customer preferences | missing |
| Retry/status tracking | missing (dedupe exists; retry does not) |
| Read API | missing |

**Design only the missing parts.** The dedupe-by-event-id behaviour is exactly right and must be preserved — it is what makes "one state change sends exactly one message" true under redelivery. **Do not rewrite this subsystem**; the earlier claim that it did not exist was wrong, and rebuilding would discard working idempotency.

**Ordering:** emission and a capture adapter first (Phase 9's sandbox inbox gives the port its first implementation), then persistence, then preferences and retry.

## 4. Reconciliation

**Verified:** `reconciliationItems` table exists (`schema.ts:400`); a queue consumer exists (`worker/main.ts:233-237`) that calls only `logger.debug`. **No matching algorithm exists.** This resolves the Phase 0/6 "unconfirmed" item as **absent**.

Design requirements, deferred to Phase 12 for implementation: matching inputs (ledger entries ↔ provider settlement records, keyed by provider ref); idempotent matching (re-running must not duplicate discrepancies); discrepancy creation as a domain event; operator investigation via read models (§6); resolution as a command with audit; **sandbox rows excluded structurally** (`sandbox-isolation-backend.md` §3).

**The ledger remains the single financial truth.** Reconciliation records *observations about* the ledger; it never becomes a second source of truth.

## 5. Refund architecture

**Verified:** nothing transitions to `REFUND_PENDING`; the payment port's `refund()` has no callers. The lifecycle is entirely unbuilt.

Preserved: the single path `X → REFUND_PENDING → REFUNDED`, with the ledger as the money record.

**Eligibility guards** (per `state-machine-reconciliation.md` §D3), enforced in the **domain**, not a controller:
- a **settled** payment exists for the order;
- refundable amount > 0;
- no refund already completed or in flight;
- the provider supports refund (capability, not assumption).

**Full-order refund remains the MVP decision.** Partial refunds are not modelled and **must not arrive by accident through a generic `amount` parameter** — the refund command therefore takes **no amount**; the refundable sum is derived server-side. Introducing partial refunds is an explicit domain change, not a parameter.

## 6. Backoffice read models

Phase 6 established the operational workspace; Phase 8 established that selection must not refetch the queue. Both imply read models rather than N+1 detail calls.

**Where CQRS is justified** — complexity earns it, it is not applied uniformly:

| Surface | Model | Reasoning |
|---|---|---|
| Exception queue | **read model** | joins order, margin-at-risk, age, assignee, summary — already effectively one (`listExceptions`) |
| Order search | existing query | `adminOrderSearchQuery` is mature; keep |
| Order workspace detail | **composed query** | timeline + procurement + money + provenance in one response, since the workspace shows them together |
| Finance investigation | **read model** | ledger → payment → refund → order context in one query, under `ledger:read` + `order:read` **without mutation permissions** (Phase 7 F1) |
| Reconciliation | read model | |
| Config/reference | plain resource queries | no complexity to justify more |

**Constraint:** a composed response serves **one workspace's purpose**. Combining unrelated bounded contexts because a screen happens to show them is how a read model becomes a parallel source of truth.

## 7. Authorization enforcement layering

Phase 7 defined the model; Phase 10 places the enforcement.

```
Route guard        coarse permission — does the actor hold it at all?
      ↓
Application command  resource-scoped check with loaded context —
                     ownership, organization scope, sandbox session ownership
      ↓
Domain              invariants that are not authorization
                    (transition legality, refund eligibility)
```

**A route decorator cannot decide resource scope**, because scope depends on the loaded resource. This is also why the 403/404 disclosure rule (`api-design-standards.md` §5) lives at the application layer.

**Explicitly prevented:** cross-organization access (scope check post-load); wildcard expansion (no `x:*` in compositions — Phase 7); client-selected scope (scope derived from the actor, never a request parameter); **sandbox control without sandbox permission** (`sandbox:control:*` distinct from `sandbox:use`).

**ADR-001 preserved:** internal operators hold `PLATFORM`-scoped grants and are **not** members of an organization. No proposed API or table reintroduces an `INTERNAL_OPS` tenant.

## 8. Bulk operations

**No generic bulk mutation endpoints.** Per Phase 6, volume assumptions remain **unstated** — and that uncertainty is recorded rather than resolved by guessing.

The one candidate with a plausible MVP case is bulk exception resolve. Its specification, if built: per-item execution as N domain commands (never a batch mutation), per-item results with partial success as the normal outcome, one reason applied and audited per item, failures remaining selected for retry, and the same permission as single resolve.

**Flagged:** whether bulk is P1 or P0 cannot be decided without order-volume data that nobody has supplied.

## 9. Reconciliation matrix — Phase 3–9 findings into Phase 12

| Finding | Verified source | Root cause | Layer | Fix |
|---|---|---|---|---|
| Manual resolution unreachable | `strategies.ts:371-395`, `adapters.ts:280-305` | tier unregistered; no review lifecycle; no app boundary | domain + application + composition | §1 |
| `QUOTING` wedge | `order-state-machine.ts:17` | lifecycle modelled for success only | domain | SM §D2 |
| Unpaid refund path | `order-state-machine.ts:17,34` | `OUT_OF_STOCK` overloaded | domain | SM §D1, §D3 |
| Exception assign | `schema.ts:434` | column without command | application + API | §2 |
| Exception resolve | `admin.module.ts:305` | service without route | API | §2 |
| Ranking uncalled | `repositories.ts:656` | no ranking policy | application | §2 (deferred) |
| Finance blocked | `admin.module.ts:530,536` + `http.ts:253` | role coarseness | authorization | Phase 7 + §7 |
| Sandbox fails open | `env.ts:63-67` | flag never a gate | config | SB §7 |
| Unauth settlement | `sandbox.module.ts:188`, `commerce.module.ts:542` | missing `@Public()`; shortcut built around it | controller | SB §4 |
| Client sandbox tag | `commerce.module.ts:491-500` | trust boundary as transport detail | request context | SB §1 |
| Ledger contamination | `schema.ts` (1/22), `admin.module.ts:418` | tag never propagated | persistence | SB §3 |
| `verifyWebhook` unroutable | `sandbox-routing.ts:26` | synchronous member | composition | SB §4 |
| `sms`/`storage` unrouted | `adapters.ts:65-74` | ports added after routing | composition | SB §5 |
| Admin no sandbox | grep: 0 refs | never built | client + context | SB §6 |
| Notification gaps | `worker/main.ts:224-231`, `events.ts:61` | emitter + adapter absent | events + adapter | §3 |
| Reconciliation absent | `worker/main.ts:233-237` | consumer stub only | application | §4 |
| Refund unbuilt | grep: no transitions | never implemented | domain + application | §5 |
| `PAYMENT_FAILED` unreachable | grep | no failure path | application | SM §4 |
| `detectStalls` logs only | `worker/main.ts:380-386` | detection without action | worker | Phase 12 |
| Weight escalation defect | `strategies.ts:83-85` | 0.6 > floor 0.5 | domain | §10 below |
| 7 resolution fields | `types.ts:10-29` | model incomplete | domain | §10 below |
| `STATE_BADGES` 21/24 | `order-display.ts:10` | `Partial` type | frontend | Phase 12 |
| Money unit ambiguity | `api.ts:347-359` | field naming | contract | API §3 |

## 9a. Events, outbox and worker boundaries

**Verified architecture, and it is sound:** the outbox relay is *"the only publisher in the system"* (`apps/worker/src/main.ts:64`). Domain events are written to the outbox in the same transaction as the state change, then relayed. Consumers are idempotent by design; delivery is at-least-once (`:35`). **Preserve this — it is what makes later service extraction possible, and nothing in Phase 10 changes it.**

**Event inventory** (`packages/core/src/events.ts`) traced producer → consumer:

| Event | Producer | Consumer | Status |
|---|---|---|---|
| `order.paid` | `settlePayment` | worker `:121` | wired |
| `procurement.purchased` | procurement confirm | worker `:196` | wired |
| `exception.raised` | worker | notification queue | wired |
| `shipment.leg_updated` | carrier ingestion | worker | wired |
| `notification.requested` | **none** | worker `:224` (logs only) | **consumer without producer** |
| reconciliation events | **none** | worker `:234` (logs only) | **consumer without producer** |
| `product.resolved` / `product.resolution_failed` | resolution | **none** | **producer without consumer** |
| `payment.failed` | **none** | **none** | dead constant — nothing sets `PAYMENT_FAILED` |
| `exception.resolved` | **none** (`resolveException` unreachable) | **none** | dead |
| `fx.updated` | FX refresh | **none** | producer without consumer |

**Rule applied:** do not invent events to appear event-driven. `product.resolved` having no consumer is *fine* — it is an audit and future-extension seam. **`notification.requested` and the reconciliation events are different**: they have consumers waiting for messages nobody sends, which is a wiring gap, not a design choice.

**Worker boundaries.** Workers execute asynchronous application responsibilities; they must not become a second API layer. Verified compliant — consumers call application services rather than writing the database directly. **Requirement carried forward:** every command must record its origin (authenticated user / provider callback / scheduled job / event consumer / sandbox control), because the audit trail cannot otherwise distinguish an automated transition from an operator's. This is Phase 7's `system` principal, and it is not yet implemented.

## 9b. Persistence boundaries

**No repository or database model is exposed through an API.** Verified as currently true: responses are mapped through DTOs derived from `@xb/contracts` schemas.

Schema changes proposed by this phase, each with its context and impact:

| Change | Bounded context | Invariant supported | Migration | Rollback |
|---|---|---|---|---|
| Add `UNAVAILABLE`, `RESOLUTION_REVIEW`, `RESOLUTION_FAILED` states | Order | pre-payment lifecycle has terminal states | additive enum values; **no rows change** | safe |
| `sandboxSessionId` on ~8 further tables | cross-cutting | financial isolation | additive nullable column + index | safe; backfill is `NULL` = production |
| `ResolutionReview` entity | ProductRequest | human judgement is a durable fact | new table | safe |
| `version` column where `If-Match` is required | Order, Exception | optimistic concurrency | additive; default 0 | safe |
| `origin`/`actor` on audit records | cross-cutting | attribution | additive | safe |

**All additive.** No destructive migration is proposed, because every affected branch is unbuilt — which is precisely why this is the cheap moment.

**Not performed in this phase.** Phase 10 is architecture; the migrations belong to the Phase 12 packages that change behaviour.

## 9c. Support capability

**Verified scaffolding:** none. No support table, no service, no route — confirming Phase 3/6. `REFUND_PENDING`/`REFUNDED` exist as states and the payment port has `refund()`, but nothing connects them to a case.

MVP boundary: customer creates a case (optionally order-linked) and reads their own; operator reads the queue, responds, resolves; resolution may trigger a refund **through the same single refund path** (§5), never a parallel one.

**Permissions** are the explicit compositions from Phase 7 — `support:read`, `support:write` (customer, `SELF`); `support:read/respond/resolve` (operator). **`refund:issue` is deliberately excluded from the default support role**; the escalation path for a case requiring a refund remains an open Phase 12 decision, recorded rather than resolved.

**No resource wildcards.** Phase 7 found a `support:*` wildcard would have granted operator commands to customers; compositions enumerate explicitly.

## 9d. Contracts

Every public capability derives its contract from `@xb/contracts` Zod schemas — already the single source of truth for validation, generated types, and the frontend client.

Contracts must encode: **units** (`amountMinor` + explicit `unit`, per `api-design-standards.md` §3), enums, optionality (`null` = known-absent vs. omitted = not-applicable), validation, pagination shape, `availableActions`, and the error envelope.

**Contracts describe authoritative server results.** They must not become a second state machine or a second authorization engine — `availableActions` is a computed projection, and a client may never synthesize an action absent from it.

**OpenAPI is not currently generated.** Recorded as a gap: the Zod schemas could produce it, and a generated admin client would remove the hand-maintained seam noted in Phase 8. Not required for Phase 10's architecture, but it is the natural mechanism for keeping the two frontends honest and is a Phase 12 candidate.

## 10. Resolution model completion

**Seven missing fields** (Phase 4). Placement decided by whether pricing or eligibility depends on them:

| Field | Placement |
|---|---|
| `eligibility` / `restrictions` | **domain — required** before payment. An ineligible item that resolves, quotes, and is paid for fails at customs, which is the worst failure point in the product |
| `fulfillmentParty` | domain — feeds delivery risk |
| `selectableVariations` | **read model** — presentation, not pricing |
| `originalPrice` / `discount` | read model |
| `itemCondition` | domain — affects value and eligibility |
| `quantityRestrictions` | domain — affects procurement feasibility |
| `marketplaceEta` | read model |

**Catalogue weight vs. chargeable weight are distinct domain concepts, not one field with varying confidence.** Verified: `ApiResolutionStrategy` sets `weightKg` confidence to 0.6 with a comment claiming it is "deliberately below the escalation floor" — the floor is 0.5, so it never escalates, and catalogue weight (excluding packaging and dimensional weight) is used as though it were chargeable weight.

Modelling them as one field hides a systematic difference behind a confidence number. **Separate them**: `catalogueWeightKg` (what the marketplace states) and `chargeableWeightKg` (what freight bills). The API tier can be authoritative on the first and silent on the second, which is exactly what its comment was trying to express and could not.

## 11. Marketplace capability

Per the phase brief §11: **do not assume the old Product Advertising API contract remains available.** PA-API 5.0 was deprecated 2026-05-15 (Phase 4 finding) in favour of a narrower-access successor.

**Architecture already absorbs this correctly** and requires no change: `MarketplaceCapabilities` (`packages/commerce/src/marketplace.ts:28-39`) encodes `productApi`, `purchaseApi`, `structuredData`, `visionFallback`, `orderTracking` **as data**. If the API tier proves unobtainable, `productApi: false` is a one-line descriptor change and the ladder escalates to structured/vision/manual with no application-layer change.

**Do not embed Amazon-specific assumptions in the quote or application layer.** The capability matrix is the seam, and it already exists.

**Do not block on credentials.** The structured, vision, and manual paths are the architecture's answer to an unavailable API tier — which makes §1 (registering the manual tier) more urgent, not less.
