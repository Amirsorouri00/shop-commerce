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
| ~~G-01~~ | ~~Sandbox config fails open~~ — **CLOSED by WP-01.** `SANDBOX_MODE` is a strict enum defaulting to `disabled`; malformed values fail at boot; `isSandboxPermitted` is the single policy | security | composition | — | `env.ts:62-117` |
| ~~G-02~~ | ~~Sandbox control plane anonymous~~ — **CLOSED by WP-01 (interim).** Class-level `@Public()` replaced by `@Roles('ops','finance','admin')`; the 2 browser-reachable gateway routes stay `@Public()` by necessity and are environment-gated. **Scoped permissions remain WP-06** | security | API | G-01 | `sandbox.module.ts` |
| **G-03** | Unauthenticated settlement — **CONTAINED, NOT CLOSED.** WP-01 added the environment gate (the route 404s where sandbox is not permitted). It is **still unauthenticated and unverified where sandbox *is* permitted** — the structural fix is WP-02 | security + financial | API | G-01 | `sandbox.module.ts` |
| **G-04** | Verified webhook unreachable — no `@Public()` despite docstring; default-deny blocks gateways | security | API | — | `commerce.module.ts:536-549` |
| **G-05** | Client-controlled sandbox tag → **live concealment channel** (exclusion already defaults on) | security | request context | — | `commerce.module.ts:493-499`, `repositories.ts:249`, `schemas.ts:323` |
| **G-06** | Sandbox money moves production balances — 1 of 21 tables tagged; `balance()` unfiltered | financial | persistence | G-05 | `schema.ts:238`, `repositories.ts:600-610` |
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

| **G-20** | `STATE_BADGES` 21/24 → raw enum text to Persian customers | UI | presentation | — | `order-display.ts`, `track/page.tsx:95` |
| **G-21** | Admin **cannot enter** a sandbox session — `lib/api.ts` never sends `X-Sandbox-Session`. A "Demo orders" filter exists (`orders/page.tsx:71-125`), which is why the earlier "zero references" framing was wrong | sandbox | admin client | G-05 | `apps/admin/lib/api.ts` (0 header refs) |
| **G-22** | `sms`/`storage` unrouted — sandbox can send a real SMS | sandbox | composition | — | `adapters.ts:65-74` |
| **G-23** | `verifyWebhook` unroutable; callback verification untestable | sandbox + security | composition | G-04 | `sandbox-routing.ts:26` |
| **G-24** | Reconciliation matcher absent — consumer logs only | financial | Reconciliation | G-06 | `worker/main.ts:233-237` |
| **G-25** | Notification emitter + adapter absent (consumer exists and discards) | provider integration | Notification | G-11 | `worker/main.ts:224-231` |
| **G-26** | Address update/delete absent | API | Account | — | `apps/web/lib/api.ts` |
| **G-27** | No cancellation command despite 7 legal edges | missing app boundary | Order | G-07 | grep: no producer |

## P1 — added by the Phase 6 audit (Gate 1)

| ID | Gap | Type | Owning context | Depends on | Evidence |
|---|---|---|---|---|---|
| **G-46** | **Order search returns duplicate rows.** Row query `leftJoin`s unresolved exceptions so an order with N exceptions yields N rows, while `total` uses `count(DISTINCT orders.id)`. Rows and count disagree; offset paging shifts | API + persistence | Order | — | `repositories.ts:284,290` |
| **G-47** | **Exception queue cursor is inconsistent with its sort.** Cursor is `lt(id)`; sort is `desc(rank), desc(id)`. Correct **only because ranks are uniform** — so **fixing G-17 (ranking) without this corrupts pagination**. Admin client also never sends a cursor, capping the queue at 20 with no "more" | API + persistence | Exception | **gates G-17** | `repositories.ts:635,641`; `admin/lib/api.ts:120-124` |
| **G-48** | **Ledger has no pagination and hides it.** Capped at 200 with a hardcoded `nextCursor: null` implying paging exists. Silent truncation on a reconciliation-grade surface | financial + API | Finance | — | `admin.module.ts:392-415` |
| **G-49** | **Admin money commands ignore the idempotency key they are sent.** No admin route carries `@Idempotent()`; the admin client sends `Idempotency-Key` on procurement confirm, which posts double-entry ledger lines. Only `assertTransition` accidentally blocks a replay | financial | Procurement | — | `admin.module.ts:216-225`; `admin/lib/api.ts:149` |
| **G-50** | **`resolveException` has no actor parameter** — writes only `resolvedAt`/`resolutionNote`, so shipping it as-is produces an unattributed resolution, violating the program's own audit rule | authorization + observability | Exception | G-17 | `admin.module.ts:305`; `repositories.ts:649` |
| **G-51** | **Backoffice capability matrix omits four required capabilities** — MASTER-PROMPT `:609-625` requires sorting, saved filters/views, exports, and history; none appear in the Phase 6 matrix. Exports are load-bearing for finance hand-off, saved views for repeated triage | UI + API | backoffice | G-13 | `MASTER-PROMPT.md:609-625` |

## New — found during WP-01 implementation

| ID | Gap | Type | Owner | Evidence |
|---|---|---|---|---|
| **G-53** | **`NODE_ENV` defaults to `'development'`** (`env.ts:20`), so an unset `NODE_ENV` in a production deployment silently defeats **both** the sandbox production-refusal and the dev-gateway's 404. WP-01 removed one "unset means permissive" default and now depends on another | security | **WP-02, as an explicit prerequisite sub-scope** | `env.ts:20`, `dev-gateway.module.ts:42` |

**Why WP-02 owns G-53.** It is the next security-boundary package, and its correctness depends on accurately distinguishing development and sandbox behaviour from production payment ingress — the same distinction G-53 undermines. Not WP-03 (which owns session provenance, a different trust question) and not WP-06 (authorization, unrelated to environment inference).

**Binding prerequisite before implementing G-53:** enumerate **every functional `NODE_ENV` read in the repository** and classify its semantics. Do not change `NODE_ENV` default behaviour until the blast radius is understood. If the correct solution is a validated `APP_ENV` / runtime-environment concept rather than changing `NODE_ENV` itself, implement the smallest architecture-consistent solution. **Production-sensitive security behaviour must never infer "development" from absence.**
| **G-54** | The front-office `DemoPanel` calls the sandbox control plane with `skipAuth: true` (`apps/web/lib/api.ts:309-331`) and customer tokens carry role `customer`, so the customer-facing demo is now non-functional even when sandbox is enabled. **Intended** — Phase 9 required a public demo be separately scoped rather than inheriting operator controls — but the scoped replacement does not exist | UI + sandbox | **WP-22** | verified |

## P2

| ID | Gap | Type | Evidence |
|---|---|---|---|
| **G-19** | `STATE_TO_STEP_INDEX` covers 12/24; the 12 unmapped states fall to `-1` so all 8 timeline steps render PENDING **while still carrying real timestamps**. Misleads; does not block completion — **P2, domain layer** (corrected from P1/presentation) | UI | `order-state-machine.ts:148,170,189-197` |
| **G-28** | **18** of 24 event constants dead; `EVENT_TYPES` referenced nowhere functionally — all emission uses raw strings, so a typo'd topic is not type-checked | observability | `events.ts:28-62`; 7 emit sites |
| **G-29** | 4 events have producers, no consumers (incl. `order.state_changed`) | observability | §5 |
| **G-30** | `detectStalls` logs without raising | observability | `worker/main.ts:380-386` |
| **G-31** | Ledger DTO hand-emits `seq`/`txnId` — persistence exposure | API | `admin.module.ts:394-415` |
| ~~G-32~~ | ~~Provider health has API, no screen~~ — **WITHDRAWN, claim was false.** Provider health *is* rendered on the queue home as a degraded-count tile and warning banner (`apps/admin/app/page.tsx:29,53,76-85`). What is genuinely missing is a detail view and control actions — retained as **G-32a (P2)** | UI | verified |
| **G-33** | Money field naming (`amount` vs `amountMinor`) permits 10× misread | financial | Phase 10 API §3 |
| **G-34** | `QuoteBreakdown` mixes rial and toman in one panel | UI | `QuoteBreakdown.tsx:49-50` |
| **G-35** | Catalogue vs chargeable weight conflated; api-tier weight never escalates | domain | `strategies.ts:83-85` |
| **G-36** | Seven normalized resolution fields absent | domain | `types.ts:10-29` |
| **G-37** | Three unbounded retry cycles | domain | traceability §4 |
| **G-38** | Session TTL slides; no CAS on session writes | sandbox | `sandbox-routing.ts:70-74` |
| **G-39** | `availableActions` has no producer, consumer, or test | API | design-target only |
| ~~G-40~~ | ~~Admin `transition`/`reprice` post ledger entries without idempotency keys~~ — **WITHDRAWN, fabricated.** Verified: `OpsService.transition` (`:235-266`) and `reprice` (`:268-300`) post **no** ledger entries. The genuine unkeyed ledger posts are `confirmProcurement` (`admin.module.ts:210`) and `settlePayment` (`commerce.module.ts:366`) — retained as **G-49** | financial | verified |

## Later (Line B/C)

`G-52` eight repository methods have no external caller (`findByOrder`, `findByPhone`, `listByOrder`, `listByRef`, `listEvents`, `purgeExpired`, `purgeOlderThan`, `updateRanks`) — enumerated, not sampled. Two of them (`listByRef`, `listEvents`) are the payments-by-order and shipment-timeline reads the IA lists as MISSING.

## Later (Line B/C)

`G-41` organization/membership model · `G-42` scoped authorization · `G-43` wallet/deposit money model · `G-44` approval workflow entity · `G-45` public tokenized tracking.

---

## Type distribution

security 6 · financial 7 · domain lifecycle 5 · authorization 3 · missing app boundary 6 · API 4 · UI 5 · sandbox 5 · event reliability 3 · provider integration 3 · observability 4 · test coverage — see `test-coverage-map.md`.
