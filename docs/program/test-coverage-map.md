# Test Coverage Map

> Phase 11 of `docs/program/MASTER-PROMPT.md`. What is tested, what is not, and what must be tested with each Phase 12 work item.

## Executed baseline

| Check | Command | Result |
|---|---|---|
| Tests | `npx vitest run` | **132 passed / 6 files / 0 failed** |
| Typecheck | `npx turbo typecheck` | **16/16 packages** |

**Interpretation (Phase 11 §21).** These establish a **regression baseline only**. They do not prove correctness of untested areas, and **a green suite must never be used to downgrade a source-verified defect.** Every P0 in `gap-register.md` sits outside the tested surface.

## What the 132 tests cover

| Suite | Tests | Covers |
|---|---|---|
| `packages/core/src/money.test.ts` | 21 | `Money` arithmetic, currency mismatch |
| `packages/validation` | 14 | bilingual validation |
| `packages/sandbox` | 42 | scenario playback, session, clock |
| `packages/commerce` | 26 | resolution pipeline, merge, procurement guard |
| `packages/resilience` | 17 | breaker, retry, failover |
| `apps/api/.../auth.otp.test.ts` | 12 | OTP issuance, provider refusal in production |

**Structural observation:** coverage is strongest in **pure packages** and near-absent in **application and domain wiring**. `apps/api` has exactly one test file; `apps/worker` and `apps/admin` have none.

## What is not tested — mapped to gaps

| Untested area | Gap | Why it matters |
|---|---|---|
| **`order-state-machine.ts` — no test file at all** | G-07/08/09 | The 51-edge graph containing every domain P0 is unasserted. Illegal edges pass typecheck because nothing checks them |
| **`settlePayment`** | G-03/04 | All three settlement routes, the ledger post, and the double transition are untested |
| Sandbox security (disabled behaviour, expired session) | G-01/02/03 | Fail-open paths |
| Sandbox tag provenance | G-05 | The live concealment channel |
| Ledger isolation from sandbox | G-06 | Sandbox money in production balances |
| Callback verification | G-04/23 | `verifyWebhook` never exercised |
| `once()` retry semantics | G-11 | At-most-once vs documented at-least-once |
| Manual resolution | G-10 | Nothing to test yet — but the test must land with it |
| Finance investigation chain | G-18 | |
| **rial→toman boundary** | G-33/34 | A 10× display error would pass every existing test |
| State→presentation totality | G-19/20 | 12/24 and 21/24 coverage invisible to tests |
| Idempotency on admin money commands | G-40 | |
| Authorization matrix | G-13 | No test asserts who may call what |

## Test requirements per P0

Phase 12 must land these **with** the fix, not after:

| Gap | Required tests |
|---|---|
| G-01/02/03 | disabled → 404 (not 403); header ignored when disabled; expired session **fails closed**; control routes reject anonymous |
| G-04 | webhook reachable without bearer; invalid signature → 401; **enumerate all three settlement routes** |
| G-05 | forged `x-sandbox-session` rejected; real order never tagged |
| G-06 | sandbox order at `PAID` → balances **unchanged** |
| G-07/08 | **property test over all 51 edges**: no `REFUND_PENDING` without settled payment; no `CANCELLED` from a paid state without refund |
| G-09/10 | full manual-resolution vertical: review → override → resume → quote or reject → terminal |
| G-11 | throwing handler **is** redelivered |
| G-12 | production composition registers ≥1 strategy |
| G-19/20 | **totality tests**: every one of 24 states has a step index and a badge |

## Suite-level requirements

- **Exhaustiveness over sampling.** The state machine needs a test that iterates all 24 states and all 51 edges, not a handful of representative cases — the same enumeration discipline this phase applies to analysis.
- **No `sleep()`** for time-dependent behaviour; advance the virtual clock. Blocked today: quote expiry uses real `Date.now()`.
- **Sandbox parity** must assert **runtime** adapter selection, not binding-time construction — `instanceof` is insufficient.
- **`apps/worker` has no test infrastructure**; G-11 cannot be tested until it does.
