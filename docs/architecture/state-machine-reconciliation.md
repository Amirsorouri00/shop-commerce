# State Machine Reconciliation

> Phase 10 of `docs/program/MASTER-PROMPT.md`. **Architecture only.** Every claim verified against `apps/api/src/domain/order-state-machine.ts` and the services that transition orders. Evidence in `docs/program/verified-defect-register.md`.

## 1. Audit method

The 24-state table was audited per state rather than per edge: how it is entered, whether entry preconditions are financially valid, legal exits, terminal nature, which actor initiates each transition, which application command performs it, and whether any code performs it at all.

**The last question was the most productive.** Several states are legally reachable in the table and never reached in practice, and one whole lifecycle branch (refund) is table-only.

## 2. What the audit found

### 2.1 States with no code path

**`REFUND_PENDING` and `REFUNDED`.** No code in `apps/api/src` or `apps/worker/src` transitions into either. Six table edges lead to `REFUND_PENDING`; none is exercised. The payment port's `refund()` has no callers.

**`PAYMENT_FAILED`.** Present in the table and in the web badge map; nothing sets it. A declined payment currently leaves the order in `AWAITING_PAYMENT`.

**Consequence for design:** these are not "partially built" — they are specifications. That is good news for Phase 12, because there is no legacy behaviour to migrate, only absent behaviour to build correctly the first time.

### 2.2 The overloaded state — `OUT_OF_STOCK`

Reachable from **`QUOTING`** (pre-payment) and **`PROCUREMENT_PENDING`** (post-payment). Its exits are `['REFUND_PENDING', 'CANCELLED']` in both cases.

Two different business events share one state:

| | Pre-payment | Post-payment |
|---|---|---|
| Meaning | unavailable when we tried to price it | sold out before we could buy it |
| Money | none exists | customer has paid |
| Correct exit | terminate; no financial action | refund |
| Customer message | "we can't get this" | "your refund is being processed" |

The existing customer copy (`ALERTS.OUT_OF_STOCK`) says *"This item sold out before we could buy it. Your refund is being processed."* — which is **wrong and alarming** for the pre-payment case, where nothing was ever charged.

### 2.3 The wedge — `QUOTING`

`QUOTING: ['QUOTED', 'OUT_OF_STOCK']`. There is no exit for a failed resolution, no exit for a customer abandoning, and **no edge to `CANCELLED`**.

Combined with `ManualResolutionStrategy` never being registered, an order whose resolution needs review has **no reachable terminal state by any path**.

## 3. Decisions

### D1 — Split `OUT_OF_STOCK` by lifecycle position

Introduce **`UNAVAILABLE`** as a pre-payment terminal state; retain `OUT_OF_STOCK` for the post-payment case only.

```
QUOTING            → UNAVAILABLE          (terminal, no money)
PROCUREMENT_PENDING → OUT_OF_STOCK        (→ REFUND_PENDING | CANCELLED)
```

**Rationale.** The alternative — keeping one state and guarding the refund edge — was rejected: it leaves the pre-payment case with no terminal exit (§2.3's wedge in a second location), and it makes the state's meaning depend on history, which the table cannot express. **A state whose correct exit depends on how it was entered is two states.**

`UNAVAILABLE` carries its own customer copy: no refund is mentioned because none is owed.

### D2 — Complete the pre-payment lifecycle

```
QUOTING: ['QUOTED', 'UNAVAILABLE', 'RESOLUTION_REVIEW', 'RESOLUTION_FAILED', 'CANCELLED']
RESOLUTION_REVIEW: ['QUOTED', 'RESOLUTION_FAILED', 'UNAVAILABLE', 'CANCELLED']
RESOLUTION_FAILED: []        terminal
UNAVAILABLE:       []        terminal
```

- **`RESOLUTION_REVIEW`** — automated tiers were insufficient; a human is expected. Transient, with an SLA.
- **`RESOLUTION_FAILED`** — terminal: unsupported, ineligible, or review rejected.
- **`CANCELLED` from `QUOTING`** — customer abandons, or the request expires.

**No pre-payment terminal state touches refund semantics.** This is the invariant P0-DOMAIN-001 exists to establish.

**On whether `RESOLUTION_REVIEW` belongs in the Order state machine at all** — see §5. It is placed here provisionally and the alternative is argued there, because the phase brief explicitly warns against a God-state-machine and this is exactly where one starts.

### D3 — Refund eligibility is a financial predicate, not a table edge

Legality and eligibility are **separate gates**, and both must pass:

| Gate | Question | Authority |
|---|---|---|
| Legality | is this edge in `TRANSITIONS`? | `assertTransition` |
| Eligibility | is a refund financially meaningful? | new `RefundEligibility` domain check |

Eligibility requires: a **settled** payment exists for the order; refundable amount > 0; no refund already completed or in flight; the payment provider supports refund.

**This must be a domain check, not a controller guard.** The worker, the operator command, and any future automated path all need it, and a controller-level check protects only one of the three.

**CORRECTED — this claim was false.** An earlier version said that with D1 and D2 applied "every remaining edge into `REFUND_PENDING` originates post-`PAID`," making eligibility mere defence-in-depth. It does not: **`QUOTED → PRICE_CHANGED → REFUND_PENDING`** (`:18`, `:33`) is a second pre-payment refund path that the `OUT_OF_STOCK` split leaves entirely untouched.

Splitting `PRICE_CHANGED` the same way was considered and **rejected** — unlike `OUT_OF_STOCK`, it is genuinely one concept (the marketplace price moved) that can legitimately occur before or after payment, and the customer decision is the same in both cases; only the financial consequence differs.

**Therefore the eligibility predicate is load-bearing, not defence-in-depth.** Topology alone cannot close both paths without splitting a concept that should not be split. D3 is the primary protection and D1/D2 reduce its surface.

### D4 — Server-authoritative available actions, expressed as business actions

Phase 8 established that clients must not compute transition legality. Phase 10 refines *what* the server sends.

**Rejected: raw legal target states.** `{"legalNextStates": ["PROCUREMENT_PENDING", "REFUND_PENDING"]}` leaks internal mechanics, forces the client to map states to labels, and says nothing about whether the actor may perform them.

**Chosen: authorized business actions.**

```json
{
  "availableActions": [
    { "action": "accept-price-change", "enabled": true },
    { "action": "reject-price-change", "enabled": true },
    { "action": "cancel-order", "enabled": false,
      "reason": "NOT_PERMITTED" }
  ]
}
```

Rules:
- An action appears only if it is **domain-legal for this resource in its current state**.
- `enabled` additionally reflects **actor authorization** — resolving the Phase 8 requirement that both legality and permission be represented.
- `reason` distinguishes `NOT_PERMITTED` from `PRECONDITION_UNMET` so the UI can explain rather than merely disable.
- **Actions the actor may not know exist are omitted entirely**, not sent disabled — per the Phase 7/8 disclosure rule.
- Action names are **business vocabulary**, never state names.

This is what makes `canAcceptPriceChange` (the phase brief's example) a better contract than a target-state enum: it survives a state-machine refactor that a client-side enum mapping would not.

## 4. Full state audit summary

| State | Entered by | Code performs it? | Exits | Terminal | Notes |
|---|---|---|---|---|---|
| `DRAFT` | order creation | yes | `QUOTING`, `CANCELLED` | no | |
| `QUOTING` | quote requested | yes | **extended by D2** | no | **wedge fixed** |
| `QUOTED` | quote produced | yes | `AWAITING_PAYMENT`, `PRICE_CHANGED`, `CANCELLED` | no | `QUOTED → PRICE_CHANGED` legal but only procurement sets it — see §6 |
| `AWAITING_PAYMENT` | checkout | yes | `PAID`, `PAYMENT_FAILED`, `CANCELLED` | no | |
| `PAID` | settlement | yes (`settlePayment`) | `PROCUREMENT_PENDING` only | no | `PAID ≠ PURCHASED` structurally enforced. **Never observable as a resting state** — `settlePayment` (`commerce.module.ts:355-382`) transitions to `PROCUREMENT_PENDING` in the *same transaction*, so no query ever sees `PAID`. It is a ledger checkpoint, not a status |
| `PROCUREMENT_PENDING` | after `PAID` | yes | `PURCHASED`, `PRICE_CHANGED`, `OUT_OF_STOCK`, `PROCUREMENT_FAILED` | no | |
| `PURCHASED` | procurement confirm | yes | `SELLER_PROCESSING`, `PROCUREMENT_FAILED` | no | |
| transit states ×6 | carrier events | yes | forward + exception | no | |
| `DELIVERED` | carrier | yes | — | **yes** | no post-delivery return path (§6) |
| `PRICE_CHANGED` | procurement | yes | `PROCUREMENT_PENDING`, `REFUND_PENDING`, `CANCELLED` | no | customer decision — no API yet |
| `OUT_OF_STOCK` | **split by D1** | yes | `REFUND_PENDING`, `CANCELLED` | no | post-payment only after D1 |
| `PAYMENT_FAILED` | — | **no** | `AWAITING_PAYMENT`, `CANCELLED` | no | **unreachable** |
| `PROCUREMENT_FAILED` | procurement | yes | `PROCUREMENT_PENDING`, `REFUND_PENDING` | no | |
| `CUSTOMER_ACTION_REQUIRED` | carrier/customs | yes | `DOMESTIC_TRANSIT`, `REFUND_PENDING`, `CANCELLED` | no | no customer API |
| `SHIPMENT_EXCEPTION` | carrier | partial | 4 forward + `REFUND_PENDING` | no | `detectStalls` only logs |
| `CUSTOMS_EXCEPTION` | customs | yes | `DOMESTIC_TRANSIT`, `CUSTOMER_ACTION_REQUIRED`, `REFUND_PENDING` | no | |
| `REFUND_PENDING` | — | **no** | `REFUNDED` | no | **entire branch unbuilt** |
| `REFUNDED` | — | **no** | — | yes | |
| `CANCELLED` | order cancel | partial | — | yes | no cancel command verified |

## 5. Aggregate boundaries — resisting the God state machine

The phase brief warns against expanding one enum indefinitely. D2 adds three states, which makes this the moment to check.

**Test applied:** does the concept describe *the customer's order* as a whole, or the internal progress of a subordinate process?

| Concept | Belongs to Order? | Reasoning |
|---|---|---|
| `RESOLUTION_REVIEW` | **provisionally yes** | The customer's order genuinely is *waiting* — it is not merely an internal detail. But the *review itself* (who, what fields, what was corrected) belongs to a `ResolutionReview` entity, not the order |
| `RESOLUTION_FAILED` / `UNAVAILABLE` | **yes** | Terminal outcomes of the order |
| Payment attempt history | **no** | `Payment` aggregate; the order sees only `AWAITING_PAYMENT`/`PAID`/`PAYMENT_FAILED` |
| Procurement retries | **no** | `ProcurementOrder`; already correctly separate |
| Individual shipment legs | **no** | `Shipment`; the order projects a coarse position |
| Exception assignment | **no** | `Exception` entity; already separate |
| Support case status | **no** | `SupportCase` |
| Reconciliation status | **no** | `ReconciliationCase` — never an order state |

**The rule going forward:** a new order state is justified only when the *customer's own understanding of their order* changes. Internal progress of a subordinate process gets its own aggregate and projects into the order's state at most coarsely.

**`RESOLUTION_REVIEW` is the marginal case and is flagged as such.** If a second review-related state is ever proposed, that is the signal the concept has outgrown the order enum and should move to `ProductRequest`/`ResolutionReview` with the order simply remaining `QUOTING` until resolved.

### 4a. Unbounded cycles

Three cycles have no iteration limit and no code enforcing one:

- `PROCUREMENT_PENDING ↔ PRICE_CHANGED` — a seller repeatedly raising price could loop indefinitely
- `PROCUREMENT_PENDING ↔ PROCUREMENT_FAILED` — retry with no cap
- `SHIPMENT_EXCEPTION ↔` four transit states

None is currently dangerous (retries are operator-driven), but each becomes a runaway path once automated retry exists. **A retry/attempt counter with a terminal escalation belongs on each**, and is Phase 12 work rather than a table change.

## 6. Findings that are decisions for the product owner, not architecture

Recorded rather than resolved, because choosing would be inventing product policy:

1. **No post-delivery return path.** `DELIVERED` is terminal, so a delivered-but-wrong item has no lifecycle. Whether returns are in scope is a product decision; if yes, it is a new branch, not an edge.
2. **`QUOTED → PRICE_CHANGED` is legal but never set at that point** — only procurement sets `PRICE_CHANGED`. Either the edge is dead and should be removed, or pre-checkout price drift should use it. Currently ambiguous.
3. **Customer decision SLA remains undefined** (carried from Phase 3). `PRICE_CHANGED` and `CUSTOMER_ACTION_REQUIRED` have no timeout policy, so an unanswered decision waits forever. D2 gives the pre-payment branch terminal states; the post-payment decision branch still has none.

## 7. Migration impact

| Change | Data impact | Rollback |
|---|---|---|
| Add `UNAVAILABLE`, `RESOLUTION_REVIEW`, `RESOLUTION_FAILED` | new enum values; **no existing rows change** | additive — safe |
| Extend `QUOTING` exits | table-only | safe |
| Restrict `OUT_OF_STOCK` to post-payment | **no existing rows** reached it pre-payment via a code path (the edge was legal but unexercised) — verify before migrating | safe if verified |
| Refund eligibility check | new domain service; nothing currently transitions to `REFUND_PENDING`, so **no behaviour changes** | safe |

**CORRECTED — the migration is NOT purely additive.** An earlier version of this table claimed "additive, no behaviour change." Adding states breaks four collections in `order-state-machine.ts` that are keyed by state and were not listed:

| Collection | Line | Consequence if not updated |
|---|---|---|
| `TERMINAL_STATES` | `:61` | `isTerminal()` returns **false** for `UNAVAILABLE` and `RESOLUTION_FAILED` — the two new terminals are not terminal |
| `EXCEPTION_STATES` | `:51` | new states absent from exception classification |
| `STATE_TO_STEP_INDEX` | `:148` | customer timeline cannot place them |
| `ALERTS` | `:213` | `alertFor()` returns **null**, directly contradicting §D1's claim that `UNAVAILABLE` "carries its own customer copy" |

**Each must be updated in the same change.** The *data* migration is additive (no rows change); the *code* change is not. Conflating the two is how a state gets added and silently renders as raw enum text — precisely the `STATE_BADGES` defect already recorded.

**Also corrected:** `RESOLUTION_REVIEW → QUOTED` is wrong. Review resumes *resolution*; it does not produce a quote. The edge is **`RESOLUTION_REVIEW → QUOTING`**, and quoting proceeds from there — matching the use-case flow in `backend-domain-api-reconciliation.md` §1, which says "quote possible," not "quoted."

**And a duplication to resolve before implementing:** `productRequest.status` already persists `PENDING | RESOLVED | NEEDS_REVIEW | FAILED` (`packages/contracts/src/schemas.ts:154`, produced at `packages/commerce/src/resolution.ts:209`). `RESOLUTION_REVIEW`/`RESOLUTION_FAILED` on the Order would be a **second copy of that state**. §5's God-state-machine test must therefore be applied for real, not hypothetically: **the resolution status belongs to `ProductRequest`, and the Order should remain `QUOTING` while review is outstanding**, gaining only the two *terminal* outcomes it genuinely owns (`UNAVAILABLE`, `RESOLUTION_FAILED`). This is the stricter reading of §5's own rule and it is the one to follow.
