# WP-03 — Server-authoritative sandbox provenance

**Priority** P0 · **Severity** security · **Capability** sandbox trust boundary · **Contexts** request context, Order, application commands · **Tranche** 1

## Why

**G-05, and it is exploitable today.** `createOrder` (`commerce.module.ts:491-500`) copies the client's `x-sandbox-session` header into `orders.sandboxSessionId` with **no validation** — no session-existence check, no ownership check, no authorization.

The exploit is live because **exclusion already exists**: `repositories.ts:249` applies `isNull(orders.sandboxSessionId)` and `adminOrderSearchQuery` **defaults to `exclude`** (`schemas.ts:323`). So an authenticated customer can set the header to any string and **their real order disappears from the operator's default search**.

**This is why WP-03 precedes WP-07.** Expanding exclusion to financial tables while the tag is client-settable would extend a concealment channel into reports and reconciliation — the mitigation would become the vulnerability.

## Scope

**Included:** request-scoped `SandboxContext` derived server-side (sandbox enabled → session loaded → exists, unexpired, belongs to the authenticated actor); **fail closed** — a request carrying an invalid header gets `400 sandbox session invalid`, never silent production fallthrough; `createOrder` stops reading `@Headers` entirely; the tag is written by infrastructure and is **immutable once set**; session gains `createdBy` (no owner field exists today, so ownership checks are impossible without it).

**Excluded:** tag propagation to other tables (WP-07); admin propagation (WP-22).

## Architecture

**Domain:** none — sandbox stays an infrastructure concern. **Application:** commands receive `SandboxContext` from resolved request context, never raw headers. **Persistence:** repositories never accept the tag from a caller. **Also fixes the routing fallthrough** (`sandbox-routing.ts:52-58`), where an expired or corrupt session silently reaches production adapters with production credentials.

**Preserved deliberately:** no application or domain service branches on sandbox state. The routing proxy resolves adapters below the service layer, and the source's reasoning is right — *"the moment a service branches on 'am I in a sandbox', the sandbox stops proving anything about the real path."* This package changes how context is **trusted**, not how it is consumed.

## Migration

Add `createdBy` to the session type (Redis-stored — no SQL migration). Existing sessions lack it: treat as unowned and reject, or drain on deploy. Rollback: revert.

## Tests

- Forged `x-sandbox-session` on order creation → **rejected**, order not tagged
- Expired session mid-journey → **fails closed**, never reaches production adapters
- Corrupt Redis payload → fails closed (current path returns `undefined` → production)
- Session belonging to another actor → rejected
- No client-controlled route can give a real order a sandbox tag

## Acceptance criteria

1. No client-supplied value can classify data as sandbox.
2. Invalid/expired/corrupt session → explicit error, never production fallthrough.
3. `orders.sandboxSessionId` is written only from validated server context.
4. The concealment channel is closed: a customer cannot hide an order from operator search.

## Dependencies

**Prerequisites:** WP-01. **Dependents:** **WP-07 (hard — must not precede this)**, WP-22.

## Risk

**Security-critical ordering.** If WP-07 ships first, the mitigation becomes the vulnerability.

## Context contract

Read: `apps/api/src/modules/commerce.module.ts:485-505`, `apps/api/src/composition/sandbox-routing.ts`, `packages/sandbox/src/{session.ts,redis-store.ts}`, `packages/db/src/repositories.ts:240-270`, `packages/contracts/src/schemas.ts:307-330`, `docs/architecture/sandbox-isolation-backend.md` §1-2.
