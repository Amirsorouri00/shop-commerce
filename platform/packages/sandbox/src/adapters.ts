import {
  Money,
  DomainErrors,
  UpstreamError,
  type CarrierPort,
  type Currency,
  type FxPort,
  type FxQuote,
  type PaymentIntent,
  type PaymentPort,
  type PaymentVerification,
  type ShipmentLeg,
  type TrackingEvent,
} from '@xb/core';
import type {
  MarketplaceId,
  ProcurementPort,
  ProcurementRequest,
  ProcurementResult,
  ResolutionOutcome,
  ResolvedProduct,
  StorePort,
} from '@xb/commerce';
import { marketplaceRegistry } from '@xb/commerce';
import { bump, logSandbox, type SandboxContext } from './session.ts';

/**
 * Sandbox adapters.
 *
 * These implement exactly the same ports as the production adapters, so nothing in the
 * domain, the API or the frontends can tell the difference. That is the point: a demo that
 * runs through a parallel code path proves nothing about the real one.
 *
 * Behaviour is a pure function of (scenario, virtual clock, seed). No wall-clock sleeps, no
 * unseeded randomness — so a sandbox run is reproducible and can be asserted on in a test.
 */

const SANDBOX_CATALOG: Readonly<Record<string, Omit<ResolvedProduct, 'provenance' | 'observedAt' | 'route' | 'canonicalUrl'>>> = {
  B0CHWRXH8B: {
    marketplace: 'amazon.ae',
    externalProductId: 'B0CHWRXH8B',
    title: 'Apple AirPods Pro (2nd generation) with MagSafe Case (USB-C)',
    seller: 'Amazon AE',
    brand: 'Apple',
    variant: 'White',
    imageUrl: 'https://placehold.co/400x400/1B3A6B/FFFFFF/png?text=AirPods+Pro',
    price: Money.fromMajor('899.00', 'AED'),
    available: true,
    weightKg: 0.35,
    dimensionsCm: { l: 15, w: 12, h: 6 },
    category: 'electronics.audio',
  },
  B09G9FPHY6: {
    marketplace: 'amazon.ae',
    externalProductId: 'B09G9FPHY6',
    title: 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones',
    seller: 'Sony Official Store',
    brand: 'Sony',
    variant: 'Black',
    imageUrl: 'https://placehold.co/400x400/0E8A80/FFFFFF/png?text=WH-1000XM5',
    price: Money.fromMajor('1399.00', 'AED'),
    available: true,
    weightKg: 0.85,
    dimensionsCm: { l: 27, w: 21, h: 9 },
    category: 'electronics.audio',
  },
  B0C7KM5BLL: {
    marketplace: 'amazon.ae',
    externalProductId: 'B0C7KM5BLL',
    title: 'Logitech MX Master 3S Wireless Mouse',
    seller: 'Logitech MEA',
    brand: 'Logitech',
    variant: 'Graphite',
    imageUrl: 'https://placehold.co/400x400/B67618/FFFFFF/png?text=MX+Master+3S',
    price: Money.fromMajor('389.00', 'AED'),
    available: true,
    weightKg: 0.24,
    dimensionsCm: { l: 13, w: 9, h: 5 },
    category: 'electronics.accessories',
  },
};

const DEFAULT_ASIN = 'B0CHWRXH8B';

/**
 * Build a stand-in product for an ASIN the sandbox catalogue does not know.
 *
 * The alternative — quietly returning the AirPods for every unknown link — is actively
 * misleading: you paste a link for one thing and the demo shows you another, with no
 * indication that a substitution happened. Naming the ASIN in the title makes the simulation
 * legible instead of confusing.
 *
 * Price and weight are derived from the ASIN so the same link always produces the same
 * product, which keeps sessions reproducible.
 */
function syntheticProduct(
  productId: string,
): Omit<ResolvedProduct, 'provenance' | 'observedAt' | 'route' | 'canonicalUrl'> {
  let hash = 0;
  for (const ch of productId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;

  const priceMajor = 45 + (hash % 1_200); // AED 45–1245
  // `>>>` and not `>>`: the hash is an unsigned 32-bit value, and a signed shift turns every
  // hash above 2^31 negative. JavaScript's `%` keeps that sign, so the arithmetic below
  // produced weights as low as -2.24 kg for roughly half of all ASINs. The quote engine's
  // `Math.max(…, 0.1)` floor stopped it reaching the freight cost, but the product record
  // still carried a negative chargeable weight.
  const weightKg = Math.round((0.15 + ((hash >>> 8) % 240) / 100) * 100) / 100; // 0.15–2.54 kg

  return {
    marketplace: 'amazon.ae',
    externalProductId: productId,
    title: `Sandbox product ${productId}`,
    seller: 'Amazon AE',
    brand: undefined,
    variant: undefined,
    imageUrl: `https://placehold.co/400x400/37505C/FFFFFF/png?text=${encodeURIComponent(productId)}`,
    price: Money.fromMajor(priceMajor.toFixed(2), 'AED'),
    available: true,
    weightKg,
    dimensionsCm: { l: 20, w: 15, h: 8 },
    category: 'general',
  };
}

function catalogEntry(productId: string) {
  return SANDBOX_CATALOG[productId] ?? syntheticProduct(productId);
}

// ─────────────────────────── store ───────────────────────────

export class SandboxStoreAdapter implements StorePort {
  readonly name = 'sandbox-store';

  constructor(private readonly ctx: () => SandboxContext) {}

  supports(url: string): boolean {
    return marketplaceRegistry.parse(url) !== undefined;
  }

  async resolve(url: string, _correlationId: string): Promise<ResolutionOutcome> {
    const ctx = this.ctx();
    const { scenario } = ctx;

    const parsed = marketplaceRegistry.parse(url);
    if (!parsed) {
      return {
        status: 'FAILED',
        product: undefined,
        missingFields: ['title', 'price'],
        strategiesTried: [],
        totalCostUnits: 0,
        notes: ['URL did not match an enabled marketplace'],
      };
    }

    // Virtual delay — recorded, not slept. A demo should not actually wait 3.5 seconds.
    logSandbox(ctx, 'resolution', {
      en: `Resolved via ${scenario.resolveTier} tier in ${scenario.resolveDelayMs}ms (simulated)`,
      fa: `شناسایی از طریق لایهٔ ${scenario.resolveTier} در ${scenario.resolveDelayMs} میلی‌ثانیه (شبیه‌سازی‌شده)`,
    });

    const base = catalogEntry(parsed.productId);
    const tier = scenario.resolveTier;

    // Confidence reflects the tier that answered — this is what drives the review queue
    // and the quote engine's risk reserve.
    const weightConfidence =
      tier === 'api' ? 0.6 : tier === 'structured' ? 0.55 : tier === 'vision' ? 0.45 : 1;
    const needsReview = scenario.resolveOutcome === 'NEEDS_REVIEW';

    const product: ResolvedProduct = {
      ...base,
      available: scenario.productAvailable,
      canonicalUrl: parsed.marketplace.canonicalUrl(parsed.productId),
      route: parsed.marketplace.route,
      provenance: {
        title: { tier, strategy: `sandbox-${tier}`, confidence: 0.98 },
        price: { tier, strategy: `sandbox-${tier}`, confidence: tier === 'api' ? 0.99 : 0.8 },
        available: { tier, strategy: `sandbox-${tier}`, confidence: 0.9 },
        weightKg: {
          tier,
          strategy: `sandbox-${tier}`,
          confidence: needsReview ? 0.3 : weightConfidence,
        },
        category: { tier, strategy: `sandbox-${tier}`, confidence: 0.85 },
      },
      observedAt: ctx.clock.nowIso(),
    };

    if (scenario.resolveOutcome === 'FAILED') {
      return {
        status: 'FAILED',
        product: undefined,
        missingFields: ['price', 'weightKg'],
        strategiesTried: ['sandbox-api', 'sandbox-vision'],
        totalCostUnits: 21,
        notes: ['Simulated total resolution failure'],
      };
    }

    return {
      status: needsReview ? 'NEEDS_REVIEW' : 'RESOLVED',
      product,
      missingFields: needsReview ? ['weightKg'] : [],
      strategiesTried:
        tier === 'vision' ? ['sandbox-api', 'sandbox-vision'] : [`sandbox-${tier}`],
      totalCostUnits: tier === 'vision' ? 21 : 1,
      notes: needsReview
        ? ['Shipping weight below the confidence floor; operator review required']
        : [],
    };
  }

  async checkOffer(
    _marketplaceId: MarketplaceId,
    productId: string,
  ): Promise<{ price: Money; available: boolean }> {
    const ctx = this.ctx();
    const base = catalogEntry(productId);

    /*
     * The price move lands *between* checkout and purchase, not before both.
     *
     * `checkOffer` is called twice in a real order: once when checkout revalidates, and again
     * when procurement re-checks immediately before buying. Applying the scenario's multiplier
     * to both means the breach is always caught at checkout, and the procurement guard — the
     * thing the scenario exists to demonstrate — never fires.
     *
     * Holding the original price for the first check reproduces the case that actually costs
     * money: the customer paid at one price and the seller moved it afterwards.
     */
    const checks = bump(ctx, 'offerChecks');
    const multiplier = checks === 1 ? 1 : ctx.scenario.procurementPriceMultiplier;

    const price = base.price.multiply(multiplier);
    const available = checks === 1 ? true : ctx.scenario.availableAtProcurement;

    logSandbox(ctx, 'offer-check', {
      en: `Live offer re-checked: ${price.format('en')}, ${available ? 'in stock' : 'out of stock'}`,
      fa: `بررسی مجدد قیمت لحظه‌ای: ${price.format('fa')}، ${available ? 'موجود' : 'ناموجود'}`,
    });

    return { price, available };
  }
}

// ─────────────────────────── FX ───────────────────────────

export class SandboxFxAdapter implements FxPort {
  readonly name = 'sandbox-fx';

  /** Fixed illustrative mid-rates. Real rates come from the FX provider chain. */
  private readonly rates: Readonly<Record<string, number>> = {
    AED_IRR: 15_000,
    USD_IRR: 55_000,
    EUR_IRR: 60_000,
    TRY_IRR: 1_600,
    GBP_IRR: 70_000,
  };

  constructor(private readonly ctx: () => SandboxContext) {}

  async getRate(from: Currency, to: Currency): Promise<FxQuote> {
    const ctx = this.ctx();

    // Identity conversion is arithmetic, not a lookup, so it must not depend on a provider
    // being reachable. An IRR-denominated total should still render during an FX outage.
    if (from === to) {
      return { from, to, rate: 1, observedAt: ctx.clock.nowIso(), source: 'identity' };
    }

    if (!ctx.scenario.fxAvailable) {
      logSandbox(ctx, 'fx', {
        en: 'All FX providers unavailable — refusing to quote rather than guessing a rate',
        fa: 'تمام منابع نرخ ارز در دسترس نیستند — به‌جای حدس زدن نرخ، قیمت‌گذاری انجام نمی‌شود',
      });
      throw new UpstreamError('sandbox-fx', 'All FX providers unavailable (simulated)');
    }

    const base = this.rates[`${from}_${to}`];
    if (base === undefined) {
      throw new UpstreamError('sandbox-fx', `No rate for ${from}->${to}`);
    }

    // A small seeded wobble so the demo shows FX moving between refreshes, deterministically.
    const drift = (ctx.random() - 0.5) * 0.004;
    return {
      from,
      to,
      rate: Math.round(base * (1 + drift)),
      observedAt: ctx.clock.nowIso(),
      source: 'sandbox',
    };
  }
}

// ─────────────────────────── payment ───────────────────────────

export class SandboxPaymentAdapter implements PaymentPort {
  readonly name = 'sandbox-payment';

  constructor(private readonly ctx: () => SandboxContext) {}

  async createIntent(input: {
    orderId: string;
    amount: Money;
    idempotencyKey: string;
    returnUrl: string;
  }): Promise<PaymentIntent> {
    const ctx = this.ctx();
    const attempt = bump(ctx, 'paymentAttempts');
    const ref = `sbx_pay_${ctx.session.id.slice(4, 12)}_${attempt}`;

    logSandbox(
      ctx,
      'payment',
      {
        en: `Payment intent ${attempt} created for ${input.amount.format('en')}`,
        fa: `تلاش پرداخت شمارهٔ ${attempt} برای مبلغ ${input.amount.format('fa')} ایجاد شد`,
      },
      { idempotencyKey: input.idempotencyKey },
    );

    // A real gateway hosts its own page and redirects the customer off-site. The sandbox
    // gateway does the same, so the demo exercises the genuine redirect-and-return flow
    // rather than quietly settling in-process.
    const apiBase = process.env['API_PUBLIC_URL'] ?? 'http://localhost:4000';
    const gateway =
      `${apiBase}/v1/sandbox/gateway?ref=${encodeURIComponent(ref)}` +
      `&return=${encodeURIComponent(input.returnUrl)}`;

    return {
      providerRef: ref,
      provider: 'sandbox',
      status: 'REDIRECTED',
      redirectUrl: gateway,
      amount: input.amount,
      expiresAt: new Date(ctx.clock.now() + 15 * 60_000).toISOString(),
    };
  }

  async verify(providerRef: string): Promise<PaymentVerification> {
    const ctx = this.ctx();
    const { payment } = ctx.scenario;
    const amount = Money.of(0, 'IRR'); // the caller reconciles against its own order amount

    if (payment === 'decline') {
      logSandbox(ctx, 'payment', {
        en: 'Gateway declined the charge',
        fa: 'درگاه پرداخت تراکنش را رد کرد',
      });
      return {
        settled: false,
        providerRef,
        amount,
        failureReason: 'INSUFFICIENT_FUNDS',
      };
    }

    if (payment === 'timeout-permanent') {
      throw new UpstreamError('sandbox-payment', 'Gateway did not respond (simulated)');
    }

    if (payment === 'timeout-then-settle') {
      const checks = bump(ctx, 'paymentVerifications');
      if (checks === 1) {
        // First verification times out; the webhook settles it later. This is the exact
        // sequence that makes idempotency and reconciliation load-bearing.
        logSandbox(ctx, 'payment', {
          en: 'Gateway timed out; settlement will arrive by webhook',
          fa: 'درگاه پاسخ نداد؛ تسویه از طریق وب‌هوک دریافت خواهد شد',
        });
        throw new UpstreamError('sandbox-payment', 'Gateway timeout (simulated)');
      }
    }

    logSandbox(ctx, 'payment', {
      en: 'Payment settled',
      fa: 'پرداخت با موفقیت تسویه شد',
    });

    return { settled: true, providerRef, amount, failureReason: undefined };
  }

  verifyWebhook(_rawBody: string, signature: string): boolean {
    // The sandbox still requires a signature so client code exercises the real path.
    return signature === 'sandbox-signature';
  }

  async refund(input: {
    providerRef: string;
    amount: Money;
    idempotencyKey: string;
  }): Promise<{ ok: boolean; refundRef: string | undefined }> {
    const ctx = this.ctx();
    logSandbox(ctx, 'refund', {
      en: `Refunded ${input.amount.format('en')}`,
      fa: `مبلغ ${input.amount.format('fa')} بازپرداخت شد`,
    });
    return { ok: true, refundRef: `sbx_ref_${input.providerRef}` };
  }
}

// ─────────────────────────── procurement ───────────────────────────

export class SandboxProcurementAdapter implements ProcurementPort {
  readonly mode = 'assisted' as const;
  readonly name = 'sandbox-procurement';

  constructor(private readonly ctx: () => SandboxContext) {}

  async purchase(req: ProcurementRequest): Promise<ProcurementResult> {
    const ctx = this.ctx();
    const base = catalogEntry(req.externalProductId);
    const livePrice = base.price.multiply(ctx.scenario.procurementPriceMultiplier);
    const lineTotal = livePrice.multiply(req.quantity);

    if (!ctx.scenario.availableAtProcurement) {
      logSandbox(ctx, 'procurement', {
        en: 'Item sold out before purchase — order routed to refund',
        fa: 'کالا پیش از خرید ناموجود شد — سفارش به مسیر بازپرداخت هدایت شد',
      });
      return {
        ok: false,
        externalOrderId: undefined,
        actualPrice: lineTotal,
        reason: 'OUT_OF_STOCK',
        mode: this.mode,
        operatorTask: undefined,
      };
    }

    if (lineTotal.greaterThan(req.maxPrice)) {
      logSandbox(
        ctx,
        'procurement',
        {
          en: `Guard breached: ${lineTotal.format('en')} exceeds authorised ${req.maxPrice.format('en')}`,
          fa: `عبور از سقف مجاز: ${lineTotal.format('fa')} بیشتر از مبلغ تأییدشدهٔ ${req.maxPrice.format('fa')} است`,
        },
        { actual: lineTotal.amount, max: req.maxPrice.amount },
      );
      return {
        ok: false,
        externalOrderId: undefined,
        actualPrice: lineTotal,
        reason: 'PRICE_CHANGED',
        mode: this.mode,
        operatorTask: undefined,
      };
    }

    // Within the guard: assisted mode hands a task to an operator.
    logSandbox(ctx, 'procurement', {
      en: `Within authorised ceiling — operator task created for ${lineTotal.format('en')}`,
      fa: `درون سقف مجاز — وظیفهٔ اپراتور برای مبلغ ${lineTotal.format('fa')} ایجاد شد`,
    });

    return {
      ok: false,
      externalOrderId: undefined,
      actualPrice: lineTotal,
      reason: 'REQUIRES_OPERATOR',
      mode: this.mode,
      operatorTask: {
        procurementOrderId: req.procurementOrderId,
        checkoutUrl: `https://www.amazon.ae/dp/${req.externalProductId}`,
        expectedPrice: lineTotal,
        maxAuthorised: req.maxPrice,
        instructions: {
          en: `Purchase ${req.quantity} x this item. Do not exceed the authorised maximum.`,
          fa: `تعداد ${req.quantity} عدد از این کالا را خریداری کنید. از حداکثر مبلغ مجاز فراتر نروید.`,
        },
      },
    };
  }

  async checkOrderStatus(): Promise<{ status: string; shippedAt?: string; trackingNumber?: string }> {
    const ctx = this.ctx();
    const hours = ctx.clock.hoursSincePurchase();
    return {
      status: hours === undefined ? 'UNKNOWN' : hours > 6 ? 'SHIPPED' : 'PROCESSING',
      trackingNumber: `SBX${ctx.session.id.slice(4, 12).toUpperCase()}`,
    };
  }
}

// ─────────────────────────── carrier ───────────────────────────

export class SandboxCarrierAdapter implements CarrierPort {
  readonly name = 'sandbox-carrier';

  constructor(private readonly ctx: () => SandboxContext) {}

  async createShipment(input: { orderId: string }): Promise<{ shipmentId: string }> {
    const ctx = this.ctx();
    ctx.clock.markPurchased(); // anchor the leg schedule to this moment
    logSandbox(ctx, 'shipment', {
      en: 'Shipment created; tracking legs scheduled against the virtual clock',
      fa: 'مرسوله ایجاد شد؛ مراحل رهگیری بر اساس ساعت مجازی زمان‌بندی شدند',
    });
    return { shipmentId: `SBX-SHP-${input.orderId.slice(0, 8)}` };
  }

  /**
   * Report the legs that are now in the past according to the virtual clock.
   *
   * This is what makes a five-day delivery demonstrable in a meeting: advancing the clock by
   * 24 virtual hours reveals the next legs, exactly as polling would over a real day.
   */
  async track(shipmentId: string): Promise<readonly ShipmentLeg[]> {
    const ctx = this.ctx();
    const hours = ctx.clock.hoursSincePurchase();

    if (hours === undefined) return [];

    const { shipmentLegs, stallAfterLegIndex } = ctx.scenario;
    const events: TrackingEvent[] = [];

    for (const [index, leg] of shipmentLegs.entries()) {
      if (leg.atHoursAfterPurchase > hours) break;

      // A stalled scenario stops emitting after this leg, so the stall detector fires.
      if (stallAfterLegIndex !== undefined && index > stallAfterLegIndex) break;

      events.push({
        status: leg.raisesException ?? leg.status,
        at: new Date(
          ctx.session.purchasedAtVirtual! + leg.atHoursAfterPurchase * 3_600_000,
        ).toISOString(),
        location: leg.location,
        rawStatus: `SBX_${leg.status}`,
      });
    }

    return [
      {
        legId: `${shipmentId}-L1`,
        carrier: 'sandbox-forwarder',
        trackingNumber: shipmentId,
        origin: 'Dubai, UAE',
        destination: 'Tehran, IR',
        events,
      },
    ];
  }
}

/** Everything the composition root needs to run a session against sandbox adapters. */
export interface SandboxAdapterSet {
  readonly store: StorePort;
  readonly fx: FxPort;
  readonly payment: PaymentPort;
  readonly procurement: ProcurementPort;
  readonly carrier: CarrierPort;
}

export function createSandboxAdapters(ctx: () => SandboxContext): SandboxAdapterSet {
  return {
    store: new SandboxStoreAdapter(ctx),
    fx: new SandboxFxAdapter(ctx),
    payment: new SandboxPaymentAdapter(ctx),
    procurement: new SandboxProcurementAdapter(ctx),
    carrier: new SandboxCarrierAdapter(ctx),
  };
}

export { SANDBOX_CATALOG };
