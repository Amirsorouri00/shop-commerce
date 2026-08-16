# Sandbox Isolation — Backend Architecture

> Phase 10 of `docs/program/MASTER-PROMPT.md`. The authoritative backend design for sandbox trust, context propagation, and financial isolation. Supersedes the isolation sections of `docs/sandbox/security-and-isolation.md` where they differ; the sandbox docs remain authoritative for scenarios and the control plane. Evidence: `docs/program/verified-defect-register.md`.

## 1. Server-authoritative sandbox provenance

**Verified problem** (`apps/api/src/modules/commerce.module.ts:491-500`): `createOrder` copies the client's `x-sandbox-session` header into `orders.sandboxSessionId` with no validation.

**Design:**

1. **The header is a request, not an assertion.** It nominates a session; it never establishes one.
2. **A request-scoped `SandboxContext` is derived server-side** by: checking sandbox is enabled at all (P0-SEC-001); loading the session; verifying it exists, has not expired, and **belongs to the authenticated actor** or is one they hold `sandbox:use` for. Any failure → **no sandbox context**, and the request **fails closed** if it carried a header (`400 sandbox session invalid`) rather than silently proceeding as production.
3. **Application commands receive `SandboxContext` from the resolved request context**, never from raw headers. `createOrder` stops reading `@Headers` entirely.
4. **The tag is written by infrastructure, not passed by callers**, and is **immutable once set** — no code path may change or clear it.

**A further hole §1 does not close on its own:** `SandboxController` is `@Public()` at **class level** (`sandbox.module.ts:111`), so session create/advance/reset/delete are anonymous. §1 requires the session to "belong to the authenticated actor" — but **`SandboxSession` has no owner field**, and neither did the migration table in `backend-domain-api-reconciliation.md` §9b. Adding `createdBy` is a prerequisite for ownership checks, not an enhancement.

**Why fail-closed on an invalid header matters more than it appears:** the current fallthrough (`sandbox-routing.ts:52-58`) means an expired session silently executes against **production adapters with production credentials** while the order still looks like sandbox data. Failing the request is both safer and a better demo experience — "your session expired" is actionable; an invisible crossover is not.

## 2. Context propagation

| Layer | Mechanism |
|---|---|
| HTTP | `X-Sandbox-Session` header — **input only** |
| Auth | actor resolved first; session ownership checked against it |
| Request context | ambient `SandboxContext` (existing mechanism via `@xb/observability`) |
| Application command | explicit field on the command object — commands are testable without ambient state |
| Persistence | infrastructure writes the tag; repositories never accept it from a caller |
| Events | **CORRECTED — the session id is *not* in the event envelope.** An earlier version of this table claimed it was and cited lines showing something else. **Actual mechanism:** `once()` reads `event.payload.orderId`, loads the **order row**, and takes `order.sandboxSessionId` from it (`apps/worker/src/main.ts:100-108`). **Consequence:** any event whose payload lacks `orderId` — much `payment.*` and `exception.*` traffic — **never enters sandbox context at all** and runs against production adapters. Putting the session id in the envelope is therefore *required work*, not an existing property |
| Workers | `routeByContext` binds ports (`worker/main.ts:48-55`); the session lookup is the order-row read above |
| Provider calls | adapter selection by ambient context (existing) |
| Observability | correlation id + session id on every log line and audit record |

**Preserved from the existing design, deliberately:** no application or domain service branches on sandbox state. The routing Proxy resolves adapters below the service layer, and the source's reasoning is exactly right — *"the moment a service branches on 'am I in a sandbox', the sandbox stops proving anything about the real path."* Phase 10 changes **how the context is trusted**, not how it is consumed.

## 3. Financial isolation

**Verified problem:** 1 of 22 tables carries a sandbox tag. `ledgerEntries` has none; `FinanceService.balances()` sums all entries unfiltered and cannot filter.

**Design, in the mandatory order:**

**Step 1 — trustworthy provenance** (§1). Nothing below is safe before this.

**Step 2 — propagate the tag** to every aggregate a sandbox session can create: `ledgerEntries`, `payments`, `procurements`, `exceptions`, `reconciliationItems`, `productRequests`, `quotes`, `shipments`, and any notification delivery record. Written by infrastructure at insert time from the ambient context.

**Step 3 — exclusion by default at the repository layer**, not per query. The safe direction must be the lazy direction: a query that forgets to specify scope excludes sandbox rows. Opting *in* is explicit (`sandbox: 'only' | 'include'`), matching the existing `adminOrderSearchQuery` convention — which already gets this right and is the template.

**Step 4 — financial reads are structurally incapable of including sandbox rows.** `balances()`, reconciliation matching, and any finance report take the exclusion unconditionally, not as a default that a future parameter could override. A sandbox order must not be able to move a production balance even by explicit request; inspecting sandbox finances is a *separate*, session-scoped query.

**Do not solve this at the UI query layer.** The invariant belongs at the authoritative data layer, because the worker, the reconciliation matcher, and any future report all read the ledger without going through a UI.

## 4. Callback parity — the settlement path

**Verified problem (P0-SEC-002):** `WebhookController` lacks `@Public()` despite documenting itself as public, so under global default-deny the **verified** ingestion path is unreachable by a gateway; meanwhile `POST /v1/sandbox/gateway/settle` is public and unverified. The only working settlement path is the unauthenticated one.

**Three surfaces, explicitly distinguished** (the phase brief's §2 requirement):

| Surface | Purpose | Auth | May mutate order state? |
|---|---|---|---|
| **Sandbox control plane** | make the simulated provider *do something* | sandbox permission | **no — never directly** |
| **Simulated provider callback** | the sandbox gateway emits a callback | signature (sandbox verifier) | yes, **via the normal ingestion path** |
| **Business payment API** | customer starts a payment | customer auth + idempotency | yes, via application service |

**A third settlement path exists and must be included:** `POST /v1/dev/gateway/settle` (`dev-gateway.module.ts:27,74-82`), `@Public()`, settling the **default** provider `'stub'`. It is **correctly production-gated** (404 outside development) and its comment shows the right instinct — the provider name is hard-coded *because* the endpoint is unauthenticated. **It is the pattern the sandbox route should have copied.** Retiring the sandbox route does not close it; in development all three paths remain open.

**Corrections required:**

1. **Add `@Public()` to `WebhookController`** so the verified path works as documented, and keep signature verification as the sole gate.
2. **Retire `/v1/sandbox/gateway/settle` as a settlement route.** It becomes a control-plane action that causes the simulated gateway to **emit a callback into the normal webhook path** — same verification, same application service, same ledger and transition logic.
3. **Make `verifyWebhook` routable** so the sandbox verifier judges sandbox callbacks. It is currently synchronous and therefore always production (`sandbox-routing.ts:26`), and `StubPaymentAdapter.verifyWebhook()` returns `true` unconditionally — so verification is presently a no-op in stub environments regardless.

**The principle:** a sandbox control action may *cause* provider behaviour; it may never *substitute* for it. Anything else means the payment ingestion path — signature verification, idempotency via `settleOnce`, ledger posting, transition — is never exercised by the environment built to exercise it.

## 5. Adapter parity — the complete inventory

Phase 9's parity assertion covered five ports against an eight-port `AdapterSet` (`apps/api/src/composition/adapters.ts:65-74`) and would have certified a diverged sandbox. Corrected inventory:

| Port | Production | Sandbox | Replacement required? | Verified reasoning |
|---|---|---|---|---|
| `store` | strategy pipeline | `SandboxStoreAdapter` | **yes** — external | routed |
| `fx` | FX provider | `SandboxFxAdapter` | **yes** — external | routed |
| `payment` | gateway | `SandboxPaymentAdapter` | **yes** — external | routed |
| `procurement` | marketplace | `SandboxProcurementAdapter` | **yes** — external | routed |
| `carrier` | carrier API | `SandboxCarrierAdapter` | **yes** — external | routed |
| `customs` | `CategoryPriorCustomsAdapter` | **shared — correctly** | **no** | **CORRECTION.** `estimate()` (`adapters.ts:189-198`) is pure computation over a static prior table with **no outbound call**. It is deterministic internal business logic behind a port, not an external integration. Running the same logic in both modes is *correct*; mocking it would reduce fidelity. Phase 9 wrongly called this a defect |
| `sms` | SMS provider | **none — unrouted** | **yes — GAP** | genuinely external. A sandbox session could send a real SMS |
| `storage` | MinIO | **none — unrouted** | **yes — GAP** | external; needed once document upload exists |

**The parity criterion, restated correctly:** *every port whose implementation crosses an external or environment-sensitive boundary must be replaced in sandbox; ports implementing deterministic internal logic are shared, and that sharing must be declared and justified rather than assumed.*

The question is **not** "sandbox everything" — it is "isolate every external boundary."

**Binding-time parity is insufficient.** Two divergences are runtime-only and no binding comparison can see them:
- non-function port members and `SYNCHRONOUS_MEMBERS` resolve to production (`sandbox-routing.ts:26,44`);
- expired/unknown/corrupt sessions fall through to production (fixed by §1).

**Runtime parity assertion required:** run a scenario and verify every outbound port call was served by a sandbox adapter, using the adapter call log as a **test fixture** rather than only a debugging aid. `instanceof SandboxAdapter` is explicitly insufficient.

## 6. Admin sandbox propagation

**Verified problem:** `apps/admin` contains **zero** sandbox references, so operator sandbox journeys cannot execute and the "one integrated environment" requirement is unmet.

**Design — centralized, not per-component:**

1. **Session selection lives in the admin app shell**, and the active session id is held in one client-side context.
2. **The API client attaches the header centrally** (`apps/admin/lib/api.ts` already wraps every call in one module — the correct seam, and the reason this is cheap).
3. **No component sets the header.** A component that needs sandbox behaviour gets it by the app being in a session, not by opting in.
4. **The mode is unmistakable** — Phase 8's sandbox visual treatment, always visible while a session is active.
5. **Leaving sandbox mode clears the context**, and the client must make it impossible to hold a stale session id across a mode switch — the header is attached only while a session is active, never from persisted state that outlived it.
6. **Server-side, the same validation as §1 applies.** The admin client is not more trusted than any other; it nominates a session and the server decides.

## 7. Configuration

Per `docs/sandbox/security-and-isolation.md` §3, unchanged and restated as binding: strict enum with **no default coercion**, unset means disabled, a malformed value is a **startup failure**, `SandboxModule` registered conditionally, disabled routes return **404**, and the session header is **not consulted at all** when sandbox is disabled.
