# State Matrix

> Phase 3 of `docs/program/MASTER-PROMPT.md`. Two matrices: (1) the 24-state order machine × who can see/act on each state, verified against `platform/apps/api/src/domain/order-state-machine.ts`; (2) the standard UI-state pattern (loading/empty/validation/missing-data/outage/permission/cancel/retry/recovery/async/notification) each journey in `docs/ux/journey-map.md` must implement, so no journey silently drops a required state.

## 1. Order-state visibility & actions

Source of truth: `TRANSITIONS` (`order-state-machine.ts:15-49`), `EXCEPTION_STATES` (51-59), `TERMINAL_STATES` (61), `ALERTS`/`actionable` (213-278), `STATE_TO_STEP_INDEX` (148-161).

Columns: **Customer sees** = what the 8-step normalized timeline (`buildCustomerTimeline`) or an `ALERTS` banner shows. **Customer decides** = whether `alertFor(state).actionable` is `true` today (J7 target) or the state is purely informational. **I2/I3 ops** = queue/transition visibility (J10/J11). **I1 support** = J12 (all NEW). **I4 finance** = J13, ledger-adjacent states only. **Legal next states** = exact `TRANSITIONS[state]`.

| State | Category | Customer sees (timeline step) | Customer decides? | I2/I3 ops | I1 support | I4 finance | Legal next states |
|---|---|---|---|---|---|---|---|
| `DRAFT` | forward | pre-timeline (not yet a visible order) | no | queue: no (not an exception) | no | no | `QUOTING`, `CANCELLED` |
| `QUOTING` | forward | pre-timeline | no | no | no | no | `QUOTED`, `OUT_OF_STOCK` |
| `QUOTED` | forward | pre-timeline (quote screen, J2) | no | no | no | no | `AWAITING_PAYMENT`, `PRICE_CHANGED`, `CANCELLED` |
| `AWAITING_PAYMENT` | forward | step index `-1` (pre-`CONFIRMED`) | n/a — retry is the action (J5), not a decision | no | no | no | `PAID`, `PAYMENT_FAILED`, `CANCELLED` |
| `PAID` | forward | step 0 (`CONFIRMED`) | no | no | no | yes — ledger entry created | `PROCUREMENT_PENDING` only (structural Payment≠Purchased invariant) |
| `PROCUREMENT_PENDING` | forward | step 0 (`CONFIRMED`) | no | yes — exception source | no | no | `PURCHASED`, `PRICE_CHANGED`, `OUT_OF_STOCK`, `PROCUREMENT_FAILED` |
| `PURCHASED` | forward | step 1 (`PURCHASED`) | no | yes — exception source | no | yes — procurement cost posted | `SELLER_PROCESSING`, `PROCUREMENT_FAILED` |
| `SELLER_PROCESSING` | forward | step 2 (`DISPATCHED`) | no | yes | no | no | `LOCAL_TRANSIT`, `SHIPMENT_EXCEPTION` |
| `LOCAL_TRANSIT` | forward | step 2 (`DISPATCHED`) | no | yes | no | no | `WAREHOUSE_RECEIVED`, `SHIPMENT_EXCEPTION` |
| `WAREHOUSE_RECEIVED` | forward | step 3 (`AT_WAREHOUSE`) | no | yes | no | no | `INTERNATIONAL_TRANSIT`, `SHIPMENT_EXCEPTION` |
| `INTERNATIONAL_TRANSIT` | forward | step 4 (`INTERNATIONAL`) | no | yes | no | no | `CUSTOMS`, `SHIPMENT_EXCEPTION` |
| `CUSTOMS` | forward | step 5 (`ARRIVED_IRAN`) | no | yes | no | no | `DOMESTIC_TRANSIT`, `CUSTOMS_EXCEPTION` |
| `DOMESTIC_TRANSIT` | forward | step 6 (`OUT_FOR_DELIVERY`) | no | yes | no | no | `DELIVERED`, `SHIPMENT_EXCEPTION`, `CUSTOMER_ACTION_REQUIRED` |
| `DELIVERED` | **terminal** | step 7 (`DELIVERED`) | no | no (closed) | possible post-delivery case (J8/J12) | no | none |
| `PRICE_CHANGED` | **exception** | banner, `actionable: true` | **yes — J7** | yes — reprice/transition (J10/J11) | possible (J12) | possible (price delta) | `PROCUREMENT_PENDING`, `REFUND_PENDING`, `CANCELLED` |
| `OUT_OF_STOCK` | **exception** | banner, `actionable: false` | no — informational, auto-refund path | yes | possible (J12) | yes — refund posting | `REFUND_PENDING`, `CANCELLED` |
| `PAYMENT_FAILED` | **exception** | banner, `actionable: true` (retry) | yes — retry is the decision (J5) | no (customer self-service) | possible (J12, if retries exhausted) | no | `AWAITING_PAYMENT`, `CANCELLED` |
| `PROCUREMENT_FAILED` | **exception** | banner, `actionable: false` | no — informational | yes | possible (J12) | no | `PROCUREMENT_PENDING`, `REFUND_PENDING` |
| `CUSTOMER_ACTION_REQUIRED` | **exception** | banner, `actionable: true` | **yes — J7** (supply info) | yes | possible (J12) | no | `DOMESTIC_TRANSIT`, `REFUND_PENDING`, `CANCELLED` |
| `SHIPMENT_EXCEPTION` | **exception** | banner, `actionable: false` | no — informational | yes | possible (J12) | no | `LOCAL_TRANSIT`, `WAREHOUSE_RECEIVED`, `INTERNATIONAL_TRANSIT`, `DOMESTIC_TRANSIT`, `REFUND_PENDING` |
| `CUSTOMS_EXCEPTION` | **exception** | banner, `actionable: true` | **yes — J7** (supply document / cancel) | yes | possible (J12) | no | `DOMESTIC_TRANSIT`, `CUSTOMER_ACTION_REQUIRED`, `REFUND_PENDING` |
| `REFUND_PENDING` | forward-terminal-ish | banner, `actionable: false` | no — already decided | yes (monitors) | yes (J12/J8) | yes — refund execution | `REFUNDED` only |
| `REFUNDED` | **terminal** | (no banner defined — gap, see §3) | no | no | closes case | yes — ledger closed | none |
| `CANCELLED` | **terminal** | (no banner defined — gap, see §3) | no | no | possible reversal check | possible | none |

**Cross-checks this table surfaces:**
- Every state with `actionable: true` (`PRICE_CHANGED`, `PAYMENT_FAILED`, `CUSTOMER_ACTION_REQUIRED`, `CUSTOMS_EXCEPTION`) has a customer decision path — J5 already implements `PAYMENT_FAILED`'s; J7 must implement the other three. No `actionable: true` state is left without a design in this program.
- `REFUND_PENDING → REFUNDED` is the *only* legal edge out of `REFUND_PENDING` — meaning every refund-triggering exception (`PRICE_CHANGED`, `OUT_OF_STOCK`, `PROCUREMENT_FAILED`, `CUSTOMER_ACTION_REQUIRED`, `SHIPMENT_EXCEPTION`, `CUSTOMS_EXCEPTION`) converges on one execution path (J8/J12's refund action) — confirms there is exactly one refund mechanism to build, not several.
- I3 (logistics) has no column distinct from I2 here because the code has no distinct role for it — matches `personas.md`'s note that I3 "folds into ops surface for now," and is itself a J15 (RBAC) gap worth closing before it causes an over-broad-access incident.

## 2. Terminal-state customer messaging gap

`ALERTS` (`order-state-machine.ts:213-278`) defines banner copy for all seven exception states plus `REFUND_PENDING`, but **not** for `REFUNDED` or `CANCELLED` — a customer landing on either terminal state via the timeline gets no explicit closing message, only the absence of a banner. This is a small, concrete gap (not previously called out in Phase 0/1/2 docs): add `ALERTS.REFUNDED` / a cancellation-confirmation message so every terminal state has explicit customer-facing closure, consistent with the "no dead ends" principle applied to messaging, not just navigation.

## 3. Standard UI-state pattern per journey

MASTER-PROMPT §PHASE 3 requires loading, validation, empty, missing-data, provider-outage, permission-denial, cancellation, retry, recovery, async-waiting, notification, and support-escalation treatment for every journey. Rather than re-deriving this per journey (already done in full in `journey-map.md`), this table is the compact cross-reference — one row per journey, one cell per state category, pointing back to the journey-map row for detail. Use this to spot gaps at a glance; use `journey-map.md` for the actual design.

| Journey | Loading | Empty | Validation | Missing data | Outage | Permission | Cancel | Retry | Recovery | Async | Notify | Support |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| J1 resolve | E | n/a | E | N (Phase 4) | E | n/a | E | E | E | E | n/a | N |
| J2 quote | E | n/a | E | E | E | n/a | E | E | E | n/a | n/a | N |
| J3 auth | E | n/a | E | n/a | N | n/a | E | E | E | E | E (OTP only) | N |
| J4 address | N | N | N | n/a | n/a | E | N | N | N | n/a | n/a | n/a |
| J5 checkout/pay | E | n/a | E | n/a | E | n/a | E | E | P (dup callback) | E | N | N |
| J6 tracking | E | E | n/a | E | E | E | n/a | E | n/a | P | N | N |
| J7 decision | N | n/a | N | N | n/a | N | N (=reject) | N | N | E (waiting=state) | N | N |
| J8 support | N | N | N | n/a | n/a | N | N | N | N | N | N | n/a (is escalation) |
| J10 queue | E | E (positive) | E | P | n/a | P (flat role) | n/a | E | E | n/a | N | n/a |
| J11 transition | E | n/a | E | n/a | n/a | P | E | E | E (no-undo by design) | n/a | N | n/a |
| J12 support-ops | N | N | N | N | N | N | n/a | N | N | N | N | n/a |
| J13 reconciliation | P | P | E | N | P | P | n/a | P | N | E | N | n/a |
| J14 compliance | N | N | n/a | N | n/a | N | n/a | n/a | N | n/a | N | n/a |
| J15 RBAC | N | n/a | N | n/a | n/a | E→N | N | N | N | n/a | N | n/a |

**Reading the table:** columns dominated by `N` across most rows (Notify, and every column in J4/J8/J12/J14/J15) confirm the two structural gaps already named in `journey-map.md`: the missing notification system, and the missing support/refund/compliance/RBAC operator surfaces. No new category of gap emerges from this cross-reference beyond what journey-map.md already found — which is itself a useful confirmation that the per-journey modeling was complete, not that a summary table was redundant.

## 4. What this feeds next

- Phase 4 (`docs/product/product-resolution.md`) resolves the "Missing data" `N` on J1/J2 with a formal provenance model.
- Phase 5 (front office IA) and Phase 6 (backoffice operating model) turn every `N`/`P` UI cell above into actual screens.
- Phase 7 (RBAC) resolves every `P`/`N` in the Permission column, most acutely I3's missing distinct scope and J14/J15's need for entirely new roles.
- Phase 10 (backend/API) resolves every `N` API implied by `service-blueprint.md`'s **N**-tagged rows — the notification port binding is the single highest-leverage item, since it unblocks Notify cells across nearly every journey at once.
- Phase 11 traceability matrix supersedes §1/§3 above with a fully wired journey→screen→API→domain→persistence→adapter→permission→test table once those phases exist.
