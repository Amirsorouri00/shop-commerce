# WP-11 — Manual product resolution: end-to-end operator recovery

**Priority** P0 · **Severity** missing application boundary · **Capability** resolution recovery · **Contexts** Resolution, Order, backoffice · **Tranche** 3

## Why

**G-10, and it is one capability, not three tasks.** The Phase 11 vertical trace enumerated **13 links; 1 implemented, 1 orphaned, 3 design-target, 8 missing.** Splitting this into "add endpoint" / "add screen" / "add domain" would deliver a queue nobody can act on, which is the failure mode this program exists to prevent.

Verified state:
- `ManualResolutionStrategy` exists (`packages/commerce/src/strategies.ts:371-395`) and requires `ctx.manualOverrides`
- **It is never registered.** `buildStoreStrategies` (`adapters.ts:280-305`) pushes only `StubStoreStrategy`; the commented cases name api/structured/vision and **omit manual entirely**
- `manualOverrides` has exactly two references: its declaration and its consumer — **nothing produces it**
- `NEEDS_REVIEW` appears nowhere in `apps/api/src`
- **G-12** — in production `buildStoreStrategies` registers **nothing at all** (`:288-295` refuses the stub), so the ladder is empty

A customer-facing surface *does* exist (`apps/web/app/page.tsx:138`, Persian "some info is uncertain" banner) — corrected from an earlier claim that it did not.

## Scope — the complete vertical

```
customer request → automated resolver → NEEDS_REVIEW
  → operator queue → review workspace → trusted override submission
  → application command → resolution resumes → quote or explicit rejection
  → customer-visible state → notification → audit → sandbox scenario → tests
```

**Included:** register the manual tier and real strategies; `ResolutionReview` entity; `SubmitResolutionReview` command; `POST /v1/admin/resolutions/:id/actions/submit-review`; `GET /v1/admin/resolutions?status=needs-review`; the operator workspace using Phase 8's context-preserving pattern; customer-visible outcome; audit; sandbox `RES-03` completing the loop.

**Excluded:** real marketplace adapters (WP-23) — sandbox and stub strategies suffice to prove the loop.

## Domain decision — recorded, not re-litigated

**`ResolutionReview` entity + resume the pipeline**, rejecting two alternatives: a controller calling the strategy directly (the exact fragmentation this program forbids), and a bare pipeline re-run with overrides (loses *who* corrected *what*, which is audit-critical for a value that determines landed cost).

The operator's correction is **itself a durable fact** with an author, timestamp, and confidence of 1.0 that outranks every automated tier. Modelling it only as pipeline input keeps the effect and discards the fact. The existing merge semantics are preserved — an override wins because its confidence is 1.0, not because a special path forces it.

## Architecture

Domain: `ResolutionReview`. Application: the command, with validation, idempotency (`Idempotency-Key`), and `If-Match` concurrency — two operators reviewing the same item is a **409, not a silent overwrite**. Persistence: review table. API: command + query routes. Frontend: operator workspace, successive review items without full-page navigation. Sandbox: `RES-03` stops at review **until this ships**, then completes.

## Tests

Full vertical: review → override → resume → quote **or** reject → terminal. Two operators → 409. Resubmission idempotent. Rejection reaches a **terminal** state (requires WP-04). Sandbox `RES-03` completes.

## Acceptance criteria

1. An operator can complete a stuck resolution end-to-end and a customer sees the outcome.
2. Rejection reaches a terminal state — **no wedge**.
3. The override is attributed and audited.
4. Production registers at least one resolution strategy.

## Dependencies

**Prerequisites:** **WP-04 (hard — a review workflow on a lifecycle with no rejection terminal produces a queue that fills and never drains)**, WP-06, WP-10. **Dependents:** WP-23.

## Context contract

Read: `packages/commerce/src/{strategies.ts:360-400,resolution.ts,types.ts}`, `apps/api/src/composition/adapters.ts:270-310`, `apps/web/app/page.tsx:130-150`, `docs/architecture/backend-domain-api-reconciliation.md` §1, `docs/design/interaction-architecture.md` §3, `docs/program/journey-capability-traceability.md` §6.
