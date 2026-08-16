# API Design Standards

> Phase 10 of `docs/program/MASTER-PROMPT.md`. Conventions for one API platform rather than feature-by-feature improvisation. Existing conventions were read before being standardized — where the codebase already does something well, this document ratifies it rather than inventing an alternative.

## 1. API categories

Every endpoint declares one category. **Mixing categories in one route is the fragmentation this program exists to eliminate.**

| Category | Prefix | Auth | Example |
|---|---|---|---|
| **Resource query** | `/v1/...` (GET) | actor-scoped | `GET /v1/orders/:id` |
| **Resource administration** | `/v1/admin/...` | permission | `GET /v1/admin/config/rate-cards` |
| **Domain command** | `POST /v1/.../actions/:action` | permission + idempotency | `POST /v1/orders/:id/actions/accept-price-change` |
| **Provider callback** | `/v1/webhooks/:provider/...` | **signature only, `@Public()`** | `POST /v1/webhooks/payments/:provider` |
| **Sandbox control** | `/v1/sandbox/...` | sandbox permission | `POST /v1/sandbox/sessions/:id/advance` |
| **Internal worker/event** | not HTTP | system actor | outbox → queue → consumer |

**Verified precedent:** the codebase already separates these — `WebhookController` is its own controller (`commerce.module.ts:542`), and admin routes are namespaced under `v1/admin`. What is missing is the `@Public()` on the webhook controller (P0-SEC-002) and the command-route convention below.

## 2. Commands vs. resources

**Generic `PATCH`/`PUT` on domain aggregates is prohibited.** Verified: the API contains **no `PATCH` or `PUT` anywhere**, and exactly one `@Delete` (an ephemeral sandbox session). That is a structural property worth preserving explicitly rather than by accident.

**Command route shape:** `POST /v1/{resource}/{id}/actions/{action}`

- Action names are **business vocabulary** matching `availableActions` (`state-machine-reconciliation.md` §D4): `accept-price-change`, `retry-payment`, `assign`, `resolve`, `submit-review`, `issue-refund`.
- **Never** a target-state parameter. `POST /orders/:id/actions/transition {to: "PAID"}` is the anti-pattern — it makes the client the author of domain intent.
- The existing `POST /v1/admin/orders/:id/transition` and `/reprice` predate this convention. `reprice` already fits (a business verb); **`transition` does not** and should become specific operator commands. Recorded as a Phase 12 refactor, not a Phase 10 change.

**CRUD is permitted only for reference data** with no state machine and no financial effect — rate cards, routes, warehouses, internal users. Everything touching an order, procurement, payment, or ledger is a command.

## 3. Money serialization — the 10× guard

Verified canonical model: **IRR is stored and transmitted in rial**; `formatMoney` converts to toman at the display boundary (`apps/web/lib/api.ts:347-359`), with the reasoning that converting only at display "keeps every stored and transmitted figure in one unit." **This is correct and is preserved.**

**The risk is not the model; it is the field name.** `{"amount": 1234500, "currency": "IRR"}` is interpretable as toman by any client that has not read the docs, and the consequence is a 10× error in the most sensitive number in the product.

**Standard:**

```json
{ "amountMinor": 1234500, "currency": "IRR", "unit": "rial" }
```

- **`amountMinor`** replaces bare `amount` in new contracts — the name states the unit is the minor/canonical one.
- **`unit` is explicit** on every money object. Redundant with `currency` by convention, and that redundancy is the point: it makes a misread impossible rather than merely unlikely.
- **Toman never appears in an API payload.** It is a presentation unit only.
- Existing `{amount, currency}` payloads are **not migrated in this phase** — the change is contract-wide and belongs in a single Phase 12 package with the client updates, not scattered.

**Runtime guard:** a contract test asserting that a known quote total serializes as rial and renders as ÷10 with a toman label (Phase 9 `MON-01`). **Compile-time guard:** `Money` remains a value object; arithmetic across currencies throws. No safeguard is available against a client misreading a bare integer, which is why the field name carries the burden.

## 4. Errors

Extend the existing typed taxonomy (`@xb/core`, surfaced through one global exception filter into a single envelope — verified as an existing invariant in `CLAUDE.md` and honoured in the code).

| Class | HTTP | Notes |
|---|---|---|
| Validation | 400 | field-level, **bilingual fa/en** — existing behaviour |
| Authentication missing/invalid | 401 | |
| Authorization denied | **403 or 404** | see §5 |
| Not found | 404 | |
| Version conflict | 409 | `If-Match` mismatch — **a normal outcome, not an error condition** |
| Illegal transition | 409 | domain rejected the edge |
| Idempotency replay | **200 with the original result** | never an error |
| Business-rule violation | 422 | e.g. refund ineligible, viability gate |
| Provider unavailable | 503 | name the **capability**, not the vendor |
| Provider rejected | 402 / 422 | |
| External gate | 501 | capability designed, provider not contracted |
| Sandbox disabled | **404** | never reveal the surface |
| Sandbox session invalid | 400 | explicit — **fails closed**, never falls through to production |
| Financial invariant failure | 500 + alert | should be impossible; treat as a defect |

## 5. Disclosure — resolving 403 vs 404

Phase 7 left this as a rule; Phase 10 makes it decidable, because applying either mechanically is wrong.

**The test is what the actor may already know exists.**

| Situation | Response |
|---|---|
| Actor may see the resource, lacks the action | **403**, naming the missing permission |
| Actor may not see the resource at all | **404** |
| Resource is not the actor's (customer scope) | **404** — already correct in code (`commerce.module.ts:399`) |
| Route exists only in a disabled environment | **404** — matches `dev-gateway.module.ts:41-44`'s existing reasoning |
| Module the actor has no permission for | **404** |

**Requires loaded resource context**, so it cannot be decided by a route decorator alone (§ `backend-domain-api-reconciliation.md` on enforcement layering).

## 6. Conventions

**Naming:** plural resource collections (`/orders`, `/exceptions`); `kebab-case` actions; `camelCase` fields; `SCREAMING_SNAKE` enum values — all matching existing code.

**Pagination:** **cursor** for queues and append-heavy lists (existing: exceptions); **offset** where a total is genuinely needed (existing: `adminOrderSearchQuery` uses `limit`/`offset` with a total). Both are legitimate; the choice is per-endpoint and must be documented, not mixed within one endpoint.

**Filtering/sorting:** repeatable params for multi-value (`state=A&state=B` — existing); explicit `sort` enum, never a free-form field name. `adminOrderSearchQuery` (`schemas.ts:307-327`) is the reference implementation and should be the template.

**Validation:** Zod schemas in `@xb/contracts` are the single source of truth, parsed via `parseOrThrow` — existing, and specifically chosen so a bad sort key returns a bilingual 400 rather than a 500.

**Idempotency:** `Idempotency-Key` header, **required** on every command that moves money or calls a provider. Replay returns the original result with 200.

**Concurrency:** `If-Match` with an entity version, **required** on commands mutating a state machine. Already implemented on `transition` and `reprice`.

**Correlation:** `X-Correlation-Id` accepted and propagated; generated when absent. Existing via `@xb/observability`.

**Timestamps:** ISO-8601 UTC. **Sandbox responses additionally carry virtual time** where the domain used it, or timestamps silently lie.

**Nullability:** `null` means known-absent; field omission means not-applicable. **They are not interchangeable** — resolution provenance depends on the distinction (an absent field is unresolved; a null one is confirmed-absent).

## 7. Available actions payload

Per `state-machine-reconciliation.md` §D4, every resource whose UI offers commands returns `availableActions`. Contract:

```
availableActions: Array<{
  action: string          // business verb, matches the command route
  enabled: boolean        // actor authorization
  reason?: 'NOT_PERMITTED' | 'PRECONDITION_UNMET'
}>
```

**Contracts describe results; they do not become a second state machine.** `availableActions` is a server-computed projection, never a rule set the client evaluates. A client may not synthesize an action absent from the list, and the server re-checks on execution regardless — the payload is an affordance, not an authorization.
