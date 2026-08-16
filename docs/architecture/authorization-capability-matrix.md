# Authorization Capability Matrix

> Phase 7 of `docs/program/MASTER-PROMPT.md`. The required mapping: **ACTOR → JOB → RESOURCE → ACTION → PERMISSION → SCOPE → BACKEND ENFORCEMENT POINT → UI EFFECT → AUDIT REQUIREMENT.** Model and rationale: `docs/architecture/authorization-model.md`. Scope decision: `ADR-001`.
>
> **Enforcement point** names where the check lives. `EXISTS` = route exists and is role-gated today, however coarsely. **`NO ENDPOINT` / `NO CALLER` / `NO SURFACE`** = the capability has no application boundary at all — the Phase 6 orphans. Where a route exists but no permission is enforced on it, that is stated in full rather than labelled. (The `PLANNED` label was retired after review: defined as "endpoint exists," it was being applied to capabilities with no route, which hid two real gaps.) Recording unbuilt capabilities with their permission already assigned is the point of doing this before implementation.
>
> **Audit** column: `CMD` = full command audit (actor, permission, scope, resource, before/after, reason, correlation id); `READ+` = read that is itself audited; `—` = not audited.

## B2C customer — P1/P2 (`SELF` scope throughout)

| Actor | Job | Resource | Action | Permission | Scope | Enforcement point | UI effect | Audit |
|---|---|---|---|---|---|---|---|---|
| Customer | Get a price for a link | product request | resolve | *public* | — | `@Public` `commerce.module.ts:452` | Paste box open to all | — |
| Customer | See my orders | order | list/read | `order:read` | SELF | `OrderService.get` ownership compare → `NotFoundError` | `/orders` | — |
| Customer | Decide on a price change | order | approve/reject | `order:decide` | SELF | **NO ENDPOINT** (Phase 5 P0, J7) | decision panel on `/orders/:id` | **CMD** |
| Customer | Pay | payment | initiate | `payment:initiate` | SELF | `orders.startPayment`, idempotency-keyed | checkout | **CMD** |
| Customer | Manage addresses | address | create | `address:write` | SELF | `addresses.create` EXISTS | `/addresses` | — |
| Customer | Edit/delete an address | address | update/delete | `address:write` | SELF | **NO ENDPOINT** (Phase 5) | `/addresses` | — |
| Customer | Ask for help | support case | create/read | `support:read`, `support:write` | SELF | **NO ENDPOINT** (J8) | `/support` | — |
| Customer | Request a refund | refund | request | `refund:request` | SELF | **NO ENDPOINT** | case flow | **CMD** |
| Merchant's end customer (not a `User`) | Track a parcel | order | read one | *token-bearing* | single-resource | **NO ENDPOINT** (J9, Line B) | branded page | — |

**Ownership, not permission, decides *which* order.** `order:read` at `SELF` plus ownership filtering; a non-owner gets `404`, never `403` (model §10 — a `403` is an enumeration oracle).

## I2 — procurement / operations

| Actor | Job | Resource | Action | Permission | Scope | Enforcement point | UI effect | Audit |
|---|---|---|---|---|---|---|---|---|
| I2 | See what needs a human | exception | list | `exception:read` | PLATFORM | `@Roles('ops','admin')` `admin.module.ts:436` EXISTS | queue = home | — |
| I2 | Claim an item | exception | assign | `exception:assign` | PLATFORM | **NO ENDPOINT** — F3, `assignee` has no writer | assign control | **CMD** |
| I2 | Clear a benign exception | exception | resolve | `exception:resolve` | PLATFORM | **NO ENDPOINT** — F2, `resolveException` unreachable | resolve action | **CMD** |
| I2 | Rank the queue | exception | rank | `exception:rank` | PLATFORM | **NO CALLER** — F4, likely `system` actor | ordering | — |
| I2 | Find an order | order | search/read | `order:read` | PLATFORM | `OpsService.searchOrders` EXISTS | `/orders` | — |
| I2 | Move an order forward | order | transition | `order:transition` | PLATFORM | `POST orders/:id/transition`, `If-Match`, reason required | only legal edges offered | **CMD** |
| I2 | Raise a procurement ceiling | order | reprice | `order:reprice` | PLATFORM | `POST orders/:id/reprice`, `If-Match` | reprice action | **CMD** |
| I2 | See live buy context | procurement | read | `procurement:read` | PLATFORM | `GET procurements/:id/copilot` EXISTS | copilot | — |
| I2 | Record a purchase | procurement | confirm | `procurement:confirm` | PLATFORM | `POST procurements/:id/confirm` | confirm form | **CMD** |
| I2 | **Complete a stuck resolution** | product request | complete | `resolution:complete` | PLATFORM | **NO ENDPOINT — F9.** Nothing supplies `manualOverrides` | `/resolutions/:id` | **CMD** |
| I2 | **See resolutions needing review** | product request | list | `resolution:read` | PLATFORM | **NO ENDPOINT — F9.** `NEEDS_REVIEW` absent from `apps/api/src` | `/resolutions` | — |
| I2 | Check provider health | provider | read | `provider:read` | PLATFORM | `GET providers` EXISTS (no screen) | health page | — |
| I2 | Look up a customer | customer | read | `customer:read` | PLATFORM | **NO ENDPOINT** — no customer route exists on `AdminController` | `/customers` | — |

## I3 — logistics *(role does not exist today — F5)*

| Actor | Job | Resource | Action | Permission | Scope | Enforcement point | UI effect | Audit |
|---|---|---|---|---|---|---|---|---|
| I3 | Work shipment/customs holds | exception | read/assign/resolve | `exception:read/assign/resolve` | PLATFORM | EXISTS as `ops`; **no `logistics` role** | filtered queue | **CMD** on commands |
| I3 | Advance a shipment | order | transition | `order:transition` | PLATFORM | EXISTS as `ops` | legal edges | **CMD** |
| I3 | **Must not reprice** | order | reprice | *withheld* | — | today any `ops` can — F5 | action absent | — |
| I3 | Map an unknown carrier status | config | write | **`config:carrier-mapping`** (narrow — *not* `config:write`, which would also confer rate-card editing) | PLATFORM | **NO ENDPOINT** — `normalizeCarrierStatus` logs for a human | mapping form | **CMD** |

Withholding `order:reprice` is the concrete reason `logistics` must exist as a distinct composition: repricing is a commercial decision, and today it is available to every ops operator by accident of the flat role string.

## I1 — customer support *(no surface, no role today)*

| Actor | Job | Resource | Action | Permission | Scope | Enforcement point | UI effect | Audit |
|---|---|---|---|---|---|---|---|---|
| I1 | Work the case queue | support case | list/read | `support:read` | PLATFORM | **NO ENDPOINT** | `/support` | — |
| I1 | Reply / resolve | support case | respond/resolve | `support:respond`, `support:resolve` | PLATFORM | **NO ENDPOINT** | case thread | **CMD** |
| I1 | See order context | order | read | `order:read` | PLATFORM | route EXISTS (`GET admin/orders/:id`); permission not yet enforced | order panel | — |
| I1 | See what was charged | ledger, payment, refund | read | `ledger:read`, `payment:read`, `refund:read` | PLATFORM | `ledger:read` EXISTS (role-gated); **`payment:read`/`refund:read` NO ENDPOINT** | finance panel | `READ+` on ledger |
| I1 | **Issue a refund** | refund | issue | `refund:issue` | PLATFORM | **NO ENDPOINT**; port method has no callers | refund action | **CMD** |

**`refund:issue` is not in `support`'s default composition** (model §8). A support operator resolves cases; moving money is a separate grant. Least-privilege review flagged the consequence: without a defined escalation path, "resolve a case requiring a refund" becomes impossible for the default role — **carried to Phase 10 as an open decision**, not silently accepted.

## I4 — finance / reconciliation — *the F1 case*

| Actor | Job | Resource | Action | Permission | Scope | Enforcement point | UI effect | Audit |
|---|---|---|---|---|---|---|---|---|
| I4 | Read the ledger | ledger | read | `ledger:read` | PLATFORM | `@Roles('finance','admin')` `admin.module.ts:530` EXISTS | `/finance` | **READ+** |
| I4 | See balances / FX exposure | ledger | read | `ledger:read` | PLATFORM | `:536` EXISTS | balances | **READ+** |
| I4 | **Investigate what a `refId` refers to** | order | read | `order:read` | PLATFORM | **BLOCKED TODAY — F1.** Method-level `@Roles` replaces class-level, so `finance` reaches no order endpoint | order context panel | — |
| I4 | See the customer behind an entry | customer | read | `customer:read` | PLATFORM | **NO ENDPOINT** (and would be role-blocked regardless — F1) | customer panel | — |
| I4 | Match / flag a settlement | reconciliation | read/resolve | `reconciliation:read/resolve` | PLATFORM | **NO ENDPOINT** — table exists, no service | `/reconciliation` | **CMD** |
| I4 | Trace payments and refunds by order | payment, refund | read | `payment:read`, `refund:read` | PLATFORM | **NO ENDPOINT** — only raw ledger by `refId` | `/payments`, `/refunds` | — |
| I4 | **Must not manage orders** | order | transition/reprice | *withheld* | — | withheld by composition | actions absent | — |
| I4 | **Must not adjust the ledger** | ledger | adjust | `ledger:adjust` | — | **no holder by design** | absent | **CMD** if ever granted |

This row set is the model's justification. Under today's roles the third row is impossible without granting the entire admin controller; under the new model it is `order:read` at `PLATFORM` **without** `order:transition` — investigation authority without action authority.

## I5 — compliance / risk *(no surface, no role today)*

| Actor | Job | Resource | Action | Permission | Scope | Enforcement point | UI effect | Audit |
|---|---|---|---|---|---|---|---|---|
| I5 | Review flagged orders | compliance flag | list/read | `compliance:read` | PLATFORM | **NO ENDPOINT** | `/compliance` | — |
| I5 | Clear a false positive | compliance flag | clear | `compliance:clear` | PLATFORM | **NO ENDPOINT** | clear + reason | **CMD** |
| I5 | Escalate / hold | compliance flag, order | escalate | `compliance:escalate` | PLATFORM | **NO ENDPOINT** | hold action | **CMD** |
| I5 | See patterns across customers | order, customer | read | `order:read`, `customer:read` | PLATFORM | order route EXISTS; **customer route NO ENDPOINT** | cross-order view | **READ+** |
| I5 | Read the audit trail | audit | read | `audit:read` | PLATFORM | **NO SURFACE** — data exists | `/audit` | **READ+** |

Cross-customer visibility is inherent to detecting structuring (AP2) and is the second-strongest argument, after F1, for `PLATFORM` scope existing as a first-class concept rather than being emulated.

## I6 — system administrator

| Actor | Job | Resource | Action | Permission | Scope | Enforcement point | UI effect | Audit |
|---|---|---|---|---|---|---|---|---|
| I6 | Manage internal users | user | list/create/update | `user:read`, `user:manage` | PLATFORM | **NO ENDPOINT** | `/admin/users` | **CMD** |
| I6 | Grant / revoke roles | role assignment | grant/revoke | `role:grant` | PLATFORM | **NO ENDPOINT** | `/admin/roles` | **CMD** |
| I6 | Deactivate a leaver | user | deactivate | `user:manage` | PLATFORM | **NO ENDPOINT** | deactivate (never delete) | **CMD** |
| I6 | Edit configuration | config | read/write | `config:read/write` | PLATFORM | **NO ENDPOINT** | `/config` | **CMD** |
| I6 | **Activate a rate card** | config | activate | `config:activate` | PLATFORM | **NO ENDPOINT** | activate + effective date | **CMD** |
| I6 | Quarantine a provider | provider | control | `provider:control` | PLATFORM | **NO ENDPOINT** — health is read-only | control actions | **CMD** |
| I6 | Read the audit log | audit | read | `audit:read` | PLATFORM | **NO SURFACE** | `/audit` | **READ+** |
| I6 | Operate sandbox sessions / clock | sandbox | operate | `sandbox:operate` | PLATFORM | **D1 — UNAUTHENTICATED TODAY**, `@Public` class-level, not env-gated | `/sandbox` | **CMD** |
| I6 | **Must not silently gain ops authority** | order, refund | transition/issue | *withheld* | — | withheld by composition | absent | — |

`admin` is not a superset (model §6). Combined duties are two grants, which leaves evidence in the audit trail.

## System actor — non-HTTP

| Actor | Job | Resource | Action | Permission | Scope | Enforcement point | UI effect | Audit |
|---|---|---|---|---|---|---|---|---|
| `system` | React to `order.paid` | order | transition | `order:transition` | PLATFORM | worker consumer, **no actor today** | — | **CMD** attributed to `system` |
| `system` | Raise an exception | exception | create | `exception:write` | PLATFORM | worker `exception.raised` | appears in queue | **CMD** |
| `system` | Rank the queue | exception | rank | `exception:rank` | PLATFORM | **NO CALLER** — F4 | ordering | — |
| `system` | Ingest carrier status | order | transition | `order:transition` | PLATFORM | `shipment.leg_updated` | timeline | **CMD** |
| `system` | Send a notification | notification | send | `notification:send` | PLATFORM | **NO CONSUMER** — port unwired | — | — |

Naming a `system` principal is not gatekeeping the worker — it is so the audit trail distinguishes an automated transition from an operator's, which matters when reconstructing what happened to an order.

## Future: Line B / C organization actors *(seams only)*

| Actor | Job | Resource | Action | Permission | Scope | Enforcement | UI | Audit |
|---|---|---|---|---|---|---|---|---|
| Org owner (P7) | Invite/remove staff | membership | manage | `member:manage` | ORGANIZATION | not built | org settings | **CMD** |
| Org owner | Set member roles | role assignment | grant | `role:grant` | ORGANIZATION | not built | org roles | **CMD** |
| Merchant (P3/P4) | Submit and track orders | order | create/read | `order:write`, `order:read` | ORGANIZATION | not built | merchant panel | — |
| Merchant staff | Read only their org's orders | order | read | `order:read` | ORGANIZATION | not built | scoped list | — |
| **P5 company purchaser** | Submit a purchase request against a spec/BOM | order | create/read | `order:write`, `order:read` | ORGANIZATION | not built (Line C) | request form | **CMD** on create |
| **P5 company purchaser** | Track what was ordered for my department | order | read | `order:read` | ORGANIZATION | not built | scoped list | — |
| **P6 enterprise procurement operator** | Manage a portfolio of requests | order | read/transition | `order:read`, `order:transition` | ORGANIZATION | not built (Line C) | desk view | **CMD** |
| **P6 enterprise procurement operator** | See consolidated shipment status | order | read | `order:read` | ORGANIZATION | not built | consolidation view | — |
| Finance approver (P8) | Approve spend | approval | approve | `approval:decide` | ORGANIZATION | **no entity exists** (Phase 2 gap) | approval queue | **CMD** |

`ORGANIZATION` scope filters unconditionally — no special case, which is what ADR-001 buys. Cross-tenant reads require `PLATFORM`.

## Summary of enforcement status

| Status | Count | Meaning |
|---|---|---|
| `EXISTS` | 9 | route exists and is role-gated today, however coarsely |
| `BLOCKED TODAY` | 2 | **F1** — the model makes the documented job impossible |
| route exists, permission unenforced | 2 | `order:read` for I1/I5 — the route is there; the permission is not |
| **`NO ENDPOINT` / `NO CALLER` / `NO SURFACE`** | ~27 | no application boundary — includes all four Phase 6 orphans |

*(Counts corrected after independent review, which found the originals — `EXISTS 11`, `PLANNED 5`, `30+` — overstated, and found `PLANNED` being used for capabilities with no route at all, contradicting the legend. The `PLANNED` label is retired: a status meaning "endpoint exists **or is trivial**" was doing two jobs and hid the customer-lookup and payment/refund gaps.)*

**The dominant category is capabilities with no application boundary.** That is the accurate state of the system and the reason this matrix exists before implementation: every one of those rows now has its permission, scope, and audit requirement decided, so the endpoint arrives authorized rather than retrofitted — which is how the current coarse model came about.

**None of it is implemented in this phase.** Work items are listed in `authorization-model.md` §16 as Phase 10/12 input.
