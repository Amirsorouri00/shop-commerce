# Sandbox — Security and Isolation

> Phase 9 of `docs/program/MASTER-PROMPT.md`. **Architecture only — no implementation.** Companions: `sandbox-architecture.md`, `scenario-catalog.md`, `e2e-journey-matrix.md`.
>
> This document resolves **P0-SEC-001** in architecture and defines the sandbox security boundary. **Three further defects were found while doing so** (§2), one of which — sandbox money moving production balances — is a confirmed live defect rather than a design risk.

## 1. The existing architecture is sound — the boundary around it is not

Before the defects, the part that is right, because the fixes must not damage it.

**Adapter routing sits below the service layer.** `routeByContext` (`apps/api/src/composition/sandbox-routing.ts`) binds each port token to a Proxy that resolves its adapter per call from ambient context. The reasoning in the source is exactly this phase's §1 principle: *"no service may know which, because the moment a service branches on 'am I in a sandbox', the sandbox stops proving anything about the real path."*

Consequences worth preserving:
- No `if (sandbox)` exists in any application or domain service.
- The **worker routes identically** (`apps/worker/src/main.ts:48-55`), so events for a sandbox order reach that session's adapters — without it "the worker would silently run sandbox orders against production adapters."
- Sessions live in Redis, so routing is async; every port method already is.

**This is the sandbox principle implemented correctly.** The problems are at the edges: what enables it, what happens when a session is missing, and what cannot be routed.

## 2. Defects

### F-S4 — an unauthenticated route settles payments *(new, P0 — the sharpest finding in this phase)*

`POST /v1/sandbox/gateway/settle` (`sandbox.module.ts:188-197`) sits on the `@Public()` `SandboxController` and calls `OrderService.settlePayment('sandbox', ref)` directly. It takes a provider reference, requires **no authentication, no session header, and no signature**, and drives a ledger post plus `PAID → PROCUREMENT_PENDING` plus an outbox event.

Two separate problems:

1. **It is unauthenticated.** Combined with P0-SEC-001 (the module is registered unconditionally in every environment), anyone who can reach the API can attempt to settle a payment by reference.
2. **It bypasses the webhook verification seam.** The route's own comment says it "drives exactly the same `OrderService.settlePayment` a real gateway webhook does" — which is true of the *application* path and false of the *verification* path. `WebhookController`'s `verifyWebhook` is never invoked.

**This corrects a claim made earlier in this phase.** Fixing F-S2 (routing `verifyWebhook`) does **not** unblock the callback-verification scenarios PAY-05…08, because this route sidesteps verification entirely rather than using a production verifier. Both must be fixed, and this one first.

### F-S5 — inverse crossover: a real order can be tagged sandbox by the client *(new, P0)*

`createOrder` (`commerce.module.ts:491-500`) reads `x-sandbox-session` from the request and copies it into `sandboxSessionId` **with no validation** — no check that the session exists, that it belongs to the caller, or that the caller may create sandbox data.

So an authenticated customer can tag a genuine order as sandbox. That order executes on **production adapters** (its session doesn't exist, so routing falls through per F-S1) while being permanently marked as simulated.

**And the fixes proposed in §5 make this worse, not better.** Repository-level default-exclude plus ledger exclusion would hide that real order from operator search, from financial reports, and from reconciliation. A mitigation that conceals real orders is worse than the leak it was meant to prevent. **Therefore: the sandbox tag must be derived server-side from a validated, authorized session — never copied from a client header.** This must land *before* default-exclude, not after.

### F-S6 — three ports are permanently unrouted *(new; corrects a false claim)*

`AdapterSet` has **eight** ports (`composition/adapters.ts:65-74`): `store`, `fx`, `payment`, `procurement`, `carrier`, `customs`, `sms`, `storage`. `SandboxPortName` routes **five**.

**Correcting this phase's own error:** an earlier draft said "customs is folded into the carrier port." That is false. `CustomsPort` exists as its own port with its own adapter (`CategoryPriorCustomsAdapter`, `:175`) and is injected into the quote engine. The real defect is worse than the one claimed: **customs is unrouted, so sandbox quotes compute duty using the production customs adapter.** `sms` and `storage` are unrouted too — meaning a sandbox session could send a real SMS.

This is a *permanent* fail-open, present in every session rather than only expired ones.

### P0-SEC-001 — configuration fails open *(known, carried from Phase 7)*

`SANDBOX_ENABLED` is `.optional().transform((v) => v !== 'false')` (`packages/contracts/src/env.ts:63-67`). **Unset yields `true`.** Its comment reads "Off in production." It is referenced in exactly one place — a startup log line (`main.ts:91`) — so it gates nothing. `SandboxController` is `@Public()` at class level (`sandbox.module.ts:111`) and `SandboxModule` is registered unconditionally.

Net effect: **anyone who can reach the API can create sessions, advance the virtual clock, delete sessions — and settle payments** (F-S4), in any environment, with no authentication. An earlier draft of this document listed only the session controls, which understated it.

### F-S1 — routing fails open on an unknown or expired session *(new, P0)*

`routeByContext` (`sandbox-routing.ts:52-58`):

> *"An unknown or expired session degrades to production rather than failing the request. A demo whose session timed out should not return a 500."*

The intent is kind and the consequence is severe. A sandbox journey whose session expires mid-flight does not stop — **its subsequent port calls silently reach the production adapters.** An order tagged `sandboxSessionId` could have its procurement or payment executed against real providers with real credentials, and the row would still look like sandbox data.

The trade being made is *demo smoothness* against *production safety*, and it is the wrong way round. **A stale sandbox session must fail closed**: reject the request with an explicit "sandbox session expired" error the UI can act on. A 400 naming the cause is a better demo experience than an invisible crossover, and an incomparably better production outcome.

### F-S3 — sandbox ledger entries pollute production financial balances *(new, P0 — verified, not hypothetical)*

**Only 1 of 22 tables carries a sandbox tag.** `sandboxSessionId` exists on `orders` (`packages/db/src/schema.ts:238`, indexed `:246`) and **nowhere else** — not on `ledgerEntries`, `payments`, `procurements`, `exceptions`, or `reconciliationItems`.

The consequence is immediate and current:

- `FinanceService.balances()` (`apps/api/src/modules/admin.module.ts:418-433`) sums `assets:cash:irr`, `liabilities:customer_prepayment`, `assets:goods_in_transit`, and `assets:foreign_float` across **all** ledger entries.
- It applies **no sandbox filter**, and *cannot* — the column does not exist.
- `FinanceService.ledger()` (`:392-416`) likewise returns sandbox and production rows indistinguishably.

**Therefore every sandbox order that reaches `PAID` writes ledger entries that move the platform's reported financial position.** A demo session run in a meeting changes `assets:cash:irr`. A finance operator reconciling has no way to tell simulated money from real money, because the distinction is not recorded.

This is the failure mode §5 of this document calls "the worst failure mode in this document." It is not a risk to design against — **it is current behaviour.** It is also the strongest argument for the repository-layer default-exclude in §5: a filter that must be remembered was never going to hold across 22 tables.

**Resolution:** propagate the session tag to every sandbox-created aggregate — at minimum `ledgerEntries`, `payments`, `procurements`, `exceptions`, `reconciliationItems` — and make exclusion the repository default rather than a per-query opt-in. Financial reads must exclude sandbox rows structurally.

### F-S2 — `verifyWebhook` cannot be routed and always uses production *(new)*

`SYNCHRONOUS_MEMBERS = {supports, verifyWebhook, mode, name}` bypass routing entirely (`sandbox-routing.ts:26`), justified as "none of them depends on scenario state."

That holds for `supports`, `mode`, and `name`. **It does not hold for `verifyWebhook`**, which is signature verification — precisely where a sandbox gateway's callbacks differ from a real provider's. Consequences: callback verification, malformed callbacks, and replay attacks (§10 of the phase brief) **cannot be exercised in sandbox at all**, and the production verifier is being asked to judge simulated callbacks.

**Resolution:** make `verifyWebhook` async so it can route, or move webhook verification behind an explicitly routed seam. It is a security-relevant function and must be simulatable; a payment integration whose verification path was never exercised is exactly the defect a sandbox exists to catch. **Necessary but not sufficient — F-S4 must be fixed too**, or callbacks continue to bypass verification via the sandbox settle route.

### F-S7 — the session TTL slides, contradicting any expiry contract *(new)*

The routing proxy's `finally { await store.save(session) }` (`sandbox-routing.ts:70-74`) rewrites the Redis key on **every port call**, refreshing the full TTL. A session therefore never expires while it is being used, and the explicit `expiresAt` proposed in `sandbox-architecture.md` §2 would be immediately falsified by the code that persists it.

Not dangerous on its own, but it makes the expiry contract — and F-S1's fail-closed-on-expiry design — untestable as specified. Expiry must be anchored to creation, not to last use, or the contract must say sliding explicitly.

### F-S8 — session writes have no concurrency control *(new)*

The API, worker consumers, and the front-office tracking poller all read-modify-write the same session JSON blob with no compare-and-set. Counters like `paymentVerifications` decide scenario behaviour (e.g. timeout-then-settle), so a lost update silently changes the outcome.

**This defeats determinism**, and it is not covered by the "assert final state and event set, not interleaving" rule in `sandbox-architecture.md` §3 — that rule addresses *observation* order, whereas this corrupts the *state* the scenario runs on.

## 3. Fail-closed configuration model

Replacing the current flag with an explicit three-part policy. **Every default is off.**

```
SANDBOX_MODE = disabled | enabled          # default: disabled, no coercion
SANDBOX_ALLOW_IN_PRODUCTION = false        # default: false
SANDBOX_CONTROL_AUDIENCE = operators | none  # default: none
```

Rules:

1. **Unset means disabled.** Parsing is strict — an unrecognized value is a **startup failure**, not a fallback. `.optional().transform(v => v !== 'false')` is replaced by an explicit enum with no default coercion. Malformed configuration must fail closed, and failing at boot is the loudest, safest form of closed.
2. **`SandboxModule` is registered conditionally**, not unconditionally. When disabled, the routes do not exist.
3. **In `NODE_ENV=production`, sandbox requires `SANDBOX_ALLOW_IN_PRODUCTION=true` *and* an explicitly approved production-safe policy.** Absent that, enabling sandbox in production is a **startup failure** — not a warning, because a warning in a log nobody reads is how this defect survived.
4. **Disabled sandbox routes return `404`**, never `403`. This matches `dev-gateway.module.ts:41-44`'s existing and correct reasoning: a 403 confirms the surface exists and invites investigation.
5. **The `X-Sandbox-Session` header is ignored entirely when sandbox is disabled** — not "no session found," but never consulted. Otherwise the header remains an attack surface in production.

**Why a three-part policy rather than one boolean:** the phase brief anticipates a legitimate production sandbox (a demo environment on production infrastructure). One flag cannot express "sandbox is on, and that is deliberate here" versus "sandbox is on because nobody set it." Separating *enablement* from *production permission* from *audience* makes the dangerous combination something someone must explicitly ask for.

## 4. Authorization model

Applying Phase 7. **Three distinct permission classes**, because conflating them is how a finance operator ends up able to forge payment callbacks:

| Class | Permissions | Who | Rationale |
|---|---|---|---|
| **Sandbox use** | `sandbox:use` | any operator with a business role | Enter a session and do their normal job inside it. A finance operator inspecting sandbox ledgers is doing finance work |
| **Sandbox control** | `sandbox:session:create`, `sandbox:session:reset`, `sandbox:session:delete`, `sandbox:clock:advance`, `sandbox:scenario:select` | QA, demo, engineering | Control-plane operations that change simulation state |
| **Failure injection** | `sandbox:inject:provider-failure`, `sandbox:inject:callback` | engineering only | Forging provider events is the most powerful capability here |

**Within a session, business permissions still apply unchanged.** A `support` operator in a sandbox session still lacks `refund:issue`. The sandbox must not become a privilege-escalation path — a scenario that let an operator do something their role forbids would invalidate every authorization test run inside it.

**No wildcards** (`sandbox:*`), per Phase 7's rule after a `support:*` wildcard was found granting operator commands to customers.

**Customer-facing demo, if it exists**, is a separate and tightly-scoped design: a public visitor may *drive their own* session (paste, quote, pay a simulated gateway) but holds **no** control-plane permission — no clock, no injection, no other session. It inherits nothing from the operator control plane. Today's `@Public()` class-level decorator gives an anonymous visitor the full control plane, which is the inverse of this.

## 5. Isolation model — row-level tagging in a shared database

**Current reality, verified:** orders carry `sandboxSessionId` (`packages/db/src/schema.ts:237-238`, indexed at `:246`), described as *"set when this order was produced inside a sandbox session, never in production data."* There is no separate database, schema, or queue.

**This is the right trade, and it is also the sharpest residual risk.** Assessed honestly:

**Why it is right:** the sandbox exercises the *real* persistence path — real repositories, real transactions, real outbox, real workers. A separate database would mean sandbox never touches the code that production uses, which is exactly the "too fake to expose an integration defect" failure §31 warns against.

**What it costs:** isolation now depends on **every read path remembering to filter**. The order search already gets this right — `sandbox: 'exclude' | 'only' | 'include'`, defaulting to `exclude`, with the reasoning that an operator hunting a customer's order almost never wants demo rows. But that is one query getting it right, not a structural guarantee.

**Requirements to make it structural:**

| Concern | Decision |
|---|---|
| **Database** | Shared. Isolation by `sandboxSessionId` tagging |
| **Default filter** | **Default-exclude must be enforced at the repository layer**, not per query. A query that forgets the filter should exclude sandbox rows, not include them — the safe direction must be the lazy direction |
| **Tag propagation** | Every sandbox-created aggregate carries the session id. **Audited: only `orders` does today — 1 of 22 tables** (F-S3). Ledger, payments, procurements, exceptions and reconciliation items carry no tag at all |
| **Financial records** | Sandbox ledger entries must be tagged and **never included in balances, reconciliation, or any financial report**. **This is currently violated** — see F-S3, which is a confirmed live defect rather than a risk |
| **Queues** | Shared broker, sandbox events tagged. Routing already handles worker context correctly |
| **Cache** | **Sandbox session id in the cache key namespace.** A cached FX rate or resolution from a sandbox scenario must never serve a production request, and vice versa |
| **Object storage** | Sandbox-prefixed keys; separate lifecycle so demo uploads expire |
| **Identifiers** | Sandbox public refs must be **visually distinguishable** (e.g. a reserved prefix), so a screenshot of a demo order is never mistaken for a real one |
| **Credentials** | **Already satisfied — verified.** `createSandboxAdapters(ctx)` (`packages/sandbox/src/adapters.ts:559-567`) takes only a context function; no credential or config object is passed to any sandbox adapter, so they are *structurally* incapable of holding production secrets rather than merely configured not to use them. The single `process.env` read in the package is `API_PUBLIC_URL` for the simulated gateway's return URL (`:328`), which is not a credential. **Preserve this constructor shape** — adding a config parameter would silently remove the guarantee |
| **Callbacks/webhooks** | Sandbox callbacks arrive on a **distinct route** and are never processed by the production handler. Combined with F-S2's fix, sandbox callbacks are verified by a sandbox verifier |
| **Expiry** | Sessions TTL out; tagged data is retained for inspection then purged on a schedule, never reaped mid-journey |

**Sandbox data must never reference production data.** A sandbox order may not attach to a production customer, address, or payment. The reverse — a production order referencing a sandbox session — must be structurally impossible, and is worth a database constraint rather than a convention.

## 6. Sandbox context propagation

**Current mechanism:** `X-Sandbox-Session` header → ambient context via `sandboxSessionId()` from `@xb/observability` → consulted by the routing Proxy. Applications and domain code never see it.

**This is the correct shape and should be preserved.** The header carries an *infrastructure* concern through an ambient channel rather than through domain signatures — which is why no entity outside `orders.sandboxSessionId` needs a sandbox field.

**Additions required:**
- **The session id must be in the audit record** for every command executed inside a session, so audit can distinguish simulated actions from real ones. Phase 7's audit model requires actor and permission; sandbox context is a third dimension.
- **Correlation ids must carry it**, so observability can reconstruct a session's full trace (§ observability in `sandbox-architecture.md`).
- **The tag is set at creation and immutable.** An order's session id may never be changed or cleared — that would launder sandbox data into production.

## 7. Virtual time must not touch security time

Phase brief §6 requires this boundary, and it is a real hazard: the session model already carries `virtualOffsetMs` (`packages/sandbox/src/session.ts:30`).

**Three clocks, explicitly separated:**

| Clock | Controlled by sandbox? | Governs |
|---|---|---|
| **Domain/business time** | **yes** | quote expiry, SLA windows, shipment legs, customs hold, decision timeouts, reconciliation windows |
| **Infrastructure time** | **no** | HTTP timeouts, retry backoff, circuit-breaker windows, queue visibility, DB statement timeouts |
| **Security time** | **never** | JWT `exp`/`nbf`, refresh rotation, OTP expiry, signature freshness, idempotency-key windows |

**Advancing the sandbox clock must never extend a token's validity or an OTP's lifetime.** If it did, "advance 30 days" would become an authentication bypass. The mechanism must therefore be an explicitly injected business clock consulted by domain code — **never a global `Date.now()` override**, which would silently capture all three categories.

Infrastructure time is deliberately excluded too: a sandbox that fast-forwards past a circuit-breaker's cooldown stops testing the breaker.

## 8. What remains open

- **Whether a production-hosted demo environment is wanted at all.** §3 makes it *expressible*; nobody has decided it is *desired*. Until someone does, `SANDBOX_ALLOW_IN_PRODUCTION` should never be set.
- **Public customer demo scope** — §4 sketches the boundary; the surface is not designed, and it should not be built speculatively.
- **Audit retention for sandbox actions** — tagged and inspectable, but retention is unspecified.
- **Whether sandbox rows should eventually move to a separate schema** if tag-filtering proves error-prone in practice. Recorded as a revisit trigger, not a plan.
