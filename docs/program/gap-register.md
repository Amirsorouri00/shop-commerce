# Gap Register

> Phase 11 of `docs/program/MASTER-PROMPT.md`. Every gap classified by severity, type, dependency, and owning context. Evidence: `journey-capability-traceability.md`, `verified-defect-register.md`.
>
> **Severity reflects consequence, not implementation size.** Several P0s are one-line fixes; several P2s are large.

## Severity definitions

- **P0** — security, financial correctness, or a lifecycle with no exit. Blocks launch.
- **P1** — an approved MVP journey cannot be completed by its actor.
- **P2** — degrades quality or operator throughput; journey still completable.
- **later** — platform-later (Line B/C) or post-MVP.

---

## P0

| ID | Gap | Type | Owning context | Depends on | Evidence |
|---|---|---|---|---|---|
| **G-01** | Sandbox config fails open — unset `SANDBOX_ENABLED` yields `true`, gates nothing | security | composition | — | `env.ts:63-67`, `main.ts:91` |
| **G-02** | Sandbox control plane anonymous — class `@Public()`; create/advance/reset/delete | security | API | G-01 | `sandbox.module.ts:111` |
| **G-03** | Unauthenticated settlement in production — sandbox settle route not env-gated | security + financial | API | G-01 | `sandbox.module.ts:188-197` |
| **G-04** | Verified webhook unreachable — no `@Public()` despite docstring; default-deny blocks gateways | security | API | — | `commerce.module.ts:536-549` |
| **G-05** | Client-controlled sandbox tag → **live concealment channel** (exclusion already defaults on) | security | request context | — | `commerce.module.ts:493-499`, `repositories.ts:249`, `schemas.ts:323` |
| **G-06** | Sandbox money moves production balances — 1 of 22 tables tagged; `balance()` unfiltered | financial | persistence | G-05 | `schema.ts:238`, `repositories.ts:600-610` |
| **G-07** | Two pre-payment refund paths; refund lifecycle entirely unbuilt | domain lifecycle | Order | — | `order-state-machine.ts:17,18,33,34` |
| **G-08** | 3 edges cancel a **paid** order with no refund | financial | Order | G-07 | `:33,34,37` |
| **G-09** | Failed/abandoned resolution has no exit — `QUOTING` wedge | domain lifecycle | Order | — | `:17` |
| **G-10** | Manual resolution unreachable — 8 of 13 links missing, strategy unregistered | missing app boundary | Resolution | G-09 | `adapters.ts:280-305` |
| **G-11** | Event delivery is at-most-once while documented at-least-once — affects all 4 consumers | event reliability | messaging | — | `worker/main.ts:95-99`, `repositories.ts:798-806` |
| **G-12** | In production the resolution ladder registers **no strategies at all** | provider integration | composition | — | `adapters.ts:288-295` |

## P1

| ID | Gap | Type | Owning context | Depends on | Evidence |
|---|---|---|---|---|---|
| **G-13** | Permission model is design-target; enforcement is 3-value role string | authorization | auth | — | `http.ts:251-256`, `schemas.ts:90` |
| **G-14** | Customer exception decisions have no API (`PRICE_CHANGED`, `CUSTOMER_ACTION_REQUIRED`, `CUSTOMS_EXCEPTION`) | missing app boundary | Order | G-07 | traceability C18/C20/C21 |
| **G-15** | Nothing transitions to `PAYMENT_FAILED`; decline+retry unreachable | domain lifecycle | Payment | — | grep: no producer |
| **G-16** | Support capability absent entirely | missing app boundary | Support | G-13 | no table/route/service |
| **G-17** | Exception assign / resolve / rank orphaned | missing app boundary | Exception | G-13 | `schema.ts:434`, `admin.module.ts:305`, `repositories.ts:656` |
| **G-18** | Finance cannot reach order/customer context from a ledger entry | authorization | auth | G-13 | class-level `@Roles` `admin.module.ts:436` |
| **G-19** | **`STATE_TO_STEP_INDEX` covers 12/24 — timeline shows nothing done for 12 states** | UI | presentation | — | `:148`, `:170` — **new in Phase 11** |
| **G-20** | `STATE_BADGES` 21/24 → raw enum text to Persian customers | UI | presentation | — | `order-display.ts`, `track/page.tsx:95` |
| **G-21** | Admin has zero sandbox propagation → operator E2E unexecutable | sandbox | admin client | G-05 | grep: 0 refs |
| **G-22** | `sms`/`storage` unrouted — sandbox can send a real SMS | sandbox | composition | — | `adapters.ts:65-74` |
| **G-23** | `verifyWebhook` unroutable; callback verification untestable | sandbox + security | composition | G-04 | `sandbox-routing.ts:26` |
| **G-24** | Reconciliation matcher absent — consumer logs only | financial | Reconciliation | G-06 | `worker/main.ts:233-237` |
| **G-25** | Notification emitter + adapter absent (consumer exists and discards) | provider integration | Notification | G-11 | `worker/main.ts:224-231` |
| **G-26** | Address update/delete absent | API | Account | — | `apps/web/lib/api.ts` |
| **G-27** | No cancellation command despite 7 legal edges | missing app boundary | Order | G-07 | grep: no producer |

## P2

| ID | Gap | Type | Evidence |
|---|---|---|---|
| **G-28** | 12 of 24 event constants dead | observability | enumeration §5 |
| **G-29** | 4 events have producers, no consumers (incl. `order.state_changed`) | observability | §5 |
| **G-30** | `detectStalls` logs without raising | observability | `worker/main.ts:380-386` |
| **G-31** | Ledger DTO hand-emits `seq`/`txnId` — persistence exposure | API | `admin.module.ts:394-415` |
| **G-32** | Provider health has API, no screen | UI | `GET /v1/admin/providers` |
| **G-33** | Money field naming (`amount` vs `amountMinor`) permits 10× misread | financial | Phase 10 API §3 |
| **G-34** | `QuoteBreakdown` mixes rial and toman in one panel | UI | `QuoteBreakdown.tsx:49-50` |
| **G-35** | Catalogue vs chargeable weight conflated; api-tier weight never escalates | domain | `strategies.ts:83-85` |
| **G-36** | Seven normalized resolution fields absent | domain | `types.ts:10-29` |
| **G-37** | Three unbounded retry cycles | domain | traceability §4 |
| **G-38** | Session TTL slides; no CAS on session writes | sandbox | `sandbox-routing.ts:70-74` |
| **G-39** | `availableActions` has no producer, consumer, or test | API | design-target only |
| **G-40** | Admin `transition`/`reprice` post ledger entries without idempotency keys | financial | `admin.module.ts:494-527` |

## Later (Line B/C)

`G-41` organization/membership model · `G-42` scoped authorization · `G-43` wallet/deposit money model · `G-44` approval workflow entity · `G-45` public tokenized tracking.

---

## Type distribution

security 6 · financial 7 · domain lifecycle 5 · authorization 3 · missing app boundary 6 · API 4 · UI 5 · sandbox 5 · event reliability 3 · provider integration 3 · observability 4 · test coverage — see `test-coverage-map.md`.
