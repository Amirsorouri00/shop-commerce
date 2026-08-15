# Shop Commerce — Product / UX / Architecture Convergence Master Prompt

You are assuming responsibility for the next major development program of this repository.

This is **not** a visual redesign task and it is **not** a request to merely add pages to the existing frontend.

Your objective is to make the **product model, user experience, operational experience, domain model, APIs, sandbox environment, and implementation architecture converge into one coherent Cross-Border Assisted Commerce Platform**.

The existing backend architecture is relatively mature, while the visible product currently represents only a narrow engineering MVP. Treat existing code as evidence and reusable infrastructure, **not** as the definitive description of the complete product boundary.

---

## 1. Operating mode

Operate autonomously.

Do **not** ask me questions during execution.

When information is genuinely unknown:

1. investigate repository evidence;
2. inspect Graphify;
3. inspect governing project documents;
4. use relevant installed plugins/skills;
5. research primary/external sources when appropriate;
6. infer the most defensible product decision;
7. record the assumption, confidence, alternatives, and reversal cost;
8. continue.

Only classify something as `BLOCKED` when implementation objectively requires a credential, commercial agreement, provider account, legal/compliance approval, or another external dependency that cannot be simulated.

A blocked external integration must still have:

- complete domain contract;
- port/interface;
- sandbox adapter;
- UX states;
- configuration model;
- failure states;
- tests;
- documentation.

Never use an external dependency as justification for leaving a product journey structurally incomplete.

---

## 2. Tool and plugin discovery

Before major work:

- inspect installed Claude plugins and skills;
- inspect root `.claude`, `.agents`, `.claude-flow`, `.swarm`, and related orchestration assets;
- inspect Ruflo capabilities and available agents;
- run Ruflo health/doctor/discovery commands where available;
- inspect MCP configuration and available servers;
- inspect Graphify outputs;
- select tools from their actual descriptions rather than assumptions.

Use the installed UI/UX, design-system, frontend-design, engineering, product-management, code-review, Graphify, Ruflo, browser/research, and other relevant capabilities intentionally.

Do not invoke plugins merely because they are installed.

---

## 3. Ruflo orchestration

Use Ruflo as the orchestration layer when it is healthy and suitable.

Use a **hierarchical coordination model with one master integrator**.

Recommended capability groups:

- Product / domain lead
- Experience / UX lead
- Engineering / architecture lead
- Verification / security / quality lead

Delegate bounded tasks to specialized subagents such as:

- product strategist;
- domain analyst;
- UX architect;
- UI designer;
- design-system specialist;
- customer-journey researcher;
- browser/research agent;
- backend architect;
- NestJS/domain engineer;
- Next.js engineer;
- Vite/React engineer;
- API reviewer;
- test engineer;
- security reviewer;
- accessibility reviewer;
- architecture reviewer.

Do **not** create large swarms for the sake of parallelism.

Parallelize only independent work.

Every delegated task must have:

- explicit scope;
- expected artifact;
- acceptance criteria;
- bounded report size.

Subagents should return concise conclusions, decisions, references, and file paths — not raw logs or full source files.

Use lower-cost agents/models for mechanical work and stronger reasoning for product, architecture, domain, cross-system, and final-review decisions when Ruflo routing supports it.

---

## 4. Context and token-efficiency strategy

Do not repeatedly rediscover the repository.

Use these context layers deliberately:

1. `CLAUDE.md`
   - permanent architectural/product invariants.

2. Governing project documents
   - product strategy, feasibility, technical blueprint, economics, historical decisions.

3. `graphify-out`
   - implementation topology and navigation.

4. Ruflo persistent memory
   - decisions, findings, reusable research, implementation knowledge.

5. `docs/program/PROJECT-STATE.md`
   - compact current program state.

Before broad source-code exploration, inspect Graphify to identify the relevant community, symbol set, hub, and dependency neighborhood.

Read source files only after narrowing the search area.

After major structural changes, refresh/rebuild Graphify where possible and compare actual topology against intended topology.

Create and continuously maintain:

`docs/program/PROJECT-STATE.md`

Keep it concise. It should contain:

- current phase;
- approved product boundaries;
- current personas/actors;
- major architecture decisions;
- major UX decisions;
- external gates;
- completed work packages;
- active work packages;
- unresolved high-impact questions;
- links to deeper artifacts.

Do not keep large reports in conversational context when they can be stored in repository documents or Ruflo memory.

---

## 5. Source-of-truth hierarchy

When sources disagree, use this precedence:

1. Explicit requirements in this master directive.
2. Newly accepted ADR/product decisions produced during this program.
3. Governing project product documents.
4. Existing architectural rules.
5. Existing implementation.

Never silently resolve contradictions.

Record material contradictions and the selected resolution.

---

## 6. Superseding application-framework decision

The previous repository state may state that the backoffice uses Next.js.

That decision is now superseded.

Target application architecture:

- Customer/front office: **Next.js**
- Backoffice/admin: **Vite + React**
- Backend/API: **NestJS**
- Workers/background backend processing: **NestJS**

Preserve the existing strong ports/adapters/domain architecture unless discovery demonstrates a materially better boundary.

Create an ADR for the admin migration and update permanent project instructions so future agents do not revert it.

Do not perform a destructive rewrite if an incremental migration is safer.

---

# PHASE 0 — Rebaseline the current system

Before changing major product code, read and reconcile:

- `CLAUDE.md`;
- technical blueprint;
- feasibility documents;
- logistics/economics documents;
- README files;
- OpenAPI/API contracts;
- database schema;
- domain packages;
- application services;
- adapters;
- sandbox;
- front office;
- admin;
- workers;
- tests;
- Graphify report and graph;
- installed plugin/agent configuration.

Produce:

`docs/program/00-current-state-assessment.md`

Map important capabilities through:

`PRODUCT CAPABILITY`
→ `USER/OPERATOR JOURNEY`
→ `UI SURFACE`
→ `API`
→ `APPLICATION SERVICE`
→ `DOMAIN CAPABILITY`
→ `DATABASE`
→ `EVENT/WORKER`
→ `ADAPTER`
→ `TEST COVERAGE`

Classify each capability as:

- COMPLETE
- PARTIAL
- TECHNICAL-ONLY
- UI-ONLY
- MISSING
- EXTERNAL-GATE
- INCONSISTENT

Do not begin broad redesign or mass implementation until this baseline exists.

---

# PHASE 1 — Discover the real product boundary

Perform product discovery from first principles.

The current beachhead is link-first assisted cross-border commerce:

Foreign product URL
→ product resolution
→ landed-cost quote
→ customer decision
→ authentication/account
→ address
→ payment
→ procurement
→ multi-leg fulfillment
→ customs/logistics
→ delivery
→ support/refund/exception handling.

Investigate the broader platform vision and explicitly distinguish:

A. B2C Assisted Commerce  
B. B2B Merchant / Seller Assisted Procurement and Fulfillment  
C. Enterprise Procurement / Import Operations  
D. Shared Platform Capabilities

Do not assume all business lines must be exposed in the first production release.

Discover appropriate product boundaries and phased surfaces.

Produce:

- `docs/product/product-boundary.md`
- `docs/product/capability-map.md`
- `docs/product/business-lines.md`
- `docs/product/mvp-vs-platform.md`

---

# PHASE 2 — Actors, personas, anti-personas, identity and accounts

Discover relevant actors.

Explicitly evaluate:

- primary users;
- secondary users;
- internal users;
- economic buyers;
- operational users;
- administrators;
- edge-case users;
- anti-personas.

At minimum investigate:

- B2C individual shopper;
- frequent cross-border shopper;
- Instagram/social-commerce seller;
- small online merchant;
- company purchaser;
- enterprise procurement operator;
- organization owner;
- buyer;
- finance approver;
- customer support operator;
- procurement operator;
- logistics operator;
- finance/reconciliation operator;
- compliance/risk operator;
- system administrator.

Do not assume `Customer = User`.

Design an identity/account model capable of supporting, where justified:

- User / Identity
- Personal Account
- Organization
- Organization Membership
- Customer Profile
- Merchant / Business Profile
- Roles
- Permissions
- Teams
- Delegated responsibilities

Define anti-personas explicitly.

Produce:

- `docs/product/personas.md`
- `docs/product/jobs-to-be-done.md`
- `docs/product/account-and-organization-model.md`
- `docs/product/anti-personas.md`

---

# PHASE 3 — Complete journey architecture

For every approved actor, model complete journeys.

Do not design isolated screens.

Each journey must include:

- entry point;
- intent;
- prerequisites;
- happy path;
- alternate paths;
- loading;
- validation;
- empty states;
- missing data;
- provider outage;
- permission denial;
- cancellation;
- retries;
- recovery;
- asynchronous waiting;
- notifications;
- support escalation;
- terminal states.

Produce:

- `docs/ux/journey-map.md`
- `docs/ux/service-blueprint.md`
- `docs/ux/state-matrix.md`

The service blueprint must map:

`CUSTOMER ACTION`
→ `FRONTSTAGE UI`
→ `API`
→ `DOMAIN PROCESS`
→ `BACKSTAGE OPERATION`
→ `EXTERNAL PROVIDER`
→ `EXCEPTION HANDLING`

No journey may terminate at a UI state without corresponding backend/operational behavior.

No backend workflow may remain operationally inaccessible when a human is expected to manage it.

---

# PHASE 4 — Amazon UAE PDP and product resolution

Use browser/research capabilities to inspect multiple live Amazon UAE PDP structures.

Investigate examples such as:

- simple product;
- product with variations;
- multiple sellers;
- discounted product;
- unavailable product;
- Prime/FBA;
- third-party fulfilled;
- shipping restrictions;
- incomplete/ambiguous structured information.

The objective is **not** to clone Amazon visually.

The objective is to resolve the product faithfully enough that:

1. the customer can recognize exactly what they requested;
2. deterministic pricing receives normalized trustworthy data.

Discover a normalized Product Resolution model including, where available:

- marketplace;
- canonical URL;
- ASIN/identifier;
- title;
- brand;
- selected variation;
- selectable variations;
- images;
- seller;
- fulfillment party;
- item condition;
- price;
- original price/discount;
- currency;
- availability;
- quantity restrictions;
- product attributes;
- estimated marketplace delivery;
- marketplace shipping;
- eligibility/restrictions;
- provenance/confidence of important fields.

Design a resilient resolution ladder.

Prefer authoritative/structured sources where available.

Potential stages:

authoritative marketplace integration
→ structured metadata
→ PDP extraction
→ browser extraction
→ vision-assisted extraction
→ customer confirmation
→ operator review.

Do not couple quote calculations to Amazon DOM structure.

Normalize the resolved product before pricing.

Never fabricate:

- price;
- variation;
- availability;
- shipping;
- seller;
- delivery estimate.

If critical information is missing:

- keep the journey usable;
- distinguish confirmed from inferred values;
- calculate only when deterministically safe;
- request customer confirmation or operator review where required.

Produce:

- `docs/product/product-resolution.md`
- `docs/ux/amazon-resolution-journeys.md`
- `docs/architecture/product-resolution-architecture.md`

Implement responsible non-gated behavior and sandbox fixtures for gated integrations.

---

# PHASE 5 — Front office (product/UX architecture)

> **Sequencing clarification (added 2026-08-15, authoritative).** This phase is **discovery and design only**: information architecture, route/screen inventory, interaction specification, state coverage, responsive behaviour, trust/conversion patterns, and journey-to-screen mapping. **Do not perform mass frontend implementation here.** Broad production UI implementation waits on the design system (Phase 8) and on the consistent implementation plan produced by Phases 5–12. See `docs/program/PROJECT-STATE.md` § "Program sequencing clarification".

Design a mature customer application using **Next.js**.

Discover the complete information architecture before mass implementation.

Evaluate requirements for:

- landing / paste-link;
- URL resolution;
- product confirmation;
- variation confirmation;
- quote;
- quote explanation;
- authentication;
- signup;
- login;
- OTP/password/identity-provider behavior where appropriate;
- personal onboarding;
- business onboarding;
- organization creation/joining where approved;
- addresses;
- checkout;
- payment;
- payment return;
- pending payment;
- payment failure;
- order confirmation;
- order list;
- order detail;
- tracking;
- order exceptions;
- price-changed decisions;
- out-of-stock decisions;
- refunds;
- support;
- profile/settings;
- organization/business settings where approved;
- notifications;
- sandbox/demo controls where appropriate.

Use installed UI/UX capabilities for:

- information architecture;
- accessibility;
- responsive layout;
- forms;
- interaction states;
- conversion/trust;
- RTL;
- Persian-first UX;
- mobile usability;
- error recovery.

Use design-system/frontend-design tools for consistent implementation.

Do not make decorative redesign decisions without product/UX rationale.

---

# PHASE 6 — Backoffice operating model and Vite admin (discovery/design)

> **Sequencing clarification (added 2026-08-15, authoritative).** This phase **discovers and designs** the backoffice operating model, information architecture and UX. **Do not perform mass implementation here.** The Vite + React migration and screen build-out are implementation work packages sequenced by Phase 12, after the design system (Phase 8) and RBAC (Phase 7). See `docs/program/PROJECT-STATE.md` § "Program sequencing clarification".

Build a mature operations-grade backoffice using **Vite + React**.

Begin with operating-model discovery.

Do not mechanically generate CRUD pages from database tables.

Distinguish:

- RESOURCE MANAGEMENT
- OPERATIONAL WORKFLOWS

Investigate capabilities including:

- operational overview;
- exception queue;
- customers;
- organizations/business customers;
- internal users;
- roles;
- permissions;
- teams;
- customer orders;
- procurement orders;
- product requests;
- product-resolution reviews;
- shipments;
- warehouse/fulfillment;
- countries;
- supported countries;
- routes;
- service zones;
- providers;
- marketplace configuration;
- payment providers;
- FX providers;
- logistics/carrier providers;
- customs configuration;
- warehouses;
- restrictions;
- rate cards/economic configuration;
- payments;
- refunds;
- ledger/finance;
- reconciliation;
- support cases;
- notification operations;
- compliance/risk where justified;
- audit logs;
- sandbox/test sessions;
- scenario management;
- integration health;
- configuration/feature management.

For resource-oriented areas support, where appropriate:

- list;
- detail;
- create;
- update;
- archive/delete when domain-safe;
- bulk actions;
- pagination;
- sorting;
- filtering;
- search;
- saved filters/views;
- exports;
- history;
- audit information;
- permissions.

For workflow-oriented operations use task-specific commands instead of generic field mutation.

Examples:

- retry procurement;
- approve review;
- resolve price breach;
- issue refund;
- reassign case;
- advance sandbox clock;
- replay provider scenario.

High-risk/destructive actions require appropriate authorization, confirmation, and auditability.

---

# PHASE 7 — RBAC and authorization

Discover and implement mature authorization.

Do not enforce authorization only by hiding navigation.

Backend authorization is authoritative.

Model where appropriate:

- Permission
- Role
- RolePermission
- UserRole and/or membership-scoped role
- Scope
- Audit trail

Investigate whether roles are:

- global;
- organization-scoped;
- operational-team-scoped;
- or combinations.

Frontends consume permissions to shape UX, but backend checks remain authoritative.

---

# PHASE 8 — Design system

Before mass screen implementation, create the design system.

Use installed UI/UX, design-system, and frontend-design capabilities.

Define:

- visual principles;
- relationship between customer and admin surfaces;
- typography;
- Persian typography;
- spacing;
- grid;
- semantic color tokens;
- density;
- elevation;
- borders/radii;
- icons;
- states;
- forms;
- tables;
- navigation;
- dialogs/drawers;
- alerts;
- statuses;
- timelines;
- financial presentation;
- responsive behavior;
- accessibility;
- motion;
- reduced motion;
- empty/loading/error states.

Prefer reusable, tokenized primitives.

Do not scatter hardcoded visual values.

Produce:

`docs/design/design-system.md`

and implementation-level tokens/components.

---

# PHASE 9 — Sandbox / demo environment

Treat sandbox as a first-class platform capability.

Preserve and expand the existing sandbox architecture and virtual clock.

Do not replace it with disconnected frontend mocks.

The same domain/application flows should execute in sandbox. Only provider adapters/configuration should differ.

Create deterministic scenarios such as:

## Product resolution
- successful Amazon resolution;
- incomplete information;
- unavailable;
- manual review.

## Quote
- normal quote;
- FX outage;
- price change.

## Payment
- Stripe-style mock checkout;
- PayPal-style mock checkout;
- Iranian-gateway-style mock where useful;
- declined;
- timeout;
- asynchronous settlement;
- success;
- duplicate callback.

## Procurement
- success;
- price increase absorbed;
- max-procurement-price breach;
- out of stock;
- provider failure.

## Fulfillment
- warehouse received;
- international transit;
- customs hold;
- customs released;
- local carrier;
- tracking silence;
- delivered.

## Post-order
- support;
- refund;
- reconciliation issue.

Mock payment screens must be visibly sandbox implementations and must not falsely claim to contact real providers.

Front office, backoffice, API, worker, and sandbox must operate as one integrated testable environment.

Switching via environment/configuration must be explicit and safe.

Create a sandbox journey matrix and end-to-end tests.

---

# PHASE 10 — Backend, domain, and API requirements

NestJS remains the backend framework.

Preserve strong existing patterns unless evidence supports change:

- modular monolith;
- bounded modules;
- ports and adapters;
- domain value objects;
- deterministic finance;
- state machines;
- idempotency;
- transactional outbox;
- domain/integration events;
- adapter composition;
- resilience layers.

Do not produce fragmented or junior APIs.

Before creating an endpoint, derive it from:

`USER JOURNEY`
→ `USE CASE`
→ `APPLICATION COMMAND/QUERY`
→ `DOMAIN CAPABILITY`
→ `API CONTRACT`

Use resource-oriented APIs for resource management.

Use explicit task/command APIs for domain actions.

Do not expose persistence internals.

Do not create generic update endpoints that permit invalid domain transitions.

Every public contract must have:

- schema;
- validation;
- authorization;
- error taxonomy;
- idempotency where required;
- tests;
- a real consumer.

No orphan endpoints.

No undocumented ad-hoc UI endpoints.

No required backend journey capability may be silently omitted.

---

# PHASE 11 — Traceability

Create and continuously maintain:

`docs/program/journey-capability-traceability.md`

For every important journey step record:

Journey
→ Screen/route
→ API
→ Application use case
→ Domain model
→ Persistence
→ External adapter/event
→ Permissions
→ Tests

The program is incomplete while required cells remain unintentionally empty.

---

# PHASE 12 — Work-package execution

After discovery/design is sufficiently mature, decompose implementation into independently verifiable work packages.

Each work package must include:

- objective;
- affected bounded contexts;
- journeys;
- design references;
- API changes;
- data changes;
- migration strategy;
- tests;
- acceptance criteria;
- rollback/reversal notes where relevant.

For every package follow:

DISCOVER
→ DESIGN
→ IMPLEMENT
→ UNIT TEST
→ INTEGRATION TEST
→ E2E JOURNEY TEST
→ UX/A11Y REVIEW
→ ARCHITECTURE REVIEW
→ GRAPHIFY REFRESH
→ UPDATE PROJECT STATE
→ COMMIT

Use isolated branches/worktrees for independent implementation units when supported.

Never allow parallel agents to edit the same high-contention files without explicit ownership.

---

# Quality gates

A journey is not complete because a screen renders.

Require all applicable gates:

- typecheck;
- lint;
- unit tests;
- integration tests;
- E2E journey tests;
- RBAC;
- loading/empty/error states;
- accessibility;
- RTL;
- responsive customer experience;
- desktop operational usability;
- audit requirements;
- idempotency;
- state-machine correctness;
- financial invariants;
- sandbox parity;
- API contract consistency.

Use browser automation to walk critical journeys.

Capture failures and fix them.

Never mark work complete based only on implementation confidence.

---

# Architecture protection

Preserve these critical concepts unless an ADR explicitly supersedes them:

- Money as a value object.
- Payment and procurement are different lifecycle states.
- Customer Order and Procurement Order are different aggregates.
- State transitions are controlled.
- Audit/timeline records are immutable where designed.
- Financial records remain deterministic.
- External providers sit behind ports.
- Composition root owns provider selection.
- Outbox/event consistency.
- Idempotency for money/third-party mutations.
- Multi-provider architecture where justified.
- Compliance constraints are not bypassed.

---

# Product-design principles

Optimize for:

- trust;
- clarity;
- operational control;
- exception handling;
- financial transparency;
- recovery from asynchronous failure;
- customer recognition of requested product;
- minimal uncertainty;
- progressive disclosure;
- low cognitive load;
- strong localization;
- accessibility;
- auditability.

Do not optimize primarily for visual novelty.

---

# Token and context efficiency

Token efficiency is an explicit requirement.

- Use Graphify before broad source reading.
- Delegate high-output exploration/testing/research to subagents.
- Return concise summaries to the master orchestrator.
- Store detailed findings in repository documents or Ruflo memory.
- Do not repeatedly paste large documents into context.
- Filter test/build/log output where possible.
- Prefer symbol/code navigation over repository-wide text searches.
- Prefer targeted file reads.
- Retrieve only memory relevant to the active work package.
- Periodically compact state into `PROJECT-STATE.md`.
- Do not repeatedly revisit accepted decisions unless new evidence invalidates them.

---

# Long-running autonomous execution

Use background subagents for independent work where supported.

Use goal-driven continuation for packages whose completion conditions can be objectively verified.

Do not stop merely because one implementation turn ended.

Continue until the active work package satisfies its acceptance criteria or reaches a legitimate external blocker.

Do not continuously re-plan already completed work.

Do not ask for routine confirmation.

Material decisions must be persisted in repository artifacts, ADRs, or memory rather than held only in conversation.

---

# First execution sequence

Do **not** immediately redesign screens.

Start with:

1. Verify installed capabilities and Ruflo health.
2. Inspect project instructions and persistent memory.
3. Read Graphify and governing documents.
4. Produce the current-state assessment.
5. Perform product-boundary discovery.
6. Produce actor/persona/account modeling.
7. Produce capability map.
8. Produce complete journey architecture.
9. Produce backoffice operating model.
10. Produce information architecture.
11. Produce Amazon-resolution findings.
12. Produce sandbox architecture.
13. Produce target architecture and ADRs.
14. Produce implementation work packages and dependency ordering.
15. Review all artifacts for contradictions, unjustified assumptions, missing journeys, and missing backend/UI/operational links.

Only after those steps should major implementation begin.

When discovery is sufficiently complete, continue automatically into the highest-priority implementation work package unless a legitimate external blocker prevents it.

---

# Program definition of done

This program is complete only when:

- product boundaries are documented;
- personas/actors and anti-personas are explicit;
- B2C/B2B account boundaries are explicit;
- intended journeys are modeled;
- every intended journey has UI coverage;
- every UI workflow has backend support;
- every backend human workflow has an operator surface where required;
- APIs map coherently to use cases and domains;
- backoffice runs on Vite + React;
- front office runs on Next.js;
- backend remains NestJS;
- RBAC is coherent and backend-enforced;
- sandbox supports end-to-end deterministic demonstrations;
- Amazon resolution has a normalized trustworthy model and degradation strategy;
- front/back/sandbox journeys are integrated;
- the design system is implemented;
- critical journeys pass automated browser/E2E validation;
- architecture invariants pass;
- Graphify reflects the intended architecture without unexplained structural drift;
- documentation reflects implemented reality;
- no known P0/P1 journey gap remains.

---

# Immediate command

Begin now with **PHASE 0**.

First inspect the available plugins, skills, orchestration configuration, Graphify artifacts, governing documents, and repository structure.

Create the Phase 0 assessment and program-state artifacts before making broad product-code changes.
