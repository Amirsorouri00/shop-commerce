# Cross-Border Assisted Commerce Platform

A link-first service: an Iranian consumer pastes a foreign marketplace URL, sees the full
landed cost in Toman, pays in IRR, and tracks the parcel to their door.

The architecture exists to solve one specific problem — **three dependencies are still gated
outside our control** (foreign payment, procurement method, logistics and customs). Each sits
behind a port with a stub adapter today, so the core and both surfaces are fully functional
before any gate clears.

---

## Quick start

Requires Node ≥ 22, Docker, and pnpm (via `corepack enable`).

```bash
cd platform
pnpm install
cp .env.example .env

docker compose up -d        # Postgres, Redis, RabbitMQ, MinIO, OTel collector
pnpm db:migrate             # schema + ledger constraints + append-only triggers
pnpm db:seed                # back-office operator accounts

pnpm --filter @xb/api start     # http://localhost:4000
pnpm --filter @xb/worker start  # AMQP consumers + outbox relay
pnpm --filter @xb/web dev       # http://localhost:3010  front office
pnpm --filter @xb/admin dev     # http://localhost:3011  back office
```

Verify the whole stack end to end:

```bash
./scripts/smoke.sh                                   # 19 API-level checks
./scripts/lifecycle.sh                               # paste-a-link → DELIVERED
SCENARIO=PRICE_CHANGED_BREACH ./scripts/lifecycle.sh # guard blocks after payment
SCENARIO=OUT_OF_STOCK_AT_PROCUREMENT ./scripts/lifecycle.sh
```

`lifecycle.sh` drives a real order all the way through: resolve, quote, OTP sign-in,
address, order, off-site gateway redirect, settlement, worker procurement, operator
confirmation in the back office, shipment creation, virtual-clock fast-forward, and the
customer timeline reaching **Delivered** — asserting the ledger balances along the way.

### Ports

Redis is mapped to **6380** and the frontends to **3010 / 3011**, because 6379 and 3000 are
commonly already taken by a local Redis and Grafana. Change them in `docker-compose.yml`
and `.env` if you prefer the defaults.

### Back-office sign-in (development)

| Email | Password | Role |
|---|---|---|
| `ops@example.ir` | `ops-dev-password` | ops |
| `finance@example.ir` | `finance-dev-password` | finance |
| `admin@example.ir` | `admin-dev-password` | admin |

---

## The sandbox

Nothing gated is live, so **the sandbox is how you actually see the product work**. It is not
a mock layer beside the real one — the sandbox adapters implement the same ports, and a
request carrying `X-Sandbox-Session` reaches them through the same controllers, guards,
validation and state machine as production traffic. That is what makes a sandbox run evidence
rather than theatre.

Open the front office and click **حالت نمایشی** (Demo mode), then pick a scenario:

| Stage | Scenarios |
|---|---|
| Resolution | vision-model fallback · needs operator review · product unavailable |
| Quote | all FX providers down |
| Checkout | payment declined · gateway times out then settles |
| Procurement | small price rise absorbed · **price rise breaches the guard** · sold out after payment |
| Fulfilment | happy path · held at customs · tracking goes quiet |

Each session has a **virtual clock**. A five-day delivery is walked through in a meeting by
pressing *+24 hours*: nothing sleeps, and the shipment legs already in the past become
visible. Sessions are seeded, so the same scenario replays identically every time.

```bash
curl localhost:4000/v1/sandbox/scenarios
curl -X POST localhost:4000/v1/sandbox/sessions \
  -H 'content-type: application/json' -d '{"scenarioId":"PRICE_CHANGED_BREACH","seed":42}'
```

---

## Layout

```
packages/
  core           Money · Result · error taxonomy · domain events · ports      (zero deps)
  contracts      Zod schemas + inferred types, shared by API and both frontends
  validation     bilingual (fa/en) error translation · Persian normalisation
  observability  pino · correlation context · metrics façade
  resilience     proxy pipeline · timeout · retry · circuit breaker · failover
  cache          cache-aside: single-flight, TTL jitter, negative, stale-while-revalidate
  commerce       marketplace registry · resolution ladder · rate limiting · procurement guard
  sandbox        scenarios · virtual clock · seeded determinism · simulated adapters
  messaging      RabbitMQ topology · outbox relay · DLQ and backoff
  db             Drizzle schema · migrations · repositories · unit of work
  storage        MinIO (S3 API, so any S3 provider drops in)
apps/
  api            NestJS modular monolith  (Fastify)
  worker         AMQP consumers + outbox relay + FX refresh + stall detection
  web            Next.js static export — Persian-first RTL front office
  admin          Next.js static export — exception-first back office
  og             meta-tag service for crawlers (recovers link previews without SSR)
```

---

## The five rules that shape everything

1. **`Money` is a value object.** Integer minor units, explicit currency, arithmetic throws on
   mismatch. No float touches money anywhere, including in Postgres.
2. **Every order state change goes through the transition table** and appends to an
   append-only timeline. Operators are subject to the same table as the machine.
3. **`PAID` is never `PURCHASED`.** A gateway charge means we hold the customer's money; it
   says nothing about whether the foreign purchase succeeded.
4. **The max-procurement guard is checked against a live offer**, immediately before buying.
   A breach branches the order — it never buys at negative margin.
5. **The composition root is the only place that names a provider.** If swapping an adapter
   requires touching the core, the change is wrong.

Rules 1, 2 and the ledger's balance are enforced **in the database**, not only in code:

```bash
docker exec xb-platform-postgres-1 psql -U xb -d xb \
  -c "UPDATE ledger_entry SET debit_minor = 1 WHERE seq = 1"
# ERROR: ledger_entry is append-only; UPDATE is not permitted
```

---

## Testing

```bash
pnpm test                          # 118 unit tests
pnpm test -- packages/commerce     # one package
./scripts/smoke.sh                 # 19 end-to-end checks against a running stack
pnpm typecheck                     # strict + exactOptionalPropertyTypes + noUncheckedIndexedAccess
```

---

## What is deliberately not built

Everything below has a designed seam and no implementation, so it can be added without
reworking what exists:

- **Real adapters** for payment, procurement, carrier and customs — blocked on their gates.
  Each has a stub satisfying the same contract the real one will.
- **The resolution strategies themselves.** `ResolutionPipeline` and its ladder are built and
  tested; no real strategy is registered because that needs marketplace credentials. Adding
  the SP-API strategy is one entry in an array in `composition/adapters.ts`.
- **Merchant panel**, wallet, and per-merchant rate cards — post-MVP.
- **Reconciliation matching** beyond the schema and the worker skeleton.
- **WebSocket streaming.** The front office polls; the API's WS routes are declared in the
  OpenAPI document but not implemented.
- **Reconciliation and notification consumers** are wired to their queues but only log.
- **Password hashing** is SHA-256 to match the seed. Move to argon2id before production.

See `docs/openapi.yaml` for the full API surface and `CLAUDE.md` for the architectural rules
and the deliberate deviations from `technical-blueprint-v1.md`.
