# Dependency Graph

> Phase 11 of `docs/program/MASTER-PROMPT.md`. Which capabilities gate which. **Binding input to Phase 12 sequencing.** Gap IDs from `gap-register.md`.

## Why ordering matters more than usual here

Two orderings in this program are not preferences — reversing them makes things **worse than doing nothing**:

1. **Sandbox exclusion before sandbox provenance** turns a leak into a concealment channel. Exclusion already defaults on (`schemas.ts:323`) while the client sets the tag, so this is live today (G-05).
2. **Manual-review UI before pre-payment lifecycle** delivers a queue that fills and never drains, because a rejected review has no terminal state (G-09).

## Foundation chains

### Chain A — sandbox trust and isolation

```
G-01 fail-closed config
  ↓
G-02 authenticate the control plane        ← anonymous today
  ↓
G-05 server-authoritative provenance       ← MOST URGENT: concealment is live
  ↓
      validated session + event-envelope propagation
  ↓
G-06 tag propagation to financial tables
  ↓
      repository-default exclusion → reports → balances
  ↓
G-03 + G-04 + G-23  callback parity
  ↓
G-21 admin sandbox propagation
  ↓
      executable E2E sandbox parity  ← Phase 9 gate, currently unmet
```

**G-22** (`sms`/`storage` unrouted) is parallel — no dependency, and it is the only gap that can send a real message from a demo.

### Chain B — pre-payment lifecycle and resolution

```
G-09 pre-payment failure/cancellation semantics
  ↓
G-07 + G-08 refund eligibility predicate + paid-cancel edges
  ↓
G-12 register resolution strategies (production registers NONE today)
  ↓
G-10 manual resolution: command, API, review entity
  ↓
      operator review workspace  (Phase 12 UI)
```

### Chain C — authorization foundation

```
G-13 identity/account model
  ↓
      permission storage + role compositions
  ↓
      backend evaluation + resource scope
  ↓
      UI capability payloads (G-39 availableActions)
  ↓
G-16 support · G-17 exception commands · G-18 finance context · sandbox permissions
```

**This chain gates more than any other.** Every operator capability designed in Phases 6–10 names a permission that does not exist. **Phase 12 must not schedule fine-grained-permission features before the foundation.**

### Chain D — event reliability

```
G-11 fix once() ordering (at-most-once → at-least-once)
  ↓
G-25 notification emitter + adapter
  ↓
      reliable async workflows: customer decisions, SLA timers, reconciliation
```

**Nothing that depends on guaranteed delivery may be built before G-11.** Notifications, SLA timeouts, and reconciliation all silently drop work under the current semantics.

### Chain E — payment settlement

```
G-04 make the verified webhook reachable
  ↓
G-03 retire the sandbox settlement shortcut
  ↓
G-23 route verifyWebhook
  ↓
      sandbox payment simulation with real verification
  ↓
      production gateway integration            (EXTERNAL-GATE)
```

## Cross-chain constraints

| Constraint | Reason |
|---|---|
| C before B's operator UI | review workspace needs `resolution:complete` |
| C before A's control-plane authz | sandbox permissions are permissions |
| A(G-05) before A(exclusion) | else concealment |
| B(G-09) before B(G-10) | else undrainable queue |
| D before notification-dependent journeys | else silent drops |
| G-19/G-20 independent | frontend-only, no gating |

## Critical path

**G-13 → permission foundation → operator capabilities** is the longest chain and gates the most. **G-05 is the most urgent** — live, exploitable, and one validation away.

## What is not gated

Fixable immediately, no dependencies: **G-19** (timeline map), **G-20** (badge map), **G-22** (route sms/storage), **G-30** (stall raising), **G-31** (ledger DTO), **G-34** (unit mixing), **G-40** (admin idempotency keys). Several are one-line changes with real consequence — worth pulling forward precisely because they are cheap.
