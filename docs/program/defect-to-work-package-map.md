# Defect → Work Package Map

> Phase 12 §32: **every P0/P1 has exactly one owning package, or an explicit deferral with rationale.** No defect appears in zero packages; ownership is not duplicated.

## P0

| Gap | Owner | Note |
|---|---|---|
| G-01 sandbox config fails open | **WP-01** | |
| G-02 anonymous control plane | **WP-01** (interim) → WP-06 (scoped) | Foundation/completion split, deliberate |
| G-03 unauthenticated settlement | **WP-01** (containment) → **WP-02** (structural) | **Containment ≠ fix.** Not closed by WP-01 alone |
| G-04 verified webhook unreachable | **WP-02** | |
| G-05 client-controlled sandbox tag | **WP-03** | Live exploit |
| G-06 sandbox money in production balances | **WP-07** | Must follow WP-03 |
| G-07 two pre-payment refund paths | **WP-04** | |
| G-08 paid orders cancelled without refund | **WP-04** | |
| G-09 `QUOTING` wedge | **WP-04** | |
| G-10 manual resolution unreachable | **WP-11** | One vertical capability |
| G-11 at-most-once event delivery | **WP-05** | |
| G-12 production registers no strategies | **WP-23**; consequence flagged in WP-11 | |

## P1

| Gap | Owner |
|---|---|
| G-13 permission model absent | **WP-06** |
| G-14 customer exception decisions | **WP-13** |
| G-15 nothing sets `PAYMENT_FAILED` | **WP-02** owns the producer *(the topology already exists at `:19,:35`, so WP-04 has nothing to add — an earlier split implied work that isn't there)*. **Must appear in WP-02's scope text** |
| G-16 support absent | **WP-16** |
| G-17 exception assign/resolve/rank orphaned | **WP-12** |
| G-18 finance cannot reach order context | **WP-06** |

| G-20 `STATE_BADGES` 21/24 | **WP-18** |
| G-21 sandbox executable parity | **WP-22** |
| G-22 `sms`/`storage` unrouted | **WP-07** |
| G-23 `verifyWebhook` unroutable | **WP-02** |
| G-24 reconciliation matcher absent | **WP-25** |
| G-25 notification emitter + adapter | **WP-15** |
| **G-14a refund execution** *(new ID — WP-14 previously owned nothing)* | **WP-14** |
| G-26 address update/delete | **WP-21** |
| G-27 no cancellation command | **WP-21** owns the command and customer surface; **WP-04** owns only the topology. *An earlier split left the command itself unowned — WP-04 is domain-only and WP-21 is UI* |
| G-46 order search row duplication | **WP-08** |
| G-47 exception cursor vs sort | **WP-08** |
| G-48 ledger has no pagination | **WP-09** |
| G-49 admin money commands ignore idempotency key | **WP-02** |
| G-50 `resolveException` has no actor | **WP-12** |
| G-51 capability matrix omits sort/views/export/history | **WP-10** |

## P2 — owned

**G-19** `STATE_TO_STEP_INDEX` 12/24 → **WP-18** *(P2 per the register's own correction; an earlier version of this map counted it as P1 to reach a total of 21)* · G-28 dead event constants → WP-05 · G-29 producers without consumers → WP-05 · G-30 `detectStalls` only logs → WP-12 · G-31 ledger DTO exposure → WP-09 · G-33 money field naming → **WP-17b** · G-34 mixed units in `QuoteBreakdown` → WP-17a · G-35 catalogue vs chargeable weight → WP-23 · G-36 seven resolution fields → WP-23 · G-37 unbounded retry cycles → WP-04 · G-38 session TTL slide / no CAS → WP-03 · G-39 `availableActions` → WP-19 · **G-52** eight orphaned repository methods → **WP-08** *(the register files it under a "Later" heading; it is scheduled in Tranche 2 because two of the eight are reads the IA lists as missing)*.

**Ownership is nominal for five gaps** — G-29, G-30, G-37, G-38 and G-19 are assigned but do **not** appear in their owning package's scope text. **Each owner must add an explicit scope line before that package is READY**, or the assignment is bookkeeping rather than ownership.

## Deferred with rationale

| Gap | Rationale |
|---|---|
| **G-32a** provider health detail view + control actions | The **screen exists** (queue-home tile + banner). Only a detail view and control actions are missing; no journey depends on them. **P2, deferred** |
| **G-41** organization/membership model | Platform-later (Line B). WP-06 preserves the `PLATFORM`/`ORGANIZATION` scope seam so it stays additive |
| **G-42** scoped authorization | Platform-later. Same seam; WP-06 builds the scope mechanism without the tenant |
| **G-43** wallet/deposit money model | Platform-later (Line B/C). No MVP journey needs it; WP-17's `Money` primitive does not foreclose it |
| **G-44** approval workflow entity | Platform-later (Line C). No entity exists and no MVP actor needs one |
| **G-45** public tokenized tracking | Platform-later (Line B). J9's actor cannot exist before merchants do |
| Customer-decision SLA | **An unresolved product decision, not an engineering gap.** WP-13 surfaces the state and must **not** invent a default |
| Partial refunds | Out of MVP scope by explicit domain decision. WP-14's command takes **no amount**, so they cannot arrive by accident |
| Support→refund escalation path | Open product decision (WP-16). A support role without `refund:issue` needs a defined escalation, which nobody has decided |

## Withdrawn — no package may resurrect these

| Gap | Why |
|---|---|
| ~~G-32~~ "provider health has no screen" | **False.** Rendered at `apps/admin/app/page.tsx:29,53,76-85`. Claimed three times in Phase 6 and repeated in Phase 11 |
| ~~G-40~~ "`transition`/`reprice` post ledger entries without idempotency keys" | **Fabricated.** They post **no** ledger entries. The genuine unkeyed posts are `confirmProcurement` and `settlePayment` → **G-49, owned by WP-02** |

## Coverage

**12 P0 + 20 P1 = 32 defects, all owned.** 13 P2 owned, 5 deferred with rationale, 2 withdrawn. **Zero of the 52 register IDs is unassigned** (verified by set difference, not by inspection).

**Corrected after review.** An earlier version claimed "21 P1 = 33," which required counting **G-19 as P1** against the register's own explicit demotion to P2. The corrected total is 20 P1. The completeness claim rests on the set difference being empty — which it is — not on the arithmetic, which was wrong.
