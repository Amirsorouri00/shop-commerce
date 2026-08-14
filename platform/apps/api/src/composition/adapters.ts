import { Redis } from 'ioredis';
import {
  Money,
  UpstreamError,
  type CarrierPort,
  type Currency,
  type CustomsPort,
  type FxPort,
  type FxQuote,
  type PaymentIntent,
  type PaymentPort,
  type PaymentVerification,
  type ShipmentLeg,
  type SmsPort,
} from '@xb/core';
import type { Env } from '@xb/contracts';
import { logger } from '@xb/observability';
import {
  ProviderRegistry,
  failover,
  withLayers,
  timeout,
  retry,
  circuitBreaker,
  instrument,
  breakerRegistry,
  type Layer,
} from '@xb/resilience';
import { RedisCacheStore, cacheAside, CacheKeys, hashUrl } from '@xb/cache';
import {
  MarketplaceRegistry,
  ResolutionPipeline,
  ProcurementEngine,
  DistributedRateLimiter,
  bucketConfigsFrom,
  MARKETPLACES,
  marketplaceRegistry,
  type MarketplaceId,
  type ResolutionContext,
  type ResolutionStrategy,
  type StrategyResult,
  type StorePort,
  type ProcurementPort,
} from '@xb/commerce';
import { createSandboxAdapters, type SandboxContext } from '@xb/sandbox';
import { MinioStorageAdapter } from '@xb/storage';

/**
 * The composition root.
 *
 * This is the only file in the application that names a concrete provider. Everything else
 * depends on a port interface. If adding a payment gateway or swapping a carrier requires an
 * edit anywhere outside this directory, the abstraction has leaked and the change is wrong.
 *
 * Every port is assembled the same way:
 *
 *     withLayers( failover(registry), [instrument, cache, breaker, retry, timeout] )
 *
 * The ordering is deliberate and explained in `docs/` §04 — briefly: instrumentation
 * outermost so it measures what the caller actually waited; cache above the breaker so a hit
 * survives a quarantined provider; breaker above retry so retries don't hammer a known-dead
 * provider; timeout innermost so each attempt gets its own deadline.
 */

export interface AdapterSet {
  readonly store: StorePort;
  readonly fx: FxPort;
  readonly payment: PaymentPort;
  readonly procurement: ProcurementPort;
  readonly carrier: CarrierPort;
  readonly customs: CustomsPort;
  readonly sms: SmsPort;
  readonly storage: MinioStorageAdapter;
}

// ─────────────────────── stub adapters (gated dependencies) ───────────────────────
//
// These satisfy the same contracts the real providers will. They exist so the core and both
// surfaces are fully functional before the payment, procurement, carrier and customs gates
// clear — which is the entire premise of the architecture.

class StubFxAdapter implements FxPort {
  readonly name = 'stub-fx';
  private readonly rates: Readonly<Record<string, number>> = {
    AED_IRR: 15_000,
    USD_IRR: 55_000,
    EUR_IRR: 60_000,
    TRY_IRR: 1_600,
    GBP_IRR: 70_000,
  };

  async getRate(from: Currency, to: Currency): Promise<FxQuote> {
    if (from === to) {
      return { from, to, rate: 1, observedAt: new Date().toISOString(), source: 'identity' };
    }
    const rate = this.rates[`${from}_${to}`];
    if (rate === undefined) throw new UpstreamError('stub-fx', `No rate for ${from}->${to}`);
    return { from, to, rate, observedAt: new Date().toISOString(), source: 'stub' };
  }
}

class StubPaymentAdapter implements PaymentPort {
  readonly name = 'stub-payment';

  async createIntent(input: {
    orderId: string;
    amount: Money;
    idempotencyKey: string;
    returnUrl: string;
  }): Promise<PaymentIntent> {
    const ref = `stub_${input.orderId.slice(0, 8)}_${input.idempotencyKey.slice(0, 8)}`;

    // A real gateway hosts its own page off-site and redirects the customer to it. This used
    // to redirect straight back to the application instead, which meant the customer returned
    // from a gateway that never existed, nothing settled, and the order stayed in
    // AWAITING_PAYMENT for ever — there was no way to pay for a non-sandbox order at all.
    // The development gateway restores the genuine redirect-and-return flow.
    const apiBase = process.env['API_PUBLIC_URL'] ?? 'http://localhost:4000';
    const gateway =
      `${apiBase}/v1/dev/gateway?ref=${encodeURIComponent(ref)}` +
      `&return=${encodeURIComponent(input.returnUrl)}` +
      `&amount=${encodeURIComponent(input.amount.format('fa'))}`;

    return {
      providerRef: ref,
      provider: 'stub',
      status: 'REDIRECTED',
      redirectUrl: gateway,
      amount: input.amount,
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
    };
  }

  async verify(providerRef: string): Promise<PaymentVerification> {
    return { settled: true, providerRef, amount: Money.of(0, 'IRR'), failureReason: undefined };
  }

  verifyWebhook(): boolean {
    return true;
  }

  async refund(input: { providerRef: string }) {
    return { ok: true, refundRef: `stub_refund_${input.providerRef}` };
  }
}

class StubCarrierAdapter implements CarrierPort {
  readonly name = 'stub-carrier';

  async createShipment(input: { orderId: string }): Promise<{ shipmentId: string }> {
    return { shipmentId: `STUB-SHP-${input.orderId.slice(0, 8)}` };
  }

  async track(shipmentId: string): Promise<readonly ShipmentLeg[]> {
    return [
      {
        legId: `${shipmentId}-L1`,
        carrier: 'stub-forwarder',
        trackingNumber: shipmentId,
        origin: 'Dubai, UAE',
        destination: 'Tehran, IR',
        events: [],
      },
    ];
  }
}

/**
 * Category-prior customs estimate.
 *
 * Confidence is reported honestly and is low, because it is a prior rather than a duty
 * calculation. The quote engine widens its risk reserve accordingly instead of pretending
 * this number is authoritative — and the customs gate replaces it with a validated engine.
 */
class CategoryPriorCustomsAdapter implements CustomsPort {
  readonly name = 'category-prior-customs';

  private readonly priors: Readonly<Record<string, number>> = {
    'electronics.audio': 0.12,
    'electronics.accessories': 0.1,
    electronics: 0.12,
    apparel: 0.2,
    cosmetics: 0.25,
    books: 0.05,
    general: 0.15,
  };

  async estimate(input: { route: string; category: string; declaredValue: Money }) {
    const exact = this.priors[input.category];
    const parent = this.priors[input.category.split('.')[0] ?? ''];
    const rate = exact ?? parent ?? this.priors['general']!;

    return {
      dutyRate: rate,
      confidence: exact !== undefined ? 0.6 : 0.4,
      basis: exact !== undefined ? 'category-prior' : 'parent-category-prior',
    };
  }
}

/**
 * Development resolution strategy.
 *
 * The real rungs of the ladder are written and tested in `@xb/commerce` — `marketplace-api`,
 * `structured-data`, `vision-llm` — but each needs something the marketplace gate has not
 * delivered: SP-API credentials, or a fetcher that Amazon will not block. Registering none of
 * them left the pipeline with an empty strategy array, which does not fail loudly: the loop
 * simply never runs, every required field stays missing, and the request comes back FAILED
 * with no explanation of why. A stub that says what it is beats that silence.
 *
 * The product is derived from the marketplace's own product id, so the same link always
 * resolves to the same product. That matters beyond tidiness: the max-procurement guard
 * re-checks the live price through `checkOffer` immediately before purchase, and a price
 * that moved because it was random would branch every order to PRICE_CHANGED.
 *
 * Confidence is reported honestly rather than at 1.0. Weight is the field a stub is least
 * entitled to be sure about, and it is also the field that quietly destroys margin when it
 * is wrong — so it sits just above the escalation floor, exactly where a real API's
 * catalogue weight sits.
 */
class StubStoreStrategy implements ResolutionStrategy {
  readonly name = 'stub-store';
  readonly tier = 'api' as const;
  readonly costUnits = 1;

  constructor(private readonly registry: MarketplaceRegistry) {}

  canHandle(marketplaceId: MarketplaceId): boolean {
    return this.registry.get(marketplaceId)?.enabled === true;
  }

  async resolve(ctx: ResolutionContext): Promise<StrategyResult> {
    const marketplace = this.registry.get(ctx.marketplaceId);
    if (!marketplace) {
      throw new UpstreamError(this.name, `Unknown marketplace ${ctx.marketplaceId}`);
    }

    let hash = 0;
    for (const ch of ctx.productId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;

    const priceMajor = 45 + (hash % 1_200); // AED 45–1245
    // Unsigned shift: `>>` would treat any hash above 2^31 as negative, and `%` preserves
    // that sign, which yields a negative chargeable weight.
    const weightKg = Math.round((0.15 + ((hash >>> 8) % 240) / 100) * 100) / 100; // 0.15–2.54 kg

    return {
      fields: {
        title: `Stub product ${ctx.productId}`,
        seller: marketplace.displayName.en,
        brand: undefined,
        variant: undefined,
        imageUrl: `https://placehold.co/400x400/37505C/FFFFFF/png?text=${encodeURIComponent(ctx.productId)}`,
        price: Money.fromMajor(priceMajor.toFixed(2), marketplace.currency),
        available: true,
        weightKg,
        dimensionsCm: { l: 20, w: 15, h: 8 },
        category: 'general',
      },
      confidence: {
        title: 0.9,
        seller: 0.9,
        imageUrl: 0.9,
        price: 0.9,
        available: 0.9,
        weightKg: 0.6,
        dimensionsCm: 0.6,
        category: 0.7,
      },
      notes: ['Resolved by the development stub — no marketplace was contacted'],
    };
  }
}

/**
 * Which rungs of the resolution ladder are live.
 *
 * `STORE_PROVIDERS` is the switch, and it defaults to `['stub']`. When the marketplace gate
 * clears, a real strategy is one `case` here plus its credentials — the pipeline, the quote
 * engine and both frontends never learn which rung answered.
 */
function buildStoreStrategies(env: Env): ResolutionStrategy[] {
  const strategies: ResolutionStrategy[] = [];

  for (const provider of env.STORE_PROVIDERS) {
    switch (provider) {
      case 'stub':
        // A fabricated product is a development affordance and nothing else. In production it
        // would put an invented price in front of a customer and an invented weight into the
        // landed cost, so it is refused there rather than merely discouraged.
        if (env.NODE_ENV === 'production') {
          logger.error(
            { provider },
            'refusing to register the store stub in production — set STORE_PROVIDERS to a real strategy',
          );
          break;
        }
        strategies.push(new StubStoreStrategy(marketplaceRegistry));
        break;

      // case 'marketplace-api':   new ApiResolutionStrategy(spApiClient, ['amazon.ae'])
      // case 'structured-data':   new StructuredDataStrategy(pageFetcher, [...])
      // case 'vision-llm':        new VisionResolutionStrategy(visionExtractor, pageFetcher)
      //   — all three exist in @xb/commerce and are tested; each is blocked on credentials
      //     or a fetcher the marketplace will not block, not on code.

      default:
        logger.warn({ provider }, 'unknown store provider in STORE_PROVIDERS; ignoring it');
    }
  }

  if (strategies.length === 0) {
    logger.error(
      { configured: env.STORE_PROVIDERS },
      'no resolution strategy is registered — every product request will fail with RESOLUTION_FAILED',
    );
  }

  return strategies;
}

class StubSmsAdapter implements SmsPort {
  readonly name = 'stub-sms';

  async send(input: { to: string; message: string }) {
    // The message is logged rather than sent, so the flow is exercisable without an SMS
    // vendor. The OTP inside it is real and random — `AuthService` logs it separately under
    // `devOtp` in development, which is what the test scripts read.
    logger.info({ to: input.to, message: input.message }, 'SMS (stub — not actually sent)');
    return { ok: true, providerRef: `stub-sms-${Date.now()}` };
  }
}

/** The pinned code. Six digits because the OTP column and the client input expect six. */
const FAKE_OTP_CODE = '123456';

/**
 * Fake SMS provider with a constant verification code.
 *
 * Same delivery behaviour as the stub — nothing is sent — but it also pins the OTP, so
 * signing in during a demo or a browser test is typing `123456` rather than tailing a log
 * file. The code still travels the entire real path: `AuthService` hashes it, stores it with
 * a TTL, counts attempts against it and compares it in constant time. Only its *source*
 * changes, from a CSPRNG to a constant.
 *
 * That is also precisely why this must never reach production, where a constant OTP means
 * anyone can sign in as any phone number. It is refused at registration below, and refused
 * again where it is consumed in `AuthService.startOtp`.
 */
class FakeSmsAdapter implements SmsPort {
  readonly name = 'fake-sms';

  fixedOtpCode(): string {
    return FAKE_OTP_CODE;
  }

  async send(input: { to: string; message: string }) {
    logger.warn(
      { to: input.to, message: input.message, fixedOtpCode: FAKE_OTP_CODE },
      'SMS (fake — not sent, and the OTP is pinned to a constant)',
    );
    return { ok: true, providerRef: `fake-sms-${Date.now()}` };
  }
}

/**
 * Which SMS providers are live.
 *
 * `SMS_PROVIDERS` is the switch. Both development providers are refused in production, and
 * a real vendor (Kavenegar, SMS.ir) becomes one `case` plus its credentials.
 */
export function buildSmsProviders(env: Env): { name: string; adapter: SmsPort; priority: number }[] {
  const providers: { name: string; adapter: SmsPort; priority: number }[] = [];
  const isProduction = env.NODE_ENV === 'production';

  for (const provider of env.SMS_PROVIDERS) {
    switch (provider) {
      case 'fake':
        if (isProduction) {
          logger.error(
            { provider },
            'refusing to register the fake SMS provider in production — its OTP is a constant, ' +
              'which would let anyone sign in as any phone number',
          );
          break;
        }
        providers.push({ name: 'fake-sms', adapter: new FakeSmsAdapter(), priority: 10 });
        break;

      case 'stub':
        if (isProduction) {
          logger.error({ provider }, 'refusing to register the SMS stub in production');
          break;
        }
        providers.push({ name: 'stub-sms', adapter: new StubSmsAdapter(), priority: 20 });
        break;

      // case 'kavenegar': new KavenegarSmsAdapter(env.KAVENEGAR_API_KEY)
      // case 'smsir':     new SmsIrAdapter(env.SMSIR_API_KEY)

      default:
        logger.warn({ provider }, 'unknown SMS provider in SMS_PROVIDERS; ignoring it');
    }
  }

  if (providers.length === 0) {
    logger.error(
      { configured: env.SMS_PROVIDERS },
      'no SMS provider is registered — OTP delivery will fail and no one can sign in',
    );
  }

  return providers;
}

// ─────────────────────────── the proxy chain ───────────────────────────

/**
 * Standard resilience stack for a port.
 *
 * `cacheLayer` is passed separately because only read-heavy ports get one — a payment
 * `charge` must never be answered from cache, and defaulting to "cache everything" makes
 * that mistake easy.
 */
function resilient<T extends object>(
  target: T,
  port: string,
  options: {
    timeoutMs?: number;
    attempts?: number;
    nonRetryableMethods?: readonly string[];
    cacheLayer?: Layer;
  } = {},
): T {
  const layers: Layer[] = [instrument({ slowCallMs: 2_000 })];

  if (options.cacheLayer) layers.push(options.cacheLayer);

  layers.push(
    circuitBreaker({ threshold: 5, resetMs: 30_000, minimumThroughput: 5 }, breakerRegistry),
    retry({
      attempts: options.attempts ?? 3,
      baseDelayMs: 100,
      ...(options.nonRetryableMethods ? { nonRetryableMethods: options.nonRetryableMethods } : {}),
    }),
    timeout({ ms: options.timeoutMs ?? 5_000 }),
  );

  return withLayers(target, layers, { port, passthrough: ['supports', 'verifyWebhook', 'mode'] });
}

// ─────────────────────────── build ───────────────────────────

export interface BuildAdaptersOptions {
  readonly env: Env;
  readonly redis: Redis;
}

export function buildAdapters(options: BuildAdaptersOptions): AdapterSet {
  const { env, redis } = options;
  const cacheStore = new RedisCacheStore(redis);

  // ── FX: multi-provider, cached, with a hard staleness ceiling ──
  const fxRegistry = new ProviderRegistry<FxPort>('FxPort', [
    { name: 'stub-fx', adapter: new StubFxAdapter(), priority: 10 },
  ]);

  const fx = resilient(
    failover(fxRegistry, { port: 'FxPort', strategy: 'priority' }),
    'FxPort',
    {
      timeoutMs: 2_000,
      cacheLayer: cacheAside({
        store: cacheStore,
        methods: {
          getRate: {
            ttlMs: 180_000,
            jitter: 0.15,
            // No stale-while-revalidate: a rate past its ceiling must fail the quote rather
            // than price on a guess. Serving a stale rate that moved the wrong way turns a
            // margin into a loss on every order until someone notices.
            staleWhileRevalidateMs: 0,
            key: (args) => CacheKeys.fx(String(args[0]), String(args[1])),
          },
        },
      }),
    },
  );

  // ── Store: the resolution pipeline behind a rate limiter ──
  const rateLimiter = new DistributedRateLimiter(redis, bucketConfigsFrom(MARKETPLACES));

  const pipeline = new ResolutionPipeline({
    registry: marketplaceRegistry,
    rateLimiter,
    strategies: buildStoreStrategies(env),
  });

  const store = resilient(pipeline as unknown as StorePort, 'StorePort', {
    timeoutMs: 15_000, // the vision tier is genuinely slow
    attempts: 2,
    cacheLayer: cacheAside({
      store: cacheStore,
      methods: {
        resolve: {
          ttlMs: 600_000,
          jitter: 0.2,
          negativeTtlMs: 30_000,
          key: (args) => CacheKeys.resolve(hashUrl(String(args[0]))),
          isNegative: (v) => (v as { status?: string })?.status === 'FAILED',
        },
        // checkOffer is deliberately absent: procurement re-checks the *live* price, and a
        // cached answer there would defeat the guard it exists to feed.
      },
    }),
  });

  // ── Payment: sticky per order, never retried, never cached ──
  const paymentRegistry = new ProviderRegistry<PaymentPort>('PaymentPort', [
    { name: 'stub', adapter: new StubPaymentAdapter(), priority: 10 },
  ]);

  const payment = resilient(
    failover(paymentRegistry, {
      port: 'PaymentPort',
      strategy: 'sticky',
      // Pin on the order id: every retry for one order goes back to the same gateway.
      stickyKey: (method, args) => {
        if (method !== 'createIntent') return undefined;
        const input = args[0] as { orderId?: string } | undefined;
        return input?.orderId ? `pay:order:${input.orderId}` : undefined;
      },
      noFailoverMethods: ['createIntent', 'refund'],
    }),
    'PaymentPort',
    {
      timeoutMs: 10_000,
      attempts: 1,
      // Retrying a charge is how a customer gets billed twice.
      nonRetryableMethods: ['createIntent', 'refund'],
    },
  );

  // ── Procurement: assisted mode; the purchase step is never auto-retried ──
  const procurement = resilient(
    new ProcurementEngine({ mode: 'assisted', store, registry: marketplaceRegistry }),
    'ProcurementPort',
    { timeoutMs: 20_000, attempts: 1, nonRetryableMethods: ['purchase'] },
  );

  const carrier = resilient(new StubCarrierAdapter(), 'CarrierPort', { timeoutMs: 8_000 });

  const customs = resilient(new CategoryPriorCustomsAdapter(), 'CustomsPort', {
    timeoutMs: 3_000,
    cacheLayer: cacheAside({
      store: cacheStore,
      methods: {
        estimate: {
          ttlMs: 86_400_000,
          jitter: 0.1,
          key: (args) => {
            const i = args[0] as { route: string; category: string };
            return CacheKeys.customs(i.route, i.category);
          },
        },
      },
    }),
  });

  const smsRegistry = new ProviderRegistry<SmsPort>('SmsPort', buildSmsProviders(env));

  const sms = resilient(
    failover(smsRegistry, { port: 'SmsPort', strategy: 'round-robin' }),
    'SmsPort',
    { timeoutMs: 5_000 },
  );

  const storage = new MinioStorageAdapter({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    accessKey: env.S3_ACCESS_KEY,
    secretKey: env.S3_SECRET_KEY,
    buckets: { packages: env.S3_BUCKET_PACKAGES, documents: env.S3_BUCKET_DOCUMENTS },
  });

  logger.info(
    {
      fx: fxRegistry.all().map((p) => p.name),
      payment: paymentRegistry.all().map((p) => p.name),
      sms: smsRegistry.all().map((p) => p.name),
      procurementMode: 'assisted',
    },
    'adapters wired',
  );

  return { store, fx, payment, procurement, carrier, customs, sms, storage };
}

/**
 * Sandbox adapter set for one session.
 *
 * Built per request rather than once at boot, because each sandbox session has its own
 * scenario, seed and virtual clock. The sandbox adapters implement the same ports, so the
 * services consuming them cannot tell the difference — which is what makes a sandbox run
 * evidence about the real code path rather than about a parallel one.
 */
export function buildSandboxAdapters(
  ctx: () => SandboxContext,
  base: AdapterSet,
): AdapterSet {
  const sandbox = createSandboxAdapters(ctx);
  return {
    ...base,
    store: sandbox.store,
    fx: sandbox.fx,
    payment: sandbox.payment,
    procurement: sandbox.procurement,
    carrier: sandbox.carrier,
  };
}

export function createRedis(env: Env): Redis {
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: false });
  redis.on('error', (err) => logger.error({ err }, 'redis error'));
  return redis;
}

export { marketplaceRegistry, MarketplaceRegistry };
