# Backoffice — Phase 6 Completeness Review

> Phase 6 exit review of `docs/ux/backoffice-operating-model.md` and `docs/ux/backoffice-ia.md`, against Phase 2 personas, Phase 3 operator journeys (J10–J15), and live source.
>
> Same scope distinction as Phase 5: a **Phase 6 artifact issue** is a defect in the design work itself and must be zero for the phase to close. A **product issue** is a real system gap that Phase 6 discovered and documented; those are owned by Phases 7–12.

## 1. Method — and a stated limitation

The Phase 5 retrospective concluded that a self-review reproduces the author's blind spots by construction, and that later phases should budget an adversarial pass. That was budgeted here: an independent audit agent was dispatched against both Phase 6 documents before this review was written.

**It failed.** The agent terminated with an API session usage limit (resets 14:40 Asia/Tehran) after reading the documents but before producing findings. This is a legitimate external constraint, not a silent failure, and it is recorded rather than worked around.

**What was done instead:** the four checks below were performed directly, using the audit brief that had been written for the agent — in particular its Q3 (coverage against MASTER-PROMPT's full ~39-area capability list), which is the check most likely to catch an author's omissions because it compares against an external list rather than against the author's own model. **That check immediately found ten omitted areas and one orphaned P0 capability (F9)**, which is evidence both that the method works and that self-review remains weaker than adversarial review.

**Honest status: this review is self-performed.** Its findings are real and verified against source, but it has not survived a hostile pass. The Phase 5 experience suggests defects remain. **Recommendation: re-run the adversarial audit against these artifacts once usage limits reset, before Phase 6 output is relied on for Phase 12 work-package sizing.** Tracked as the one open Phase 6 item.

## 2. Workflow-completeness check

Ten operating areas (nine originally identified, plus product-resolution review found during this review):

| Area | Commands wired | Operator-reachable | Verdict |
|---|---|---|---|
| Exception triage | list, transition, reprice | partial | **Partial** — cannot resolve, assign, or truly rank (F2/F3/F4) |
| Procurement | copilot, confirm | yes | **Complete** |
| Logistics | via generic `transition` | yes | Partial — no leg-level surface, no carrier-mapping command |
| Finance (ledger) | ledger, balances | yes, role-limited | Partial — F1 blocks order context |
| Reconciliation | none | no | **Absent** |
| Support | none | no | **Absent** |
| Compliance | none | no | **Absent** |
| Configuration | none | no | **Absent** |
| Integration health | providers (read) | API only, no screen | Partial — no control commands |
| **Product-resolution review** | manual tier exists | **no** | **Absent surface for an existing capability (F9)** |
| Sandbox ops | full API | front office only | Partial |

**Result: 1 of 11 complete.** That is the honest state of the operator experience, and it is the central output of Phase 6.

## 3. Operator-action → capability check

Every action in `backoffice-ia.md`'s mapping table resolves to a wired capability, a documented partial, or a documented missing capability. **11 wired · 7 partial-or-orphaned · 12 missing**, with none unaccounted for.

The seven partials are the notable class — capability built, surface absent:

| Capability | Evidence it exists | Evidence it is unreachable |
|---|---|---|
| `resolveException` | `admin.module.ts:305-308`, calls a real repository method | only reference is its own definition |
| exception `assignee` | DB column, contract field, read into DTO | **no writer anywhere** |
| `updateRanks` | `repositories.ts:656` | only reference is its own definition (verified directly this phase) |
| manual resolution tier | `strategies.ts:371-395`, confidence 1.0 | `manualOverrides` has 2 refs: declaration + consumer. **No producer** |
| refund execution | payment port `refund()` | no callers; nothing transitions to `REFUND_PENDING` |
| order audit timeline | persisted, immutable | no read surface |
| sandbox operations | full API, 12 scenarios | consumed only by the front office |

## 4. Contradiction check

- **Operator role names** consistent between `personas.md` (I1–I6) and enforced roles (`ops`, `admin`, `finance`). The gap — no `logistics`, `support`, `compliance` role exists — is recorded as F5 and a Phase 7 input, not asserted as present.
- **J10's claims match this phase's findings**: J10 already recorded rank as nominal and the missing "in progress" affordance. Phase 6 sharpens both with direct verification and adds the resolve/assign orphans.
- **No contradiction with `state-matrix.md`**: its operator columns describe which order states each actor sees, which is consistent with the surfaces here.
- **One tension, recorded:** MASTER-PROMPT lists "operational overview" as a backoffice area, while `CLAUDE.md`'s RULE makes the ranked exception queue the default view. Resolved in favour of the RULE (a source-of-truth-hierarchy call: existing architectural rules outrank the phase's candidate list), with the reasoning recorded in the IA rather than the area silently dropped.

## 5. P0 / P1 triage

### Phase 6 artifact issues

**One open:** the adversarial review has not run (§1). Not resolvable within this session — external usage limit.

**Closed during this review:** ten capability areas omitted from the route inventory, and the F9 orphan missed entirely on the first pass. Both were found by checking against MASTER-PROMPT's external list rather than against the author's own model.

### Product issues discovered (owned by Phases 7–12)

**P0 — the operating model does not function without these:**

1. **F2 — `resolveException` unreachable.** The queue has no exit for a benign exception. Degrades the surface the whole manage-by-exception model depends on. *Phase 10 (endpoint) + 12 (UI).*
2. **F9 — manual resolution tier unreachable.** A product request that reaches `NEEDS_REVIEW`/`FAILED` has no path to completion: automated tiers already failed, human tier can't be invoked. *Phase 10 + 12.*
3. **F1 — finance operators cannot see order context.** I4's stated job is structurally impossible under the current role model. *Phase 7.*

**P1:**

4. F3 — no assign/reassign command; no work-in-progress concept, silent operator collisions.
5. F4 — ranking never runs; queue is insertion-ordered while presenting as risk-ranked.
6. Support case surface absent (both sides) — also Phase 5 P1.
7. Reconciliation surface absent; automated matcher existence still unconfirmed (carried from Phase 0).
8. Integration health has no screen despite a working API — cheapest missing screen in the back office.
9. Bulk actions absent everywhere; routine at real volume.
10. Payments/refunds not searchable by order — only the raw ledger by `refId`.
11. Audit timeline persisted but never surfaced.
12. F5 — no `logistics` role; any `ops` operator can reprice, a commercial decision.

**P2:** compliance surface, configuration screens (with rate-card versioning), sandbox operator surface, shipments leg-level view, notification operations, carrier-status mapping command, feature-flag system (none exists).

## 6. Limitations

- **Not adversarially reviewed** (§1) — the single most important caveat on this document.
- **No running application exercised**; all claims from source reading. Whether the admin app boots is still unverified (carried from Phase 0).
- **Operator usability is reasoned, not observed.** No operator was interviewed and no workflow timed. Claims about what operators need come from Phase 2 JTBD plus the structure of the domain — defensible, but not user research, and the manage-by-exception model deserves real validation before Phase 12 builds heavily against it.
- **Volume assumptions are unstated.** Whether bulk actions are P1 or P0, and whether cursor pagination suffices, depend on order volume nobody has specified.
