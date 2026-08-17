# /goal — WP-08 Operational query correctness

Work in `~/Desktop/shop-wp08` (branch `feature/wp-08`). Run `pnpm install` in `platform/` first.

WP-08 is fully implemented and verified per `docs/program/work-packages/WP-07-to-WP-10-tranche-2.md` (WP-08 section).

**This package is database and query correctness. It gates WP-12 and must land before any ranking work.**

## Before changing code

1. Read the WP-08 section, then the query rows in `docs/program/journey-capability-traceability.md` §11.
2. Read `packages/db/src/repositories.ts` — specifically `OrderRepository.search` and `ExceptionRepository.listOpen` — and `packages/contracts/src/schemas.ts:307-330`.
3. **Enumerate, do not sample.** Derive from source: every repository method and whether it has a caller; every query that joins; every default in `adminOrderSearchQuery`; every place a cursor is constructed or consumed.

## What you own

**G-46 — order search returns duplicate rows.** The row query `leftJoin`s unresolved exceptions (`repositories.ts:284`) so an order with N exceptions yields N rows, while `total` uses `count(DISTINCT orders.id)` (`:290`). Rows and count disagree and offset paging shifts.

**G-47 — the exception cursor is inconsistent with its sort.** Cursor is `lt(exceptions.id)` (`:635`); sort is `desc(rank), desc(id)` (`:641`). It is correct **only because every rank is currently identical**. This is why WP-08 gates WP-12: implementing ranking first silently corrupts pagination. The admin client also never sends a cursor (`apps/admin/lib/api.ts:120-124`), capping the queue at 20 with no "more".

**G-52 — eight repository methods have no caller:** `findByOrder`, `findByPhone`, `listByOrder`, `listByRef`, `listEvents`, `purgeExpired`, `purgeOlderThan`, `updateRanks`. **Wire or delete each; do not leave built-and-unreachable.** Two of them — `listByRef` and `listEvents` — are the payments-by-order and shipment-timeline reads the IA lists as MISSING, so deleting those would be wrong; decide per method with a stated reason.

## What you must not do

- **Do not implement ranking.** `updateRanks` may be wired to a caller only if that does not change ordering semantics; the ranking *policy* is WP-12.
- **Do not add exception commands** — assign, claim, resolve are WP-12.
- **Do not change the finance/ledger queries** — WP-09.
- **Do not touch `apps/api/src/domain/order-state-machine.ts`** — WP-04 owns it in a parallel branch.

## Tests

An order with **two** unresolved exceptions returns **one** row and a matching total. Cursor pagination is correct **under non-uniform ranks** — seed them deliberately, since uniform ranks are exactly what hides the bug. No page skips or repeats across the full result set. Every previously-orphaned method is either called by a test-reachable path or gone.

Run full `vitest` and `turbo typecheck`. Baseline: **165 tests / 8 files, 16/16**. Note the DB-backed tests may need `docker compose up -d` — if you cannot run them, say so explicitly rather than claiming a pass.

## Reviews

Self-review, then adversarial review hunting: a join that still multiplies rows under some filter; a cursor that skips or repeats under any sort; an orphan method left unresolved; ranking semantics changed by stealth; pagination correct only for uniform data.

## Bookkeeping

**Do not edit shared program-state documents.** Record changes in `docs/program/work-packages/completions/WP-08-completion.md`.

Commit once, descriptively, and stop.
