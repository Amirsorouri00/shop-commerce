# Tranche 5 — External adapters and hardening (WP-23 … WP-25)

> All three are **EXTERNAL-GATE** dependent. Each must ship with sandbox fixtures so the journey remains demonstrable regardless of provider availability.

---

## WP-23 — Marketplace resolution adapters

**P1 · provider integration · Depends on: WP-11**

**Why.** In production `buildStoreStrategies` registers **nothing** (G-12) — the stub is refused (`adapters.ts:288-295`) and api/structured/vision are commented out. The ladder is empty, so C1–C3 (the journey entry) cannot work in production at all.

**Scope.** A `PageFetcher` implementation Amazon will actually serve — **empirically, six of seven direct fetches returned HTTP 503**, so a bare server-side `fetch` is verified insufficient; structured-data extraction; vision tier; rate limiting per the existing marketplace descriptors.

**Re-evaluate the API tier before building it.** PA-API 5.0 was deprecated 2026-05-15 in favour of a narrower-access successor. `marketplace.ts:78` asserts `productApi: true`; whether that still holds is now an **availability** question, not a credentials one. The architecture already absorbs the answer — capabilities are **data**, so `productApi: false` is a one-line descriptor change and the ladder escalates. **Do not block on credentials; do not embed Amazon assumptions in the quote layer.**

**Also owns G-35/G-36.** Separate **catalogue weight** from **chargeable weight** — `ApiResolutionStrategy` sets `weightKg` confidence 0.6 claiming it is "below the escalation floor" when the floor is 0.5, so it **never escalates**, and catalogue weight (excluding packaging and dimensional weight) is used as though it were chargeable. Modelling them as one field hides a systematic difference behind a confidence number. Plus the seven missing normalized fields — of which **`eligibility`/`restrictions` is required before payment**, because an ineligible item that resolves, quotes, and is paid for fails at customs, the worst discovery point in the product. **This package must decide whether eligibility becomes a quote/checkout gate.**

---

## WP-24 — Real payment gateway

**P0-when-unblocked · EXTERNAL-GATE · Depends on: WP-02**

Real Iranian gateway behind `PaymentPort`. **Blocked on a commercial agreement and credentials** — a legitimate external blocker, not a design gap.

WP-02 makes this a *configuration* change rather than an architectural one: the verified webhook path works, verification is routable, settlement is idempotent and amount-checked. Multi-provider failover already exists behind the port.

**Acceptance.** The sandbox simulated gateway and the real gateway traverse **identical** ingress, verification, idempotency, ledger, and transition logic — only the adapter differs.

---

## WP-25 — Reconciliation

**P1 · financial · Depends on: WP-09, WP-05**

**Why (G-24).** Now verified **absent**, resolving a question carried since Phase 0: `reconciliationItems` exists (`schema.ts:400`) and a queue consumer exists (`worker/main.ts:233-237`) that calls only `logger.debug`. **No matching algorithm.**

**Scope.** Matching inputs (ledger ↔ provider settlement, keyed by provider ref); **idempotent** matching so re-runs do not duplicate discrepancies; discrepancy creation as a domain event; operator investigation via WP-09's read model; resolution as an audited command; **sandbox rows excluded structurally** via WP-07.

**Constraint.** The ledger remains the **single financial truth**. Reconciliation records observations *about* it and never becomes a second editable accounting state.

**Distinguish timing lag from genuine discrepancy** — most unmatched rows at any moment are simply early, and one generic "unmatched" bucket makes the screen useless.
