# WP-05 — Event delivery semantics

**Priority** P0 · **Severity** event reliability · **Capability** async correctness · **Contexts** messaging, worker · **Tranche** 1

## Why

**G-11.** `once()` calls `markProcessed` **before** invoking the handler (`apps/worker/src/main.ts:95-99`), and `markProcessed` inserts-and-commits independently (`packages/db/src/repositories.ts:798-806`). **A handler that throws leaves the event marked processed, permanently suppressing redelivery** — at-most-once, while the module docstring (`:35`) and every design document claim at-least-once.

**Affects all four consumers.** Anything built on delivery guarantees before this is fixed silently drops work.

**G-28, and the Phase 11 lesson made concrete.** `EVENT_TYPES` (`packages/core/src/events.ts:28-62`) has 24 members and is **referenced nowhere functionally** — all emission uses raw string literals at **7 sites**: `commerce.module.ts:283,385`, `admin.module.ts:220,258,295`, `worker/main.ts:179,344`. **18 of 24 constants are dead.** A typo'd topic is not type-checked. Enumerate the emission sites, not the registry.

## Scope

**Included:** correct the processed-event lifecycle so a failed handler is redelivered — mark processed in the **same transaction** as the handler's effect, or only on success; define retry with backoff and dead-letter behaviour; assert consumer idempotency; decide the fate of `EVENT_TYPES` (**remove, generate, or make emission type-safe** — do not preserve a decorative registry); `purgeOlderThan` has no caller (G-52), leaving the dedupe table unbounded.

**Excluded:** notification emitters/adapters (WP-15); reconciliation matching (WP-25).

## Architecture

**Messaging/worker only.** The outbox relay is already *"the only publisher in the system"* (`worker/main.ts:64`) — **preserve that**; it is what makes later service extraction possible. Changing the processed-event boundary must not weaken it.

## Migration

`processedEvents` rows written under the old semantics may mark events that never succeeded. **Decide explicitly:** purge unverified rows, or accept that pre-existing failures stay suppressed. Not a silent choice.

## Tests

- **Handler throws → event is redelivered** (the defining test; none exists)
- Handler succeeds → not redelivered
- Redelivery after transient failure reaches success
- Poison message → dead-letter, not infinite retry
- Each of the **4 consumers** asserted idempotent under duplicate delivery
- **`apps/worker` has no test infrastructure** — this package must create it

## Acceptance criteria

1. A throwing handler is redelivered; a succeeding one is not.
2. Delivery semantics match the documentation, whichever way that is resolved.
3. Every consumer is idempotent under duplicate delivery.
4. Emission is type-safe or the decorative registry is removed — not left as-is.
5. Dedupe table growth is bounded.

## Dependencies

**Prerequisites:** none. **Dependents:** **WP-15 (hard)**, WP-25.

## Risk

**Operational.** Changing delivery semantics can turn silent drops into visible retries — which is the point, but it may surface latent handler bugs. Mitigate by landing consumer idempotency tests first.

## Context contract

Read: `apps/worker/src/main.ts:30-120,220-240,375-395`, `packages/db/src/repositories.ts:790-815`, `packages/messaging/src/topology.ts`, `packages/core/src/events.ts`, `docs/program/journey-capability-traceability.md` §5.
