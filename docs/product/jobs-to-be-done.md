# Jobs-to-be-Done

> Phase 2 of `docs/program/MASTER-PROMPT.md`. Functional/emotional/social jobs per primary actor from `personas.md`, in situation → motivation → outcome form. Internal-user jobs are framed as operational jobs, not purchase jobs.

## Line A — B2C

**P1/P2 — Individual / frequent shopper**
- *Situation:* "I found something abroad that isn't sold in Iran, or is cheaper/better abroad."
- *Functional job:* Get the exact item, landed and paid for in Toman, without holding a foreign card or account.
- *Emotional job:* Not worry that the item is wrong, fake, or will silently vanish in transit.
- *Social job:* Be able to tell a friend "just paste the link, it's handled" — zero-explanation trust.
- *Success signal (blueprint):* completes checkout in one session; checks tracking without contacting support.
- *Current gap (Phase 0):* when the price changes or the item goes out of stock mid-flight, there is no job satisfied here at all — the customer isn't asked, they're just left waiting on an operator decision they can't see.

## Line B — Merchant

**P3/P4 — Social-commerce seller / small online merchant**
- *Situation:* "I already sell cross-border fulfillment manually, one DM at a time, and it doesn't scale."
- *Functional job:* Submit orders on customers' behalf and get resolution/pricing/procurement/tracking without running any of the ops myself.
- *Emotional job:* Not lose my customer relationship to the platform (hence Wholesaler-mode default hiding the source — `business-lines.md` §B).
- *Social job:* Look like a bigger, more capable operation to my own customers (branded tracking page).
- *Success signal (blueprint):* tops up wallet, submits orders, relays branded tracking.

**P7 — Organization owner (Line B)**
- *Situation:* "I'm the one financially accountable for this account."
- *Functional job:* Control who on my team can submit orders, see the wallet balance, and set markups.
- *Emotional job:* Trust that a departing staff member can be cut off without breaking in-flight orders.

## Line C — Enterprise

**P5/P6 — Company purchaser / enterprise procurement operator**
- *Situation:* "I need a large or recurring B2B order sourced, consolidated, and customs-cleared, and I don't want to run point on sourcing myself."
- *Functional job:* Submit a requirement (spec/BOM), get it quoted and procured by the platform's operators, track consolidated shipment status.
- *Emotional job:* Confidence the platform will de-risk payment (deposits/milestones, not full float exposure) and won't leave a large order stuck with no visibility.
- *Social job:* Be able to justify the vendor choice internally with clean, auditable documentation (finance approver's job, below, depends on this).

**P8 — Finance approver**
- *Situation:* "Spend above a threshold needs my sign-off before it happens."
- *Functional job:* See what's being ordered, at what price, and approve/reject before money moves.
- *Current gap:* no approval-workflow concept exists in the product today (`account-and-organization-model.md` flags this as platform-later) — this job is currently unservable for Line C.

## Internal / operational jobs

**I2 — Procurement operator**
- *Job:* "Clear the orders that actually need me, fast, and never touch the healthy ones" (`technical-blueprint-v1.md` verbatim). Manage-by-exception is a RULE (`CLAUDE.md`), not a preference — this job statement is why the back office defaults to the exception queue, not an order list.

**I1 — Support operator**
- *Job:* Resolve a customer's refund/support case with full order/ledger context, without reconstructing it from Slack/DMs. Currently has no surface to do this job at all (Phase 0 MISSING finding).

**I4 — Finance/reconciliation operator**
- *Job:* "Every rial and dirham reconciles; I can see FX exposure and float need" (`technical-blueprint-v1.md` verbatim). Success signal: high reconciliation match rate, no unmatched money.

**I5 — Compliance/risk operator**
- *Job:* Keep every order on the right side of personal-import limits, AML rules, and the "goods only, never net cross-border cash" RULE (`phase-0.3-logistics-feasibility.md` line 141) — proactively, not just by reviewing after the fact. No dedicated surface exists yet.

**I6 — System administrator**
- *Job:* Grant/revoke exactly the access a given internal or org user needs, and prove who could do what at any point in time (audit trail) — currently unservable beyond editing a raw role string (Phase 0 finding), which is also why this job motivates Phase 7 (RBAC) directly.

## Job priority note for Phase 3 (journey architecture)

The jobs with **no current product surface** — customer's price-changed/OOS decision, support/refund (I1 and the customer side), finance approval (P8), compliance proactive monitoring (I5), access administration (I6) — are exactly the set `mvp-vs-platform.md` and the Phase 0 capability matrix flagged as MISSING or PARTIAL. Phase 3 should treat these as first-class journeys to design, not afterthoughts bolted onto existing screens.
