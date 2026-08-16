# Authorization Model

> Phase 7 of `docs/program/MASTER-PROMPT.md`. **Architecture and migration design only — no implementation.** Discovered implementation work is recorded as Phase 10/12 input, not performed.
>
> **Attribution note.** Where this document says "the phase goal requires/names X," it refers to the **Phase 7 acceptance criteria issued for this phase**, which are broader than MASTER-PROMPT §PHASE 7's own text (lines 643-668). MASTER-PROMPT supplies the Permission/Role/RolePermission/UserRole/Scope/Audit-trail entity list and the backend-authoritative rule; the sandbox, membership-lifecycle, `order:read`≠`order:transition`, and direct-API-bypass requirements come from the acceptance criteria. An earlier draft cited both as "the phase goal" without distinguishing them.
>
> Decides: `docs/adr/ADR-001-internal-ops-is-not-an-organization.md`. Companion: `docs/architecture/authorization-capability-matrix.md` (the full ACTOR→…→AUDIT matrix). Inputs: Phase 2 account model, Phase 6 operating model (findings F1–F9), Phase 3 journeys J10–J15.

## 1. Current state — verified

**Role-based** authorization in the API is **three annotations** (corrected after review: an earlier draft said "the entire authorization surface," which is false by this section's own text — ownership checks are authorization too, and customers are signed `role: 'customer'` (`auth.module.ts:209,315`), so operators and customers share one role namespace):

| Location | Annotation | Effect |
|---|---|---|
| `admin.module.ts:436` | `@Roles('ops','admin')` (class) | all admin endpoints |
| `admin.module.ts:530,536` | `@Roles('finance','admin')` (method) | ledger, balances |

Everything else is either default-deny authenticated (`JwtAuthGuard`, `http.ts:226-229` — "every route requires authentication unless explicitly marked `@Public()`", correctly inverted) or explicitly `@Public()` (**11** sites: auth ×4, commerce ×4, sandbox class-level, dev-gateway, app health).

The actor is `{id, kind: 'customer'|'operator', role: string}` (`http.ts:197-201`), issued into the JWT as `{kind, role}` (`auth.module.ts:233-241`). The check is `required.includes(actor.role)` — **string membership, one role per user, no composition** (`http.ts:256`).

**Roles are unvalidated anywhere.** The JWT signs `operator!.role` straight from the database (`auth.module.ts:363`). The `as 'ops' | 'finance' | 'admin'` at `:372` is a cast on the *response DTO*, not a constraint on the token or the column — an earlier draft of this document cited it as if it constrained the role set, which it does not. A typo'd or injected role string in the `operators` table would flow into a token unchecked; today it would simply fail every `includes()` check, but under a permission model an unrecognized role must be an explicit deny, never a lookup miss that silently grants nothing *or* something.

**Two structural properties of today's model that the new one must preserve:**
- **Default-deny.** New endpoints are protected until someone opts them out. Keep exactly this.
- **Ownership scoping is separate from role checking.** `OrderService.get` compares the order's customer to the caller and raises `NotFoundError` on mismatch — which is why `OpsService.getOrder` had to exist at all. Ownership is *not* a permission; see §4.

### 1a. Two authorization defects found this phase

**D1 — The sandbox API is unauthenticated, ungated, and fails open (P0).** `SandboxController` is `@Public()` at class level (`sandbox.module.ts:111`) with no environment check, and `SandboxModule` is registered unconditionally (`app.module.ts:42`). Anyone who can reach the API can create sandbox sessions, advance the virtual clock, and delete sessions (`@Delete('sessions/:id')`).

**Worse than first reported — the flag fails open.** `SANDBOX_ENABLED` is declared `.optional().transform((v) => v !== 'false')` (`packages/contracts/src/env.ts:63-67`), so an **unset** variable yields `true`. Its own doc comment reads "Off in production." It is therefore: on by default, contradicted by its comment, and referenced in exactly one place — a startup log line (`main.ts:91`). It gates nothing. A flag that defaults to on, claims to default to off, and controls nothing is worse than no flag, because it reads as a control during review.

Compare `dev-gateway.module.ts:38-44`, which does this correctly: it throws `NotFoundError` → **404** in production, and its comment opens "A 404 rather than a 403," explaining that "a 403 confirms there is a development payment gateway on this host and invites someone to go looking for a way in." (An earlier draft of this document quoted only the second half and described the behaviour as a 403 — inverting the code's actual reasoning. Corrected.) The sandbox module never got the same treatment.

**This tensions with §10's `403` rule**, and the tension is resolved by the existence question: a `403` naming the required permission is right for an **authenticated operator on a route they know exists**; a `404` is right whenever the response would otherwise confirm the existence of a resource or route the caller should not know about. Ownership failures (`404`, already implemented at `commerce.module.ts:399`) and environment-gated dev routes are the latter. §10 is amended accordingly.

**D2 — Method-level `@Roles` silently replaces class-level, never intersects.** `reflector.getAllAndOverride([handler, class])` (`http.ts:253-256`) returns the *first* match. So `@Roles('finance','admin')` on a method inside a `@Roles('ops','admin')` controller means finance|admin **instead of**, not in addition to. This produced Phase 6's F1: a finance operator can reach only the two finance endpoints and cannot look up the order a ledger entry refers to. The guard is correct; the model is too coarse to express the requirement. §7 defines the migration that removes this footgun.

## 2. Concepts — kept distinct

The phase goal requires these be explicit. They are genuinely different things and conflating any two produces a class of bug:

| Concept | Question it answers | Today |
|---|---|---|
| **Authentication** | Is this request from who it claims? | JWT verify → `AuthenticatedActor` |
| **Identity (`User`)** | Which human is this, across all contexts? | split across `customers` / `operators` tables |
| **Account context** | Which *hat* is this user wearing right now — personal, or acting for org X? | absent; `kind` is a proxy |
| **Organization membership** | Does this user belong to that tenant, and in what capacity? | absent |
| **Role** | A named bundle of permissions | a single string |
| **Permission** | May this capability be exercised? | absent — roles are checked directly |
| **Scope** | Over *which* data does this grant apply? | absent |
| **Ownership** | Is this specific record this actor's own? | ad-hoc per service |

**The critical separation is Role ≠ Permission.** Today an endpoint asks "is your role in this list," which hardcodes policy into every call site. The new model asks "do you hold this permission," and roles become a *composition* of permissions maintained in one place. This is what prevents role explosion (§6) and what makes F1 fixable without inventing a `finance-plus-order-reader` role.

**Ownership is not a permission.** `order:read` says an actor may read orders *of the kind their scope allows*; it does not say *which* order. A customer holding `order:read` reads their own orders because ownership filtering applies underneath. Merging the two would mean minting a permission per record.

## 3. Scopes

Three scope kinds. Two are introduced now; the third is reserved and deliberately not built.

- **`PLATFORM`** — grants apply across all tenants and all customers. Held only by internal operators (ADR-001). This is what makes cross-tenant investigation possible and is the reason internal ops is not an Organization.
- **`ORGANIZATION:<id>`** — grants apply only to data belonging to that organization. Line B/C. Modeled now, unpopulated at MVP.
- **`SELF`** — grants apply only to the actor's own records. Every B2C customer. Not stored as rows; it is the implicit scope of a `PersonalAccount` holder.
- **`TEAM`** — *reserved, not introduced.* Per ADR-001's open question: no evidence yet of a permission a team boundary would grant differently. Introducing it speculatively is role explosion by another name.

**Scope is evaluated after permission, never instead of it.** A grant is `(permission, scope)`. Holding `order:read` at `SELF` and holding it at `PLATFORM` are different grants with the same permission name — which is precisely how a finance operator gets order context without gaining order-management rights (§5).

## 4. The permission vocabulary

Permissions name **business capabilities**, not endpoints. The phase goal is explicit that one-permission-per-HTTP-route is wrong unless the domain justifies it, and it does not here: `GET /admin/orders` and `GET /admin/orders/:id` are one capability (`order:read`) viewed two ways.

**The resource/command split is load-bearing**, and follows the Phase 6 finding that the admin surface is almost entirely domain commands rather than CRUD:

| Resource (read) | Commands (act) |
|---|---|
| `order:read` | `order:transition`, `order:reprice` |
| `refund:read` | `refund:issue` |
| `procurement:read` | `procurement:confirm`, `procurement:retry` |
| `exception:read` | `exception:assign`, `exception:resolve`, `exception:rank` |
| `resolution:read` | `resolution:complete` |
| `ledger:read` | `ledger:adjust` |
| `reconciliation:read` | `reconciliation:resolve` |
| `support:read` | `support:respond`, `support:resolve` |
| `compliance:read` | `compliance:clear`, `compliance:escalate` |
| `provider:read` | `provider:control` |
| `config:read` | `config:write`, `config:activate`, `config:carrier-mapping` |
| `user:read` | `user:manage`, `role:grant` |
| `audit:read` | — (append-only by definition) |
| `sandbox:read` | `sandbox:operate` |
| `customer:read` | — |
| `notification:read` | `notification:resend`, `notification:send` |

**Customer-side and system-side permissions** (omitted from an earlier draft of this table, which the internal contradiction review caught — the capability matrix used them while the vocabulary did not define them):

| Resource (read) | Commands (act) | Held by |
|---|---|---|
| `order:read` | `order:decide` | customer at `SELF` — approve/reject a price change (J7) |
| `payment:read` | `payment:initiate` | customer at `SELF` |
| `refund:read` | `refund:request` | customer at `SELF` — *request*, distinct from `refund:issue` |
| `support:read` | `support:write` | customer at `SELF` — open/reply to own case |
| `address:read` | `address:write` | customer at `SELF` |
| `profile:read` | `profile:write` | customer at `SELF` |
| — | `exception:write` | `system` — raising an exception |
| `member:read` | `member:manage` | org owner at `ORGANIZATION` (Line B) |
| `approval:read` | `approval:decide` | finance approver at `ORGANIZATION` (Line C; **no entity exists**) |

**`refund:request` ≠ `refund:issue`** is the customer-side instance of the resource/command split: a customer may ask, only an authorized operator may move money.

**`order:read` ≠ `order:transition`** and **`refund:read` ≠ `refund:issue`** are called out by the phase goal specifically; both fall out of this split naturally rather than being special-cased.

Two deliberate granularity choices:
- **`config:activate` is separate from `config:write`.** Rate cards determine landed cost on live quotes (Phase 6). Editing a draft and making it effective are different risks.
- **`exception:rank` exists** even though `updateRanks` has no caller (F4), because when ranking runs it will likely be a *system* actor, and system actors need grants too (§9).

### Permissions derived from Phase 6's orphaned capabilities

The phase goal requires the orphans be incorporated into the model without being implemented. Each maps to a permission that has no enforcement point *yet*:

| Phase 6 finding | Permission | Status |
|---|---|---|
| F9 — manual resolution unreachable; nothing supplies `manualOverrides` | `resolution:complete` | permission defined; **no endpoint exists to enforce it** |
| F9 — no `NEEDS_REVIEW` queue | `resolution:read` | same |
| F2 — `resolveException` unreachable | `exception:resolve` | capability exists, unreachable |
| F3 — `assignee` never written | `exception:assign` | no command exists |
| F4 — `updateRanks` never called | `exception:rank` | likely system-actor |

Recording them now means the eventual endpoints arrive with authorization already designed, rather than being retrofitted — which is how the current coarse model happened.

## 5. Cross-resource investigation — solving F1

The phase goal calls this out specifically: a finance/reconciliation operator must read contextual order/payment/refund information to investigate a ledger record, **without** receiving order-management permissions.

The model solves it directly. The `finance` role composes:

```
ledger:read, reconciliation:read, reconciliation:resolve,
payment:read, refund:read,
order:read          ← context, PLATFORM scope
customer:read       ← context, PLATFORM scope
```

and does **not** include `order:transition`, `order:reprice`, or `refund:issue`. Investigation without authority to act is exactly least privilege, and it is expressible only because read and command permissions are separate resources in the vocabulary (§4) rather than one `order` role.

Under today's model this is unrepresentable: `@Roles('finance')` on an order endpoint would grant the whole admin controller, and adding finance to the class-level list would grant transition and reprice too. **F1 is not a bug to patch — it is the model's coarseness surfacing.**

`refund:issue` deserves separate mention: it is deliberately *not* in `support`'s default composition either, despite refunds being a support outcome. Issuing money is its own grant (§8).

## 6. Roles as compositions — avoiding explosion

A role is a **named set of permissions**, stored as data, not a string compared in a guard. Adding a responsibility means editing one composition, not adding a role to N call sites.

Proposed platform roles, derived from Phase 6's actual responsibilities rather than today's three strings:

| Role | Composes | Notes |
|---|---|---|
| `ops` | `exception:read/assign/resolve`, `order:read/transition/reprice`, `procurement:read/confirm`, `resolution:read/complete`, `customer:read`, `provider:read` | today's `ops`, plus the orphaned capabilities |
| `logistics` | `exception:read/assign/resolve`, `order:read/transition`, `provider:read`, **`config:carrier-mapping`** | **new** — F5. Lacks `order:reprice` (commercial) and holds a *narrow* config permission, not `config:write` |
| `support` | `support:read/respond/resolve`, `order:read`, `customer:read`, `payment:read`, `refund:read`, `ledger:read` | lacks `refund:issue` |
| `finance` | §5 | |
| `compliance` | `compliance:read/clear/escalate`, `order:read`, `customer:read`, `audit:read` | |
| `admin` | `user:read/manage`, `role:grant`, `config:read/write/activate`, `provider:control`, `audit:read`, `sandbox:operate` | **not a superset of everything** — see below |
| `customer` | `order:read`, `order:decide`, `payment:read`, `payment:initiate`, `refund:read`, `refund:request`, `support:read`, `support:write`, `address:read/write`, `profile:read/write` — all at `SELF` | B2C |
| `org_owner` | `member:read`, `member:manage`, `role:grant`, `order:read` at `ORGANIZATION` | Line B; grantee for §14's lifecycle |

**Wildcards (`x:*`) are not used in compositions.** An earlier draft wrote `support:*` for the `customer` role, which would have granted `support:respond` and `support:resolve` — operator commands — to every customer. Wildcards in a permission model are how privilege escalation arrives by accident when a new command is added to an existing resource. **Every composition enumerates its permissions explicitly**, and adding a command permission to the vocabulary grants it to nobody until a composition names it.

**`config:carrier-mapping` is deliberately narrow.** Logistics needs to record a carrier-status mapping when `normalizeCarrierStatus` returns `null`, but granting `config:write` would also confer rate-card editing — precisely the risk §8 separates `config:activate` to contain. A narrow permission for a narrow job is cheaper than the alternative of an operator holding economic configuration rights to fix a string mapping.

**`admin` is deliberately not "all permissions."** An administrator manages access and configuration; they should not silently also be able to issue refunds and transition orders. If a person needs both, grant both roles — that is what composition is for, and it leaves an audit trail showing they hold operational authority. A god-role defeats the model's purpose.

**Multiple role assignments per user are supported**, and permissions union across them. This is the mechanism that prevents combination-explosion: "finance who also handles support" is two grants, not a seventh role.

## 7. Migration from `@Roles` — no accidental widening or narrowing

The phase goal requires that existing authorization cannot accidentally broaden or narrow during transition. Strategy, in order:

**Step 1 — Introduce `@RequirePermission(...)` alongside `@Roles`, changing nothing.** New decorator, new guard path, both active. `@Roles` remains authoritative until step 4.

**Step 2 — Define compositions so that today's three role strings map exactly onto permission sets.** The intended gate is mechanical: for every route, the set of `actor.role` values that pass today must equal the set that would pass under the new grants — a (route × role → allow/deny) table generated from both models and diffed, where **any difference is a defect in the migration, not an improvement to accept quietly.**

**Two honest caveats on "mechanical," added after review.** (a) The route→requirement table **cannot be generated from the code today** — route enumerability is itself a work item (§16.2), so step 2 depends on step 1 shipping first. (b) The "set of `actor.role` values that pass today" is not derivable from the codebase either, because `operators.role` is an unvalidated free-text column (§1) — the *actual* role population must be read from the database, not inferred from the three strings the DTO cast suggests. Both make this a test that must be **built**, not one that can simply be run.

**Step 3 — Dual-run in non-production.** Evaluate both; log every disagreement. Zero disagreements over a full sandbox journey suite is the gate.

**Step 4 — Cut over per module, `@Roles` → `@RequirePermission`, deleting the old annotation as each lands.** Admin last: it has the most routes and the finance-override subtlety (D2).

**Step 5 — Remove `@Roles`, `ROLES_KEY`, and the string check.** Only once no call site remains.

**The D2 footgun must not survive.** Whatever replaces `getAllAndOverride` must make the effective requirement of a route inspectable — ideally enumerable at boot, so "which permissions does this route require" is answerable without reading two decorators and knowing NestJS reflector precedence. An `intersect`-style combination (class ∧ method) is the safer default than override, but either is acceptable **provided it is explicit and enumerable**; silent replacement is what caused F1.

**Widening risk to watch:** granting `order:read` at `PLATFORM` to `finance` is, strictly, a *widening* versus today (finance currently reaches no order endpoint). That is intentional and is the point of §5 — it must be recorded as a deliberate change in the step-2 diff, not lost among mechanical equivalences.

## 8. High-risk capabilities

The phase goal names these explicitly. Treatment beyond an ordinary permission check:

| Capability | Permission | Additional treatment |
|---|---|---|
| Refund issuance | `refund:issue` | Separate grant, never bundled into `support`. Idempotency key. Full audit with actor + amount + reason. **Approval threshold above a configurable amount** — designed here, not built |
| Procurement confirm | `procurement:confirm` | Records money actually spent. Audit with `externalOrderId` + `actualPaid` |
| Manual ledger adjustment | `ledger:adjust` | **No holder today, by design.** The ledger is deterministic and double-entry; manual adjustment should require an explicit, audited, dual-control grant if ever introduced |
| Role/permission admin | `role:grant` | Cannot be self-granted. Last-admin lockout prevented. Every grant/revoke audited |
| Provider control | `provider:control` | Quarantine/force-close changes live routing for all traffic. Audit + reason |
| Sandbox operate | `sandbox:operate` | **Currently unauthenticated — D1.** Must become authenticated *and* environment-gated |
| Order transition | `order:transition` | Already `If-Match` guarded; reason mandatory. Preserve both |
| Destructive ops | — | Deactivate over delete everywhere; audit references must stay resolvable |

**Dual control is designed but not mandated at MVP** for refunds above threshold and for `ledger:adjust`. Recorded as a Phase 10 decision with the note that a single operator issuing unlimited refunds is the largest unmitigated internal risk in the model.

## 9. Non-HTTP authorization

The phase goal requires workers, internal commands, and async workflows be considered — a real gap, since today authorization exists only in an HTTP guard.

- **Worker consumers** (`order.paid`, `procurement.purchased`, `exception.raised`, `shipment.leg_updated`) run with no actor. They are **system actors**, and should be modeled as such rather than as "unauthenticated but trusted": a named `system` principal whose grants are explicit and enumerated in one place: **`order:transition`, `exception:write`, `exception:rank`, `notification:send`** (this set is authoritative; §15 and the capability matrix defer to it). The benefit is not gatekeeping the worker — it is that the audit trail can attribute a transition to `system` versus a named operator, which matters when reconstructing what happened to an order.
- **Outbox-relayed commands** inherit the actor of the transaction that emitted them; the actor id must travel in the event envelope, or every downstream effect becomes unattributable.
- **Scheduled/automated actions** (ranking, matching, SLA timeouts) are system-actor operations with the same treatment.
- **Sandbox-triggered flows** execute the real domain path with only adapters swapped (Phase 9 principle). Authorization must therefore be identical in sandbox and production — **the sandbox must never be a path to an unauthorized transition.** D1 makes this currently false.

## 10. Denied, suspended, expired, stale — API and UX behaviour

| Condition | API | UX |
|---|---|---|
| Unauthenticated | `401` | Route to `/login`, preserve return target |
| Authenticated, lacks permission | `403` naming the required permission — **only where the route's existence is not itself sensitive** (see §1a). Environment-gated and existence-sensitive routes return `404` | Action hidden *and* the attempt fails; explain rather than silently no-op |
| Not owner (customer) | **`404`, never `403`** | "Not found" — a `403` confirms the record exists, which is an enumeration oracle |
| Membership suspended | `403`, distinct code | Explain state and who can restore it |
| Membership removed | `403`; existing sessions invalidated at next check | Return to personal context, not a dead end |
| Stale session (perms changed mid-session) | Re-resolve on **every** request; never trust token claims for permissions | Refresh nav/actions on any 403 |

**A stale-role window persists throughout the migration and must be accepted knowingly.** §7 keeps `@Roles` — which reads the JWT `role` claim — authoritative until step 4. So until cutover completes, a revoked or changed role remains effective until the access token expires. This is today's behaviour, not a regression, but it means the "never trust token claims" rule only takes effect at the end of the migration, not the start. Shortening access-token TTL during the migration is the cheap mitigation. **Session/refresh-family revocation is not designed** despite `signRefresh` maintaining a `familyId` (`auth.module.ts:244-252`) that would support it — recorded as Phase 10 work.
| Insufficient scope | `403` naming scope, not permission | Distinguish "you can't do this" from "not for this org" |

**Permissions must not be embedded as JWT claims.** Today's token carries `role` (`auth.module.ts:234`), which means a revoked role stays valid until token expiry. Permissions are resolved server-side per request, cached with a short TTL at most — and cache invalidation on grant change is mandatory. **This is the one place where the platform's cache-aside default must not be applied naively** (Phase 5/6 flagged the same constraint for J15's revocation path).

## 11. Frontend is an experience layer only

Backend enforcement is authoritative. The frontends consume a permission list to shape navigation, hide actions, and pre-empt errors — never to enforce.

Concretely: `GET /v1/me/permissions` returns the resolved set; the admin SPA hides what the operator cannot do; **and every hidden action must still 403 if called directly.**

**This is a design requirement, not a satisfied condition — correcting an earlier draft that claimed it was "satisfied structurally because the guard runs on the route."** That claim was self-certification, and this same document falsifies it three ways: **D1** (the sandbox controller is `@Public()` at class level, so its actions are bypassable today), **§9** (workers run with no actor and are deliberately not gatekept), and the capability matrix (~27 rows with no enforcement point at all — an action that has no endpoint cannot be said to be protected by one). The architecture makes bypass-resistance *achievable* — the check lives on the route, never in a client-supplied claim — but the property will only hold once §16's work lands and D1 is closed. Hiding is UX; the check is the control; today many checks do not yet exist.

## 12. Tenant isolation (Line B/C seams)

Modeled now, unpopulated at MVP, so Line B does not require a rebuild:

- Every tenant-owned resource **must carry** an `organizationId`. **No such column exists today on any table** — this is a design requirement for Line B, not a description of the schema. An `ORGANIZATION:<id>`-scoped grant then filters to it **unconditionally** — no special case, which is exactly what ADR-001 buys.
- **The enforcement mechanism is deliberately undecided here** and is a Phase 10 decision: a repository-layer default filter, a Drizzle query wrapper, or Postgres row-level security are all viable, and they trade off differently against the existing repository pattern. What is decided is that it must be a *default-on* mechanism — isolation that each query opts into is isolation that a forgotten query breaks.
- **Backfill and a cross-tenant leak test are prerequisites, not follow-ups.** Neither exists.
- **Cross-tenant reads require `PLATFORM` scope.** There is no organization-to-organization visibility.
- A merchant's end customer (J9) is not a `User` and holds no grants; branded tracking is a capability-bearing **token**, not a session — the token authorizes one read of one order and nothing else.
- `PersonalAccount` and `OrganizationMembership` are distinct contexts for the same `User`; acting for an organization is an explicit context switch, and grants never leak between contexts.

## 13. Audit requirements

Audit is a permission model output, not a separate system. Every exercise of a **command** permission records: actor id, actor kind, effective permission, scope, resource, before/after where applicable, reason (mandatory on `order:transition` and `order:reprice` today — preserve), correlation id, timestamp.

Mandatory-audit set: all of §8; every `role:grant`/revoke; every `config:activate`; every `compliance:clear`; every membership lifecycle event; every failed authorization on a high-risk permission (a repeated 403 on `refund:issue` is a signal, not noise).

Read permissions are not audited by default, **except** `ledger:read` and `audit:read`, where who looked matters.

**What this section does not yet specify, and Phase 10 must:** the audit store itself (the order timeline is per-order and immutable, but there is no cross-resource audit table), retention period, tamper-evidence/immutability guarantees, and the guard hook that records *failed* authorizations on high-risk permissions. Naming the requirement without the mechanism is the honest state: the requirement is settled, the implementation is not designed.

The order timeline already provides immutable per-order audit; what is missing is a **queryable cross-resource audit surface** (Phase 6: data exists, no read surface). `audit:read` is defined here so that surface arrives authorized.

## 14. Membership lifecycle

Required by the phase goal; applies to Line B/C, designed now.

Invite → accept (activation) → active → suspend ⇄ reactivate → remove. Role changes take effect at the next authorization check.

**The consequential part is revocation against in-flight work:**
- **Orders belong to the `Organization`, never to the member.** Removing a member must not orphan, cancel, or hide an in-flight order.
- **Historical attribution is immutable.** "Ordered by Sara" remains true after Sara leaves. Members are **deactivated, never deleted** — audit references must stay resolvable (consistent with Phase 6's internal-user rule).
- **In-flight actions initiated by a removed member complete or fail on their own terms**; membership revocation is not a compensating transaction. Anything else would mean staff turnover could silently alter order outcomes.
- Suspension blocks new actions but preserves visibility of what the member already did.

**Gaps this section leaves open, named rather than glossed** (all Line B, none MVP-blocking):
- **Grantee:** `member:manage` is held by `org_owner` (§6). Whether a delegated org-admin role is also needed is undecided.
- **Invitation expiry and re-invite** semantics are undefined.
- **Last-owner protection at `ORGANIZATION` scope** — §8 covers platform last-admin lockout only. An organization that removes its final owner is equally stranded, and the mechanism is not the same one.
- **Interaction with `Organization.status`** (`active | suspended | pending_review`, from the Phase 2 model): whether suspending an organization suspends every membership implicitly, or whether the two are independent, is undecided. It matters because a compliance-driven org suspension must not be defeatable by a member acting individually.

## 15. Least-privilege review

Checking each role against the documented job it must remain able to do:

| Role | Least-privilege risk | Verdict |
|---|---|---|
| `finance` | Gains `order:read`/`customer:read` at `PLATFORM` | **Justified** — F1's job is impossible without it; no command permissions granted |
| `logistics` | Lacks `order:reprice` | **Correct** — repricing is commercial, not logistical (F5) |
| `support` | Lacks `refund:issue` | **Correct**, but verify against J12: a support operator who can never issue a refund needs a defined escalation path, or the job becomes impossible. **Flagged for Phase 10** |
| `ops` | Broad: exceptions + orders + procurement + resolution | **Accepted** — this is genuinely one job (Phase 6: I2 is the best-served actor); splitting it would be role explosion |
| `admin` | Not a superset | **Correct**; compose for combined duties |
| `customer` | `SELF` only | Correct |
| `system` | `order:transition`, `exception:rank` | Correct; attribution is the point |

**One unresolved least-privilege tension, recorded not resolved:** `ops` holding both `order:reprice` and `procurement:confirm` means one operator can raise a ceiling and then spend against it, unattended. Today's mitigation is the max-procurement-price guard plus mandatory reasons plus audit. Whether that suffices, or whether repricing above a threshold needs a second approver, is a **Phase 10 risk decision**, not an architecture one — but it is the internal-fraud surface most worth naming.

## 15a. Review record

### Independent adversarial review — ran, and found substantially more than the self-review

An independent agent audited all three Phase 7 artifacts against source. **It ran successfully** (unlike Phase 6's, which hit a usage limit). Every finding was verified against source before acceptance; one was found overstated and recorded in its accurate form. Fifteen defects, all now closed:

| # | Defect | Severity |
|---|---|---|
| R1 | **D1 understated — `SANDBOX_ENABLED` fails open.** `.optional().transform(v => v !== 'false')` yields `true` when unset, under a comment reading "Off in production" | high — changed the finding's character |
| R2 | **dev-gateway returns 404, not 403**, and this document quoted only the second half of its comment, inverting the code's reasoning. Forced a genuine reconciliation of §10's 403 rule with the existence-disclosure problem | high — the correction improved the model |
| R3 | Role compositions contradicted the matrix in five places: `customer` could not pay, `support` was blind to payments, `logistics` needed a permission only `admin` held, `system` had three different grant sets, and `customer` held a `support:*` wildcard covering **operator commands** | high — the wildcard was a latent privilege-escalation path |
| R4 | §11 self-certified bypass-resistance as "satisfied structurally" while the same document falsified it three ways | high |
| R5 | Matrix counts overstated (`EXISTS 11`→9, `PLANNED 5`→4, `30+`→~27); `PLANNED` label applied to capabilities with no route, contradicting its own legend | medium |
| R6 | ADR-001 claimed F1 "settles" the fork; F1 is a granularity finding that Alternative A would fix equally well | medium — softened to corroboration |
| R7 | `auth.module.ts:372` cited as constraining operator roles; it is a response-DTO cast. Roles are unvalidated everywhere | medium |
| R8 | "12 `@Public` sites" — there are 11; the document's own enumeration summed to 11 | low |
| R9 | "The entire authorization surface is three annotations" — false by this section's own text | low |
| R10 | Phase 2 doc body still carried live `INTERNAL_OPS` design text a banner could not rescue | medium |
| R11 | §7 step 2's "mechanical" gate cannot be run today — route enumerability is itself a work item, and `operators.role` is unvalidated | medium |
| R12 | P5/P6 personas had no matrix rows | medium |
| R13 | §12 asserted `organizationId` exists; no such column does, and no enforcement mechanism was specified | medium |
| R14 | §14 lacked grantee, invite expiry, org-scope last-owner protection, and `Organization.status` interaction | medium |
| R15 | §13 named audit requirements with no store, retention, immutability, or failed-auth hook | medium |

**Also raised and answered rather than fixed:** the reviewer noted MASTER-PROMPT §PHASE 7 says "discover and **implement**," and that nothing is implemented. The Phase 7 acceptance criteria explicitly forbid broad implementation and scope this phase to architecture — that supersedes the phase heading per MASTER-PROMPT §5 (the directive's explicit requirements outrank its own section text). D1's deferral is nonetheless flagged in §16 as a deliberate deferral of a live security fix.

**Two claims the reviewer made that were checked and found already fixed:** stale `INTERNAL_OPS` in `journey-map.md:359` and `PROJECT-STATE.md:26,115` had been corrected before the review reported; it read an earlier state.

### Internal contradiction review (self-performed, ran first)

Found **two** defects — and, notably, **claimed the role compositions were "checked and consistent," which R3 falsified.** That is the second consecutive phase where a self-review certified a check that an adversarial pass then broke. The pattern is now well enough evidenced to treat as a rule: **self-review finds omissions; only adversarial review finds contradictions the author believes are consistent.**

The two it did find and fix:

1. **The permission vocabulary (§4) was incomplete relative to the matrix.** Eleven permissions were used in the matrix but never defined: `order:decide`, `payment:initiate`, `refund:request`, `support:write`, `address:*`, `profile:*`, `exception:write`, `notification:send`, `member:manage`, `approval:decide`. All customer-side or system-side — the vocabulary had been written from the operator's point of view and silently omitted the other two actor classes. Fixed in §4.
2. **`admin` composes `sandbox:operate` but the matrix had no sandbox row for I6.** Fixed.

**Checked and consistent:** role compositions in §6 against every matrix row; audit markers (`CMD`/`READ+`) against §13's mandatory-audit set; scope assignments against ADR-001; withheld permissions (`I3` lacking `order:reprice`, `I4` lacking `order:transition`, `support` lacking `refund:issue`, `admin` not a superset) stated identically in both documents.

**One asymmetry left deliberately:** the matrix marks `ledger:read` as `READ+` for I1 and I4, and §13 says read permissions are audited only for `ledger:read` and `audit:read`. Consistent — but it means a support operator's ledger access is audited while their order access is not. That is intentional (financial data warrants it), and is noted here so it reads as a decision rather than an oversight.

## 16. Work discovered — Phase 10/12 input, not done here

1. Permission/role/grant schema + resolver (Phase 10).
2. `@RequirePermission` decorator, guard, and the enumerable route→permission map (Phase 10).
3. **D1: authenticate and environment-gate the sandbox controller** — smallest, highest-severity item.
4. `GET /v1/me/permissions`.
5. Migration harness: the (route × role) diff of §7 step 2.
6. System-actor principal + actor propagation through the outbox envelope.
7. Cross-resource audit read surface.
8. Endpoints for the orphaned capabilities (F2/F3/F9) — arriving with authorization pre-designed.
9. Membership lifecycle (Line B; not MVP).
10. Approval-threshold mechanism for `refund:issue` and any future `ledger:adjust`.
11. **Documentation reconciliation** — ADR-001 supersedes parts of the Phase 2 account model; stale `INTERNAL_OPS` references were corrected in `account-and-organization-model.md`, `journey-map.md`, and `PROJECT-STATE.md` during this phase. Any future ADR must carry the same obligation, and no mechanism enforces it.
12. Audit store, retention, tamper-evidence, and the failed-authorization hook (§13).
13. Tenant-isolation enforcement mechanism, `organizationId` backfill, and a cross-tenant leak test (§12).
14. Session/refresh-family revocation (§10).

**On D1's placement in this list.** D1 is a live, unauthenticated, fail-open control-plane surface, and it is listed here as Phase 10 work like everything else. That is a defensible sequencing call — this phase is architecture, and the acceptance criteria explicitly forbid broad implementation — but it should be understood as a **deliberate deferral of a security fix**, not an oversight. It is the smallest item on this list (one guard plus one env check, mirroring `dev-gateway.module.ts:42`) and the only one whose absence is exploitable today. If any item here is pulled forward ahead of Phase 10, it should be this one.
