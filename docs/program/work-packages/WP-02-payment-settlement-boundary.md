# WP-02 — Payment settlement boundary

**Priority** P0 · **Severity** security + financial · **Capability** payment ingress · **Contexts** Payment, API, sandbox composition · **Tranche** 1

## Why

**Exactly three call sites** invoke `OrderService.settlePayment` — enumerated, not sampled:

| Route | Auth | Verification | Prod-gated |
|---|---|---|---|
| `POST /v1/webhooks/payments/:provider` (controller `:542`, handler `:549`, call `:564`) | **none — `@Public()` absent** despite its docstring claiming it (`:536-540`) | `verifyWebhook` → 401 | n/a |
| `POST /v1/sandbox/gateway/settle` (`sandbox.module.ts:188`) | none | **skipped** | **no** |
| `POST /v1/dev/gateway/settle` (`dev-gateway.module.ts:74`) | none | skipped | **yes** (correct pattern) |

**The verified path is unreachable and the unverified one is open.** Default-deny means the webhook requires a bearer token no gateway can supply, so in production the only functioning settlement ingress is unauthenticated. `StubPaymentAdapter.verifyWebhook()` also returns `true` unconditionally.

Related: **G-49** — `confirmProcurement` (`admin.module.ts:210`) and `settlePayment` (`commerce.module.ts:366`) post double-entry ledger lines with **no idempotency key**, while the admin client sends one that is ignored.

## Scope

**Included:** add `@Public()` to `WebhookController` so the verified path works as documented; **retire the sandbox settle route as a settlement path** — it becomes a control-plane action that makes the simulated gateway emit a callback into the *normal verified ingress*; make `verifyWebhook` routable so a sandbox verifier judges sandbox callbacks (currently synchronous, always production — `sandbox-routing.ts:27`); apply idempotency keys to ledger-posting commands; **amount verification** against the order total, which no route performs today.

**Excluded:** real gateway integration (WP-24); financial isolation (WP-07).

## Architecture

**Three surfaces kept distinct** — a control action may *cause* provider behaviour, never *substitute* for it:

| Surface | May mutate order state? |
|---|---|
| Sandbox control plane | **no — never directly** |
| Simulated provider callback | yes, **via normal verified ingress** |
| Business payment API | yes, via application service |

`verifyWebhook` becomes async so the routing proxy can resolve it. Idempotency middleware extends to admin money commands.

## Migration

Route behaviour change. Sandbox demos that call the settle route directly must move to the control-plane action — a **breaking change for existing demo scripts**, and the point of the package.

## Tests

- Webhook reachable **without** a bearer token; invalid signature → 401
- **All three settlement routes** asserted, enumerated
- Duplicate callback → single ledger entry, single transition
- Replayed callback → rejected
- Amount mismatch → rejected, order not marked paid
- Sandbox callback verified by the **sandbox** verifier
- `confirmProcurement` replay with same key → single ledger post

## Acceptance criteria

1. A real gateway can reach the verified webhook.
2. No route settles a payment without signature verification.
3. No settlement route bypasses `settleOnce`.
4. Sandbox settlement traverses the same ingress as production.
5. Ledger-posting commands are idempotent.

## Dependencies

**Prerequisites:** WP-01. **Dependents:** WP-14 (refund), WP-22, WP-24.

## Risk

**Financial.** Touches the money-movement path. Mitigation: the refund lifecycle is entirely unbuilt, so no existing behaviour depends on the paths being changed.

**One risk this package creates and does not close.** Routing sandbox settlement through the production `settlePayment` (`commerce.module.ts:339`) means sandbox callbacks post **double-entry ledger lines**, and `ledgerEntries` has no sandbox column until **WP-07**. So WP-02 *widens* G-06 before G-06 is fixed. Two acceptable mitigations, and the choice must be explicit: (a) sequence WP-07 immediately after WP-02 and keep sandbox settlement disabled in between, or (b) land WP-07's ledger tagging first. **Do not simply ship WP-02 and move on** — this is the same shape as the WP-03→WP-07 hazard, and it was missed in the first draft.

## Context contract

Read: `apps/api/src/modules/commerce.module.ts:280-400,520-570`, `sandbox.module.ts:150-205`, `dev-gateway.module.ts`, `apps/api/src/composition/{adapters.ts:100-145,sandbox-routing.ts}`, `docs/architecture/sandbox-isolation-backend.md` §4.
