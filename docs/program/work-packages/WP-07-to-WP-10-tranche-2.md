# Tranche 2 — Operational foundations (WP-07 … WP-10)

> Four packages sharing a tranche document because they are individually small and tightly related. Each retains its own identity, dependencies, and acceptance criteria. Split into separate files if any grows beyond one implementation cycle.

---

## WP-07 — Sandbox financial isolation

**P0 · financial · Contexts:** persistence, Finance · **Depends on: WP-03 (HARD)**

**Why (G-06).** **1 of 21 tables** carries a sandbox tag — `orders.sandboxSessionId` (`schema.ts:238`). `ledgerEntries` has none, and `LedgerRepository.balance()` (`repositories.ts:600-610`) sums `ledgerEntries` with **no filter and no ability to filter**. Every sandbox order reaching `PAID` moves the platform's reported financial position, and a finance operator cannot distinguish simulated money from real.

Also **G-22**: `sms` and `storage` are unrouted (`AdapterSet` has 8 ports, 5 routed), so **a sandbox session can send a real SMS**.

**Scope.** Propagate the session tag to every sandbox-creatable aggregate — `ledgerEntries`, `payments`, `procurements`, `exceptions`, `reconciliationItems`, `productRequests`, `quotes`, `shipments`; **repository-layer default exclusion** so the lazy path is the safe path; financial reads **structurally incapable** of including sandbox rows (not a default a parameter can override); route `sms` and `storage`.

**Excluded.** `customs` stays shared — verified as deterministic internal logic (`CategoryPriorCustomsAdapter.estimate()`, `adapters.ts:188-199`, pure computation over a static prior table, no outbound call). Mocking it would *reduce* fidelity. This corrects a Phase 9 claim.

**Tests.** Sandbox order at `PAID` → **production balances unchanged**; a query omitting scope excludes sandbox rows; sandbox session cannot send a real SMS; ledger/reconciliation reads cannot be asked to include sandbox rows.

**Acceptance.** No sandbox row can affect a production balance or financial report by any path, including explicit request.

**Risk.** Additive nullable columns + index; backfill is `NULL` = production. **Must not precede WP-03** — exclusion on a client-settable tag is a concealment channel.

---

## WP-08 — Operational query correctness

**P1 · API + persistence · Contexts:** Order, Exception · **Depends on: none · Gates WP-12**

**Why.** Two verified query defects and one orphan set:

- **G-46** — order search `leftJoin`s unresolved exceptions (`repositories.ts:284`), so an order with N exceptions yields N rows, while `total` uses `count(DISTINCT orders.id)` (`:290`). **Rows and count disagree; offset paging shifts.**
- **G-47** — the exception cursor is `lt(exceptions.id)` (`:635`) while the sort is `desc(rank), desc(id)` (`:641`). Correct **only because ranks are currently uniform**. The admin client also never sends a cursor (`admin/lib/api.ts:120-124`), capping the queue at 20 with no "more".
- **G-52** — 8 repository methods have no caller (`findByOrder`, `findByPhone`, `listByOrder`, `listByRef`, `listEvents`, `purgeExpired`, `purgeOlderThan`, `updateRanks`). Two of them — `listByRef`, `listEvents` — are the payments-by-order and shipment-timeline reads the IA lists as MISSING. **Wire or delete; do not leave built-and-unreachable.**

**This package gates WP-12.** Implementing ranking while the cursor keys on `id` **silently corrupts pagination** — the bug appears only once ranks stop being uniform.

**Tests.** Order with 2 unresolved exceptions → **one row**, count matches; cursor pagination correct under **non-uniform ranks** (seed them); no page skips or repeats across the full set.

**Acceptance.** Row count equals reported total under every filter; pagination is correct with ranking active; every orphan is wired or removed.

---

## WP-09 — Finance & ledger query foundation

**P1 · financial + API · Contexts:** Finance · **Depends on: WP-06, WP-07**

**Why.** **G-48** — `FinanceService.ledger()` (`admin.module.ts:392-415`) has **no pagination**, caps at 200, and returns a hardcoded `nextCursor: null` that *implies paging exists*. Silent truncation on a reconciliation-grade surface. **G-31** — it hand-emits `seq` and `txnId` with no DTO: persistence exposure.

**Scope.** Real cursor pagination; filtering by account, currency, date, `refId`; the **finance investigation read model** — ledger → payment → refund → order context in one query under `ledger:read` + `order:read` **with no mutation permission** (Phase 7 F1); DTO mapping; sandbox exclusion inherited structurally from WP-07.

**Acceptance.** No silent truncation; a finance operator traverses ledger → payment → order → provider ref without gaining `order:transition`; no persistence internals in the response.

---

## WP-10 — Backoffice workspace read models

**P1 · API · Contexts:** backoffice queries · **Depends on: WP-06, WP-08**

**Why.** Phase 8 established the context-preserving workspace; Phase 6 found the API cannot serve it without N+1 calls. **G-51** — the capability matrix omits **sorting, saved views, exports, and history**, all required by MASTER-PROMPT `:609-625`; exports are load-bearing for finance hand-off and saved views for repeated triage.

**Scope.** Read models for the exception queue and the order workspace (timeline + procurement + money + provenance in one response, because the workspace shows them together); saved-view semantics; sorting; export; `availableActions` shape reserved for WP-19.

**Constraint.** A composed response serves **one workspace's purpose**. Combining unrelated bounded contexts because a screen shows them is how a read model becomes a parallel source of truth.

**Acceptance.** An operator can traverse successive records without refetching the queue; no N+1; no response mixes unrelated contexts.
