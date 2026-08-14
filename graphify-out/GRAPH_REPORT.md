# Graph Report - outputs  (2026-08-14)

## Corpus Check
- 169 files · ~99,968 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2038 nodes · 3734 edges · 157 communities (120 shown, 37 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 109 edges (avg confidence: 0.81)
- Token cost: 153,832 input · 0 output

## Community Hubs (Navigation)
- Back Office API Surface
- Order Search Contracts
- Drizzle Repositories & Schema
- Cache-Aside Layer
- Worker Dependencies
- Composition Root Wiring
- HTTP Middleware & Logging
- Back Office Pages
- Auth Service & Tokens
- Monorepo Build Config
- Ports & Sandbox Adapters
- Catalog & Order Services
- Money Value Object
- Admin TypeScript Config
- Web TypeScript Config
- Adapter Composition & Providers
- Front Office Checkout Pages
- Error Taxonomy
- Base TypeScript Config
- Front Office Dependencies
- Resilience Pipeline & Breaker
- RabbitMQ Broker & Topology
- src/Context
- Ops Service & Transitions
- Resolution Strategies
- Provider Failover & Registry
- Legacy Scaffold Adapters
- db/Package
- src/Repos
- admin/Package
- domain/Order State Machine
- src/Rate Limit
- src/Scenario
- src/Schemas
- modules/Sandbox Module
- Phase 0 3 Logistics Feasibility
- src/Types
- src/Procurement
- messaging/Package
- src/Ports
- src/Resolution
- storage/Package
- domain/Quote Engine
- cache/Package
- checkout/Page
- src/Index
- platform/Turbo
- observability/Package
- src/Schemas
- src/Repositories
- commerce/Package
- contracts/Package
- src/Outbox Relay
- sandbox/Package
- src/Redis Store
- src/Session
- platform-scaffold/Package
- Claude
- src/Metrics
- src/Circuit Breaker
- domain/Order
- platform-scaffold/Tsconfig
- api/Package
- src/Result
- resilience/Package
- validation/Package
- modules/Pricing
- modules/Ordering
- Feasibility Revalidation V0 2
- src/Ports
- modules/Sandbox Module
- Feasibility Revalidation V0 2
- src/Env
- src/Strategies
- src/Money
- api/Package
- src/Marketplace
- track/Page
- Phase 0 3 Logistics Feasibility
- Feasibility Revalidation V0 2
- src/Unit Of Work
- api/Tsconfig
- og/Package
- app/Layout
- src/Parse
- src/Resilience Test
- src/Adapters
- src/Messages
- platform/Readme
- src/Main
- og/Tsconfig
- worker/Tsconfig
- core/Package
- src/Persian
- Claude
- Technical Blueprint V1
- Phase 0 3 Logistics Feasibility
- composition/Adapters
- src/Repositories
- src/Repositories
- src/Demo
- Claude
- src/App Module
- src/Repositories
- src/Repositories
- src/Session
- src/Adapters
- src/Api
- scripts/Lifecycle
- scripts/Smoke
- Claude
- Technical Blueprint V1
- api/Package
- cache/Tsconfig
- commerce/Tsconfig
- contracts/Tsconfig
- src/Events
- core/Tsconfig
- db/Tsconfig
- messaging/Tsconfig
- observability/Tsconfig
- resilience/Tsconfig
- sandbox/Tsconfig
- storage/Tsconfig
- validation/Tsconfig
- common/Zod Pipe
- src/Migrate
- src/Redis Store
- Phase 0 3 Logistics Feasibility
- app/Layout
- modules/Sandbox Module
- src/Seed
- api/Package
- Mcp
- api/Package
- api/Package
- admin/Next Config
- admin/Next Env D
- api/Package
- api/Package
- api/Package
- api/Package
- api/Package
- api/Package
- api/Package
- api/Package
- api/Package
- api/Package
- api/Package
- api/Package
- web/Next Config
- web/Next Env D

## God Nodes (most connected - your core abstractions)
1. `Money` - 70 edges
2. `uuidv7()` - 32 edges
3. `main()` - 21 edges
4. `MarketplaceId` - 20 edges
5. `AppError` - 20 edges
6. `AuthenticatedActor` - 19 edges
7. `StorePort` - 19 edges
8. `compilerOptions` - 19 edges
9. `Database` - 18 edges
10. `compilerOptions` - 17 edges

## Surprising Connections (you probably didn't know these)
- `Scaffold Stub Adapters for Every Gated Port` --semantically_similar_to--> `Sandbox: Scenario Adapters Behind the Real Ports`  [INFERRED] [semantically similar]
  platform-scaffold/README.md → platform/README.md
- `Scaffold Composition Root (src/app.ts)` --semantically_similar_to--> `Composition Root as the Only Adapter-Aware Place`  [INFERRED] [semantically similar]
  platform-scaffold/README.md → CLAUDE.md
- `Prototype: Admin Exception Queue + Procurement Copilot` --semantically_similar_to--> `GET /admin/exceptions — Ranked Exception Queue`  [INFERRED] [semantically similar]
  prototype.html → platform/docs/openapi.yaml
- `Three Exogenous Gates (payment, customs, compliance)` --conceptually_related_to--> `Ports & Adapters (Hexagonal) Architecture`  [INFERRED]
  feasibility-revalidation-v0.2.md → technical-blueprint-v1.md
- `Prototype: Stage Flow Map` --references--> `Order State Machine & Transition Table`  [INFERRED]
  prototype.html → technical-blueprint-v1.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **The Six Gated Seam Ports** — technical_blueprint_v1_storeadapter_port, technical_blueprint_v1_fxprovider_port, technical_blueprint_v1_paymentgateway_port, technical_blueprint_v1_procurementexecutor_port, technical_blueprint_v1_carrieradapter_port, technical_blueprint_v1_customsestimator_port, technical_blueprint_v1_ports_and_adapters [EXTRACTED 1.00]
- **Money-Correctness Invariant Set (quote → pay → purchase)** — technical_blueprint_v1_money_value_object, technical_blueprint_v1_revalidate_at_checkout, claude_payment_not_purchased, claude_max_procurement_price_guard, claude_viability_gate, platform_readme_append_only_ledger [EXTRACTED 1.00]
- **Logistics Viability Ruleset (v0.3 economics enforced in product)** — phase_0_3_logistics_feasibility_logistics_overhead_ratio, phase_0_3_logistics_feasibility_value_density_gate, phase_0_3_logistics_feasibility_minimum_order_value_rule, phase_0_3_logistics_feasibility_consolidation, phase_0_3_logistics_feasibility_category_allowlist, claude_viability_gate [EXTRACTED 1.00]

## Communities (157 total, 37 thin omitted)

### Community 0 - "Back Office API Surface"
Cohesion: 0.05
Nodes (43): Actor, AuthenticatedActor, Idempotent(), Public(), Roles(), AdminController, FinanceService, normaliseOrderQuery() (+35 more)

### Community 1 - "Order Search Contracts"
Cohesion: 0.05
Nodes (42): addressSchema, adminOrderRowSchema, AdminOrderSearchQuery, AdminOrderSearchResultDto, adminOrderSearchResultSchema, advanceSandboxRequest, confirmProcurementRequest, createOrderRequest (+34 more)

### Community 2 - "Drizzle Repositories & Schema"
Cohesion: 0.07
Nodes (28): DbOptions, Executor, OrderStateValue, OrderTransitionInput, ProductRequestRepository, currencyEnum, customerRelations, idempotencyKeys (+20 more)

### Community 3 - "Cache-Aside Layer"
Cohesion: 0.08
Nodes (12): CacheAside, CacheAsideOptions, CacheKeys, sleep(), cacheAside(), CacheLayerMethodConfig, CacheLayerOptions, hashArgs() (+4 more)

### Community 4 - "Worker Dependencies"
Cohesion: 0.05
Nodes (40): dependencies, drizzle-orm, ioredis, jose, @xb/cache, @xb/commerce, @xb/contracts, @xb/core (+32 more)

### Community 5 - "Composition Root Wiring"
Cohesion: 0.12
Nodes (29): Global, InfrastructureModule, Module, CommerceModule, Module, DevGatewayModule, Module, escapeHtml() (+21 more)

### Community 6 - "HTTP Middleware & Logging"
Cohesion: 0.08
Nodes (21): Catch, CorrelationMiddleware, GlobalExceptionFilter, IdempotencyInterceptor, IdempotencyStore, IDEMPOTENT_KEY, isErrorEnvelope(), JwtAuthGuard (+13 more)

### Community 7 - "Back Office Pages"
Cohesion: 0.11
Nodes (23): FinancePage(), Copilot(), OrderInner(), EMPTY, Filters, IN_FLIGHT, OrderRow(), STATES (+15 more)

### Community 8 - "Auth Service & Tokens"
Cohesion: 0.10
Nodes (8): RFC-4122, AuthService, Injectable, publicRef(), uuidv7(), CustomerRepository, LedgerRepository, addresses

### Community 9 - "Monorepo Build Config"
Cohesion: 0.07
Nodes (29): devDependencies, turbo, @types/node, typescript, vitest, engines, node, typescript (+21 more)

### Community 10 - "Ports & Sandbox Adapters"
Cohesion: 0.10
Nodes (14): AdapterSet, StubCarrierAdapter, ProcurementPort, CarrierPort, FxPort, ShipmentLeg, SANDBOX_CATALOG, SandboxAdapterSet (+6 more)

### Community 11 - "Catalog & Order Services"
Cohesion: 0.12
Nodes (11): hydrateProduct(), toProductDto(), CatalogService, OrderService, QuoteService, serialiseBreakdown(), toQuoteDto(), Injectable (+3 more)

### Community 12 - "Money Value Object"
Cohesion: 0.11
Nodes (5): Money, sumMoney(), LedgerLine, toMoney(), syntheticProduct()

### Community 13 - "Admin TypeScript Config"
Cohesion: 0.07
Nodes (27): compilerOptions, allowImportingTsExtensions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib (+19 more)

### Community 14 - "Web TypeScript Config"
Cohesion: 0.07
Nodes (27): compilerOptions, allowImportingTsExtensions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib (+19 more)

### Community 15 - "Adapter Composition & Providers"
Cohesion: 0.11
Nodes (13): buildAdapters(), BuildAdaptersOptions, buildSmsProviders(), buildStoreStrategies(), CategoryPriorCustomsAdapter, FakeSmsAdapter, StubSmsAdapter, noPin (+5 more)

### Community 16 - "Front Office Checkout Pages"
Cohesion: 0.11
Nodes (17): SETTLED_STATES, OrdersPage(), api, ApiError, auth, formatRelativeTime(), PERSIAN_DIGITS, refreshTokens() (+9 more)

### Community 17 - "Error Taxonomy"
Cohesion: 0.12
Nodes (15): AppError, AppErrorOptions, CircuitOpenError, ConflictError, ForbiddenError, InternalError, InvalidCredentialsError, NotFoundError (+7 more)

### Community 18 - "Base TypeScript Config"
Cohesion: 0.08
Nodes (25): compilerOptions, allowImportingTsExtensions, emitDecoratorMetadata, esModuleInterop, exactOptionalPropertyTypes, experimentalDecorators, forceConsistentCasingInFileNames, isolatedModules (+17 more)

### Community 19 - "Front Office Dependencies"
Cohesion: 0.08
Nodes (24): framer-motion, dependencies, framer-motion, next, react, react-dom, @xb/contracts, devDependencies (+16 more)

### Community 20 - "Resilience Pipeline & Breaker"
Cohesion: 0.15
Nodes (18): resilient(), isAppError(), isRetryable(), BreakerSnapshot, BreakerState, CircuitBreakerOptions, instrument(), InstrumentOptions (+10 more)

### Community 21 - "RabbitMQ Broker & Topology"
Cohesion: 0.15
Nodes (14): DomainEvent, Broker, BrokerOptions, Handler, assertTopology(), BINDINGS, delayQueueName(), EXCHANGES (+6 more)

### Community 22 - "src/Context"
Cohesion: 0.14
Nodes (15): createRedis(), routeByContext(), SandboxPortName, SYNCHRONOUS_MEMBERS, normalizeCarrierStatus(), main(), createDatabase(), ProcessedEventRepository (+7 more)

### Community 23 - "Ops Service & Transitions"
Cohesion: 0.13
Nodes (9): zodBody(), assertTransition(), AdminModule, OpsService, summariseException(), Module, confirmOperatorPurchase(), ProcurementRepository (+1 more)

### Community 24 - "Resolution Strategies"
Cohesion: 0.13
Nodes (14): asString(), cap(), extractBrand(), extractImage(), extractJsonLdProduct(), extractWeightKg(), isRecord(), JsonLdOffer (+6 more)

### Community 25 - "Provider Failover & Registry"
Cohesion: 0.12
Nodes (9): ProviderUnavailableError, BreakerRegistry, FailoverOptions, MemoryStickyStore, ProviderEntry, ProviderRegistry, SelectionStrategy, StickyStore (+1 more)

### Community 26 - "Legacy Scaffold Adapters"
Cohesion: 0.16
Nodes (14): AssistedProcurement, StubCarrier, StubCustoms, StubPayment, Marketplace, PaymentGateway, PaymentResult, ProcurementExecutor (+6 more)

### Community 27 - "db/Package"
Cohesion: 0.09
Nodes (22): drizzle-kit, dependencies, drizzle-orm, postgres, @xb/core, @xb/observability, devDependencies, drizzle-kit (+14 more)

### Community 28 - "src/Repos"
Cohesion: 0.17
Nodes (10): App, AppOptions, Deps, Quote, CarrierAdapter, Ledger, LedgerEntry, OrderRepo (+2 more)

### Community 29 - "admin/Package"
Cohesion: 0.09
Nodes (21): dependencies, next, react, react-dom, @xb/contracts, devDependencies, @types/react, @types/react-dom (+13 more)

### Community 30 - "domain/Order State Machine"
Cohesion: 0.13
Nodes (18): buildOrderDto(), alertFor(), ALERTS, buildCustomerTimeline(), canTransition(), CARRIER_STATUS_MAP, EXCEPTION_STATES, firstTimestampForStep() (+10 more)

### Community 31 - "src/Rate Limit"
Cohesion: 0.14
Nodes (8): Bucket, BucketConfig, DistributedRateLimiter, MemoryRateLimiter, RateLimiter, RedisLike, sleep(), ResolutionPipelineOptions

### Community 32 - "src/Scenario"
Cohesion: 0.20
Nodes (14): buildSandboxAdapters(), uuid(), createSandboxAdapters(), harness(), BASE, getScenario(), PaymentBehaviour, ScenarioId (+6 more)

### Community 33 - "src/Schemas"
Cohesion: 0.14
Nodes (18): CUSTOM_MESSAGES, isIranianMobile(), isValidNationalId(), normalizeDigits(), normalizeIranianMobile(), FIELD_LABELS, flexibleInt, iranianMobile (+10 more)

### Community 34 - "modules/Sandbox Module"
Cohesion: 0.19
Nodes (10): Delete, SandboxController, Body, Controller, Get, HttpCode, Param, Post (+2 more)

### Community 35 - "Phase 0 3 Logistics Feasibility"
Cohesion: 0.11
Nodes (19): Agentic Commerce Protocol (ACP, OpenAI/Stripe), Business Line 3: Enterprise Import/Export Procurement Desk, Business Line 2: Merchant Fulfillment Platform, Prepaid Merchant Wallet Money Model, Phase Sequencing 0.3 → 5 (consumer, merchant, enterprise, agentic), One Engine, Three Demand Surfaces, Universal Commerce Protocol (UCP, Google), Wholesaler Mode vs Agent Mode (+11 more)

### Community 36 - "src/Types"
Cohesion: 0.15
Nodes (13): MarketplaceCapabilities, MARKETPLACES, ContributableFields, FieldConfidence, FieldProvenance, Incomplete, MIN_FIELD_CONFIDENCE, OperatorTask (+5 more)

### Community 37 - "src/Procurement"
Cohesion: 0.26
Nodes (7): AgenticPurchaseExecutor, ApiPurchaseExecutor, ProcurementEngine, ProcurementEngineOptions, ProcurementMode, ProcurementRequest, ProcurementResult

### Community 38 - "messaging/Package"
Cohesion: 0.11
Nodes (17): amqplib, dependencies, amqplib, @xb/core, @xb/observability, devDependencies, @types/amqplib, exports (+9 more)

### Community 39 - "src/Ports"
Cohesion: 0.13
Nodes (10): StubPaymentAdapter, LocalizedMessage, IdentityPort, NotificationChannel, NotificationPort, PaymentIntent, PaymentIntentStatus, PaymentVerification (+2 more)

### Community 40 - "src/Resolution"
Cohesion: 0.16
Nodes (5): MarketplaceDescriptor, RateLimitExceededError, ResolutionPipeline, ResolutionStrategy, StrategyResult

### Community 41 - "storage/Package"
Cohesion: 0.12
Nodes (16): @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, dependencies, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, @xb/core, @xb/observability, exports (+8 more)

### Community 42 - "domain/Quote Engine"
Cohesion: 0.16
Nodes (12): ComputedQuote, DEFAULT_RATE_CARD, dimensionalWeightKg(), marginAtRisk(), QuoteBreakdown, QuoteEngine, RateCard, usdToIrr8() (+4 more)

### Community 43 - "cache/Package"
Cohesion: 0.12
Nodes (16): dependencies, ioredis, @xb/core, @xb/observability, @xb/resilience, exports, ioredis, @xb/core (+8 more)

### Community 44 - "checkout/Page"
Cohesion: 0.28
Nodes (10): CheckoutInner(), Step, HomePage(), QuoteCountdown(), ProductCard(), QuoteBreakdown(), formatMoney(), toPersianDigits() (+2 more)

### Community 45 - "src/Index"
Cohesion: 0.14
Nodes (5): StoragePort, InMemoryStorageAdapter, MinioStorageAdapter, StorageKeys, StorageOptions

### Community 46 - "platform/Turbo"
Cohesion: 0.13
Nodes (15): dependsOn, outputs, cache, persistent, dist/**, .next/**, out/**, $schema (+7 more)

### Community 47 - "observability/Package"
Cohesion: 0.13
Nodes (14): pino, pino-pretty, dependencies, pino, pino-pretty, @xb/core, exports, @xb/core (+6 more)

### Community 48 - "src/Schemas"
Cohesion: 0.14
Nodes (13): AuthModule, pinnedOtpCode(), Module, createAddressRequest, operatorLoginRequest, otpStartRequest, otpVerifyRequest, refreshRequest (+5 more)

### Community 50 - "commerce/Package"
Cohesion: 0.13
Nodes (14): dependencies, @xb/core, @xb/observability, @xb/resilience, exports, @xb/core, @xb/observability, @xb/resilience (+6 more)

### Community 51 - "contracts/Package"
Cohesion: 0.13
Nodes (14): dependencies, @xb/core, @xb/validation, zod, exports, @xb/core, @xb/validation, zod (+6 more)

### Community 52 - "src/Outbox Relay"
Cohesion: 0.19
Nodes (5): OutboxRelay, OutboxRow, OutboxSource, RelayOptions, sleep()

### Community 53 - "sandbox/Package"
Cohesion: 0.13
Nodes (14): dependencies, @xb/commerce, @xb/core, @xb/observability, exports, @xb/commerce, @xb/core, @xb/observability (+6 more)

### Community 54 - "src/Redis Store"
Cohesion: 0.29
Nodes (3): AsyncSandboxSessionStore, RedisSandboxSessionStore, SandboxSession

### Community 56 - "platform-scaffold/Package"
Cohesion: 0.13
Nodes (14): description, devDependencies, typescript, engines, node, typescript, name, private (+6 more)

### Community 57 - "Claude"
Cohesion: 0.15
Nodes (14): Composition Root as the Only Adapter-Aware Place, INVARIANT: Max-Procurement-Price Guard, INVARIANT: Payment ≠ Purchased, Implemented 24-State Order State Machine, POST /admin/orders/{id}/transition — Guarded Manual State Change, POST /webhooks/payments/{provider} — Gateway Settlement Callback, POST /admin/orders/{id}/reprice — Approve New Max Procurement Price, The Five Rules That Shape Everything (+6 more)

### Community 58 - "src/Metrics"
Cohesion: 0.18
Nodes (6): active, Labels, METRIC, Metrics, NoopMetrics, timed()

### Community 59 - "src/Circuit Breaker"
Cohesion: 0.20
Nodes (3): Breaker, circuitBreaker(), countsAsProviderFailure()

### Community 60 - "domain/Order"
Cohesion: 0.16
Nodes (9): carrierStatusToState(), ORDER_STATES, OrderState, TimelineEntry, TRANSITIONS, DomainEvent, EventHandler, genId() (+1 more)

### Community 61 - "platform-scaffold/Tsconfig"
Cohesion: 0.14
Nodes (13): compilerOptions, allowImportingTsExtensions, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, noEmit, skipLibCheck (+5 more)

### Community 62 - "api/Package"
Cohesion: 0.15
Nodes (13): @nestjs/common, dependencies, drizzle-orm, @nestjs/common, rxjs, @xb/contracts, @xb/observability, @xb/validation (+5 more)

### Community 63 - "src/Result"
Cohesion: 0.15
Nodes (3): Err, Ok, Result

### Community 64 - "resilience/Package"
Cohesion: 0.15
Nodes (12): dependencies, @xb/core, @xb/observability, exports, @xb/core, @xb/observability, name, private (+4 more)

### Community 65 - "validation/Package"
Cohesion: 0.15
Nodes (12): dependencies, @xb/core, zod, exports, @xb/core, zod, name, private (+4 more)

### Community 66 - "modules/Pricing"
Cohesion: 0.24
Nodes (7): StubFx, FREIGHT_USD_PER_KG, QuoteBreakdown, QuoteEngine, CustomsEstimator, FxProvider, Currency

### Community 68 - "Feasibility Revalidation V0 2"
Cohesion: 0.17
Nodes (12): Persian-First RTL, Bilingual fa/en Validation Errors, DECISION A1: AI as Operating Substrate, Not a Feature, Deterministic Ledger + LLM Fuzzy Reconciliation Matcher, Persian-First Trust & Support AI Layer, Postgres 17 Service (C collation for stable cursor pagination), GET /admin/finance/ledger and /admin/finance/unmatched, Database-Enforced Append-Only Ledger, Scaffold Stub Adapters for Every Gated Port (+4 more)

### Community 69 - "src/Ports"
Cohesion: 0.20
Nodes (3): Inject, StorePort, PaymentPort

### Community 70 - "modules/Sandbox Module"
Cohesion: 0.29
Nodes (4): SandboxService, Inject, Injectable, SandboxSessionDto

### Community 71 - "Feasibility Revalidation V0 2"
Cohesion: 0.20
Nodes (11): AI Exception Classifier / Ranked Ops Queue, HSPO (Human Seconds Per Order) Metric, AI Landed-Cost / Weight Predictor, The Moat: Compliant Operation + Logistics Data Flywheel, Plan-Follower + Human Confirmation Procurement Pattern, STP (Straight-Through Processing) North-Star Metric, GET /admin/exceptions — Ranked Exception Queue, GET /admin/procurements/{id}/copilot and POST .../confirm (+3 more)

### Community 72 - "src/Env"
Cohesion: 0.22
Nodes (6): AppModule, Module, bootstrap(), envSchema, loadEnv(), closeDatabase()

### Community 73 - "src/Strategies"
Cohesion: 0.24
Nodes (4): MarketplaceId, ApiResolutionStrategy, MarketplaceApiClient, StructuredDataStrategy

### Community 74 - "src/Money"
Cohesion: 0.22
Nodes (6): CURRENCIES, CurrencyMismatchError, EXPONENT, InvalidMoneyError, MoneyJSON, RoundingMode

### Community 75 - "api/Package"
Cohesion: 0.20
Nodes (9): name, private, scripts, dev, start, test, typecheck, type (+1 more)

### Community 77 - "track/Page"
Cohesion: 0.31
Nodes (5): TrackInner(), OrderTimeline(), formatDateTime(), STATE_BADGES, TimelineStep

### Community 78 - "Phase 0 3 Logistics Feasibility"
Cohesion: 0.22
Nodes (9): INVARIANT: Viability Gate at Order Creation, Bug: Money Lost Methods on JSONB Deserialization, RULE: Category Allowlist by Density, RULE: Consolidation as a Margin Tool, Logistics Overhead Ratio, RULE: Minimum Order Value Gate, RULE: Value-Density Beats Proximity, Money Value Object (+1 more)

### Community 79 - "Feasibility Revalidation V0 2"
Cohesion: 0.22
Nodes (9): Risk R11: AI Extraction Hallucination, ResolverConfidence Scoring, Universal Adapter / Two-Tier Product Resolver, Vision-LLM Structured Extraction, POST /quotes/{id}/refresh — Revalidate Offer, Availability and FX, ResolutionPipeline / Resolution Ladder, Prototype: Quote TTL Countdown + Simulated Price Change, RULE: Revalidate at Checkout (+1 more)

### Community 80 - "src/Unit Of Work"
Cohesion: 0.28
Nodes (4): Inject, Inject, Database, UnitOfWork

### Community 81 - "api/Tsconfig"
Cohesion: 0.22
Nodes (8): compilerOptions, emitDecoratorMetadata, experimentalDecorators, strictPropertyInitialization, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 82 - "og/Package"
Cohesion: 0.22
Nodes (8): name, private, scripts, dev, start, typecheck, type, version

### Community 83 - "app/Layout"
Cohesion: 0.28
Nodes (6): metadata, viewport, DemoPanel(), groupByStage(), STAGE_LABELS, sandbox

### Community 84 - "src/Parse"
Cohesion: 0.44
Nodes (6): ValidationIssue, issueCode(), issueParams(), parseOrThrow(), parseSafe(), translateIssues()

### Community 86 - "src/Adapters"
Cohesion: 0.33
Nodes (4): catalogEntry(), SandboxPaymentAdapter, bump(), logSandbox()

### Community 87 - "src/Messages"
Cohesion: 0.39
Nodes (8): enNum(), faNum(), FieldLabels, isLocalized(), issueMessage(), labelFor(), isolateLtr(), toPersianDigits()

### Community 88 - "platform/Readme"
Cohesion: 0.25
Nodes (8): Cache-Aside with Single-Flight and TTL Jitter, Idempotency Key on Money/Third-Party Mutations, Failed Attempt: Lifecycle Script Grepping the Shared Worker Log, RedisSandboxSessionStore (shared API/worker sandbox sessions), Redis Service (noeviction, mapped to 6380), scripts/lifecycle.sh End-to-End Lifecycle Driver, Sandbox: Scenario Adapters Behind the Real Ports, Sandbox Virtual Clock + Seeded Determinism

### Community 89 - "src/Main"
Cohesion: 0.36
Nodes (7): DEFAULT_PREVIEW, escapeHtml(), isCrawler(), PORT, PreviewData, renderMeta(), server

### Community 90 - "og/Tsconfig"
Cohesion: 0.25
Nodes (7): compilerOptions, emitDecoratorMetadata, experimentalDecorators, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 91 - "worker/Tsconfig"
Cohesion: 0.25
Nodes (7): compilerOptions, emitDecoratorMetadata, experimentalDecorators, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 92 - "core/Package"
Cohesion: 0.25
Nodes (7): exports, name, private, scripts, typecheck, type, version

### Community 93 - "src/Persian"
Cohesion: 0.43
Nodes (7): normalizeForComparison(), normalizeForDisplay(), normalizeLetters(), stripDiacritics(), stripZeroWidth(), displayText(), optionalDisplayText()

### Community 94 - "Claude"
Cohesion: 0.29
Nodes (7): Deviation 1: No SSR — Static Export + OG Meta Service, platform/ Monorepo Package & App Map, Handoff: Current Build State and Verified Surface, Phase 0.4 Open GATEs (freight quotes, customs, hub partner, last-mile, legal), pnpm Workspace Globs (packages/*, apps/*), CustomsEstimator Port, DECISION / GATE / BUILD / RULE Status Markers

### Community 95 - "Technical Blueprint V1"
Cohesion: 0.29
Nodes (7): Deviation 2: RabbitMQ, Not BullMQ, Transactional Outbox + Event-Only Cross-Module Communication, MinIO Service + Bucket Init (xb-packages, xb-documents), RabbitMQ 4 Service, Async Workers (FX refresh, procurement, tracking, recon), Bounded Contexts and Public Domain Events, FxProvider Port

### Community 96 - "Phase 0 3 Logistics Feasibility"
Cohesion: 0.29
Nodes (7): Three Exogenous Gates (payment, customs, compliance), Pending Real Integrations Behind PaymentPort / ProcurementPort / LogisticsPort, RULE: Goods Only, Never Cross-Border Value Transfer, Model B: PUDO / Pickup-Point Network, Model D: Hawala-Style 'Goods Gate' Agent Network, Deliberately Unbuilt Seams (real adapters, merchant panel, WS, recon), Compliance Gate (master switch)

### Community 97 - "composition/Adapters"
Cohesion: 0.38
Nodes (3): StubFxAdapter, Currency, FxQuote

### Community 100 - "src/Demo"
Cohesion: 0.67
Nodes (6): buildApp(), happyPath(), hr(), main(), priceGuard(), formatMoney()

### Community 101 - "Claude"
Cohesion: 0.40
Nodes (6): Multi-Provider Registry + Failover Chain, Port Proxy Chain (cache → breaker → retry → timeout → instrumentation → adapter), Bug: Failover Proxy `then` Trap Made Ports Look Thenable, OTel Collector Service (vendor-neutral telemetry sink), GET /admin/providers — Provider Health and Circuit-Breaker State, OTLP Traces/Metrics/Logs Pipelines

### Community 102 - "src/App Module"
Cohesion: 0.40
Nodes (4): HealthController, Controller, Get, healthcheck()

### Community 107 - "src/Api"
Cohesion: 0.53
Nodes (4): app, readBody(), send(), startServer()

### Community 108 - "scripts/Lifecycle"
Cohesion: 0.53
Nodes (4): bad(), ok(), lifecycle.sh script, step()

### Community 109 - "scripts/Smoke"
Cohesion: 0.53
Nodes (4): bad(), head(), ok(), smoke.sh script

### Community 110 - "Claude"
Cohesion: 0.40
Nodes (5): @xb/contracts Zod Schemas as Single Source of Truth, Deviation 3: Back Office in Next.js, Not React+Vite, Bug: Fastify Rejected Empty JSON Bodies, platform/docs/openapi.yaml — /v1 API Surface, scripts/smoke.sh API-Level Smoke Checks

### Community 111 - "Technical Blueprint V1"
Cohesion: 0.40
Nodes (5): BUILD: Last-Mile Provider Abstraction, Modular Monolith (not microservices), PaymentGateway Port, Ports & Adapters (Hexagonal) Architecture, ProcurementExecutor Port

### Community 112 - "api/Package"
Cohesion: 0.40
Nodes (5): devDependencies, @swc/core, @swc-node/register, @swc/core, @swc-node/register

### Community 113 - "cache/Tsconfig"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 114 - "commerce/Tsconfig"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 115 - "contracts/Tsconfig"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 116 - "src/Events"
Cohesion: 0.40
Nodes (3): EVENT_TYPES, EventEnvelopeInput, EventType

### Community 117 - "core/Tsconfig"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 118 - "db/Tsconfig"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 119 - "messaging/Tsconfig"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 120 - "observability/Tsconfig"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 121 - "resilience/Tsconfig"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 122 - "sandbox/Tsconfig"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 123 - "storage/Tsconfig"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 124 - "validation/Tsconfig"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 128 - "Phase 0 3 Logistics Feasibility"
Cohesion: 1.00
Nodes (3): Escrow + Reputation Trust Rails, Grabr (P2P traveler delivery marketplace), Model C: Crowdshipping / Traveler Network

## Ambiguous Edges - Review These
- `@xb/contracts Zod Schemas as Single Source of Truth` → `Bug: Fastify Rejected Empty JSON Bodies`  [AMBIGUOUS]
  handoff.md · relation: conceptually_related_to

## Knowledge Gaps
- **551 isolated node(s):** `21st`, `name`, `version`, `private`, `type` (+546 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **37 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `@xb/contracts Zod Schemas as Single Source of Truth` and `Bug: Fastify Rejected Empty JSON Bodies`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `Money` connect `Money Value Object` to `Drizzle Repositories & Schema`, `Composition Root Wiring`, `Ports & Sandbox Adapters`, `Adapter Composition & Providers`, `src/Context`, `Ops Service & Transitions`, `Resolution Strategies`, `domain/Order State Machine`, `src/Scenario`, `src/Types`, `src/Procurement`, `src/Ports`, `src/Resolution`, `domain/Quote Engine`, `src/Repositories`, `src/Ports`, `src/Money`, `src/Adapters`, `composition/Adapters`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Why does `AdminController` connect `Back Office API Surface` to `Ops Service & Transitions`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Why does `uuidv7()` connect `Auth Service & Tokens` to `Drizzle Repositories & Schema`, `src/Repositories`, `src/Repositories`, `Composition Root Wiring`, `Catalog & Order Services`, `src/Index`, `src/Schemas`, `src/Unit Of Work`, `src/Context`, `Ops Service & Transitions`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Are the 7 inferred relationships involving `main()` (e.g. with `.findById()` and `.transition()`) actually correct?**
  _`main()` has 7 INFERRED edges - model-reasoned connections that need verification._
- **What connects `21st`, `name`, `version` to the rest of the system?**
  _551 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Back Office API Surface` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._