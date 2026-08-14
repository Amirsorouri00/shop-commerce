# Cross-Border Assisted Commerce — S1 Scaffold

A runnable **modular-monolith skeleton** that implements Sprint 1–4 of the Technical Blueprint:
ports & adapters, a deterministic quote engine, the order state machine, an in-process event
bus, a double-entry ledger, and a minimal HTTP API — all on **stub adapters** so the core works
today, before the payment / procurement / logistics / customs gates clear.

**Zero dependencies.** Runs on Node 22.6+ using native TypeScript execution.

## Run it

```bash
cd platform-scaffold

# 1) End-to-end demo (prints the whole lifecycle + ledger + the price-guard path)
npm run demo
#   or:  node --experimental-strip-types src/demo.ts

# 2) HTTP API
npm start
#   POST /v1/quotes            {"url":"https://www.amazon.ae/dp/XXXX"}
#   POST /v1/orders            {"quoteId":"..."}
#   POST /v1/orders/:id/pay | /procure | /fulfil
#   GET  /v1/orders/:id
#   GET  /v1/admin/orders

# 3) Type-check (optional; needs `npm i` to pull the TypeScript compiler)
npm run typecheck
```

## What the demo proves

- **Happy path:** paste link → resolve → viable quote (overhead 7.2%, TTL) → pay
  (`PAYMENT_CONFIRMED` ≠ purchased) → assisted procurement → `PURCHASED` → unified multi-leg
  tracking → `DELIVERED`, with a full immutable timeline and a double-entry ledger.
- **Price guard:** when the marketplace price jumps above the max-procurement tolerance, the
  order moves to `PRICE_CHANGED` (never a silent negative-margin purchase); after an approved
  reprice it continues to `PURCHASED`.

## Map to the architecture (Technical Blueprint §2)

```
src/
  shared/kernel.ts     Money value object · EventBus · ids · DomainEvent
  ports.ts             PORTS — StoreAdapter, FxProvider, PaymentGateway,
                       ProcurementExecutor, CarrierAdapter, CustomsEstimator
  adapters.ts          STUB adapters implementing each port (swap for real ones)
  domain/order.ts      Order aggregate + state machine + carrier→state normalization
  modules/pricing.ts   QuoteEngine — deterministic landed cost (v0.3 economics)
  modules/ordering.ts  Orchestration: resolve→quote→order→pay→procure→fulfil
  repos.ts             In-memory repositories + Ledger (swap for Postgres)
  app.ts               COMPOSITION ROOT — the only place that binds ports→adapters
  api.ts               Minimal /v1 HTTP surface (swap for NestJS controllers)
  demo.ts / index.ts   Demo runner / server entry
```

## Where the gated integrations plug in

Everything external is a port with a stub today. To go live on a cleared gate, implement the
port and bind it in `src/app.ts` — **nothing in the core changes.**

| Port | Stub now | Real adapter (when gate clears) |
|---|---|---|
| `StoreAdapter` | Amazon UAE canned + "vision-llm" tag | SP-API + vision-LLM fallback; Turkey/DE/UK |
| `FxProvider` | fixed rates | Iranian FX providers + manual fallback |
| `PaymentGateway` | always approves | real IRR gateway (payment gate) |
| `ProcurementExecutor` | assisted, honours max-price | agentic-supervised → API/ACP-UCP (procurement gate) |
| `CarrierAdapter` | canned legs | forwarder + AloPeyk/Snapp (logistics gate) |
| `CustomsEstimator` | 10% prior | validated duty engine (customs gate) |

## Design rules enforced in code

- **Money is a typed value object; the ledger is deterministic.** No AI writes financial records.
- **Every state change is guarded** by the transition table and appended to an immutable timeline.
- **Payment ≠ purchased** — distinct states, always.
- **Max-procurement-price guard** prevents uncontrolled negative margin.
- **Viability gate** blocks orders whose logistics overhead exceeds the threshold (v0.3).

## Not included (by design — later sprints / gated)

Real persistence, auth/OTP, async workers (BullMQ), notifications, reconciliation worker,
merchant panel, and the real adapters above. The seams for all of them exist.
