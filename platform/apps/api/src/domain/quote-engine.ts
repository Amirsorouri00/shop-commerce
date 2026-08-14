import { Money, DomainErrors, type Currency, type CustomsPort, type FxPort } from '@xb/core';
import type { ResolvedProduct } from '@xb/commerce';
import { resolutionRiskFactor } from '@xb/commerce';

/**
 * The quote engine.
 *
 * Deterministic, and deliberately so: no model output participates in any monetary value.
 * The same inputs always produce the same quote, which is what makes a disputed price
 * reproducible months later from the stored snapshot and FX rate.
 *
 * Two gates are applied here rather than downstream:
 *
 *   - The **viability gate** rejects orders whose logistics overhead exceeds the threshold.
 *     These cannot be served profitably and should never reach checkout, because refunding
 *     someone after they have paid is far worse than declining before they do.
 *
 *   - The **max-procurement price** is computed and frozen into the quote. It is the ceiling
 *     procurement will later check the live offer against.
 */

export interface RateCard {
  readonly freightUsdPerKg: Readonly<Record<string, number>>;
  readonly handlingUsd: number;
  readonly lastMileUsd: number;
  readonly insurancePct: number;
  readonly marginPct: number;
  /** How far the marketplace price may move before procurement refuses to buy. */
  readonly procurementTolerancePct: number;
  /** Logistics overhead ceiling, as a fraction of product value. */
  readonly viabilityThreshold: number;
  readonly quoteTtlSeconds: number;
  /** Below this the order is not worth handling at all. */
  readonly minimumOrderValueUsd: number;
  /** Oldest FX snapshot we will price against. */
  readonly maxFxAgeSeconds: number;
}

/** Mirrors Logistics-Economics-v0.3.xlsx. Editing here without editing there is a drift bug. */
export const DEFAULT_RATE_CARD: RateCard = {
  freightUsdPerKg: { UAE: 6, Turkey: 7, Germany: 12, UK: 13, Japan: 16 },
  handlingUsd: 8,
  lastMileUsd: 3,
  insurancePct: 0.02,
  marginPct: 0.12,
  procurementTolerancePct: 0.02,
  viabilityThreshold: 0.25,
  quoteTtlSeconds: 300,
  minimumOrderValueUsd: 20,
  maxFxAgeSeconds: 900,
};

export interface QuoteBreakdown {
  readonly product: Money;
  readonly freight: Money;
  readonly handling: Money;
  readonly lastMile: Money;
  readonly customs: Money;
  readonly insurance: Money;
  readonly serviceFee: Money;
}

export interface ComputedQuote {
  readonly productSnapshot: ResolvedProduct;
  readonly quantity: number;
  readonly fxRate: number;
  readonly breakdown: QuoteBreakdown;
  readonly finalPrice: Money;
  readonly maxProcurementPrice: Money;
  readonly overheadRatio: number;
  readonly riskFactor: number;
  readonly viable: boolean;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export class QuoteEngine {
  constructor(
    private readonly fx: FxPort,
    private readonly customs: CustomsPort,
    private readonly rateCard: RateCard = DEFAULT_RATE_CARD,
  ) {}

  async createQuote(product: ResolvedProduct, quantity = 1): Promise<ComputedQuote> {
    if (!product.available) throw DomainErrors.outOfStock();

    const rc = this.rateCard;
    const sourceCurrency = product.price.currency;

    const [sourceToIrr, usdToIrr] = await Promise.all([
      this.fx.getRate(sourceCurrency, 'IRR'),
      this.fx.getRate('USD', 'IRR'),
    ]);

    this.assertFresh(sourceToIrr.observedAt);
    this.assertFresh(usdToIrr.observedAt);

    // ── product cost in IRR ──
    const productSource = product.price.multiply(quantity);
    const productIrr = productSource.convert(sourceToIrr.rate, 'IRR');

    // ── minimum order value, checked in USD so it is corridor-independent ──
    const productUsd = productIrr.amount / usdToIrr.rate;
    if (productUsd < rc.minimumOrderValueUsd) throw DomainErrors.belowMinimumOrderValue();

    // ── logistics, priced in USD then converted once ──
    const freightPerKg = rc.freightUsdPerKg[product.route] ?? 15;
    // Chargeable weight: the greater of actual and dimensional weight. Carriers bill the
    // larger of the two, so quoting on actual weight alone under-prices bulky light items.
    const chargeableKg = Math.max(
      product.weightKg * quantity,
      dimensionalWeightKg(product.dimensionsCm) * quantity,
      0.1,
    );

    const freightUsd = freightPerKg * chargeableKg;
    const freight = usdToIrr8(freightUsd, usdToIrr.rate);
    const handling = usdToIrr8(rc.handlingUsd, usdToIrr.rate);
    const lastMile = usdToIrr8(rc.lastMileUsd, usdToIrr.rate);
    const insurance = productIrr.multiply(rc.insurancePct);

    // ── customs ──
    const duty = await this.customs.estimate({
      route: product.route,
      category: product.category,
      declaredValue: productIrr,
    });
    const customsCost = productIrr.multiply(duty.dutyRate);

    // ── viability ──
    const logisticsIrr = freight.add(handling).add(lastMile).add(insurance);
    const overheadRatio = logisticsIrr.amount / productIrr.amount;
    const viable = overheadRatio <= rc.viabilityThreshold;

    // ── risk reserve ──
    // Soft resolution data and a soft duty estimate both widen the fee. This is not padding:
    // an estimated weight that is wrong costs real money on every order of that product, and
    // the reserve is what stops that becoming a loss.
    const resolutionRisk = resolutionRiskFactor(product);
    const customsRisk = 1 - duty.confidence;
    const riskFactor = Math.min(0.5, resolutionRisk * 0.6 + customsRisk * 0.4);

    const preFee = productIrr.add(logisticsIrr).add(customsCost);
    const serviceFee = preFee.multiply(rc.marginPct + riskFactor * 0.1);
    const finalPrice = preFee.add(serviceFee);

    const now = Date.now();

    return {
      productSnapshot: product,
      quantity,
      fxRate: sourceToIrr.rate,
      breakdown: {
        product: productIrr,
        freight,
        handling,
        lastMile,
        customs: customsCost,
        insurance,
        serviceFee,
      },
      finalPrice,
      // Frozen in the source currency: this is compared against the live marketplace price,
      // which is quoted in the marketplace's own currency, not in IRR.
      maxProcurementPrice: productSource.multiply(1 + rc.procurementTolerancePct),
      overheadRatio,
      riskFactor,
      viable,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + rc.quoteTtlSeconds * 1000).toISOString(),
    };
  }

  /** Refuse to price on a stale rate rather than guessing. */
  private assertFresh(observedAt: string): void {
    const ageSeconds = (Date.now() - Date.parse(observedAt)) / 1000;
    if (ageSeconds > this.rateCard.maxFxAgeSeconds) {
      throw DomainErrors.fxTooStale(Math.round(ageSeconds), this.rateCard.maxFxAgeSeconds);
    }
  }

  /** The gate is enforced at order creation, not merely reported on the quote. */
  assertViable(quote: ComputedQuote): void {
    if (!quote.viable) throw DomainErrors.notViable();
  }

  assertNotExpired(expiresAt: string): void {
    if (Date.parse(expiresAt) < Date.now()) throw DomainErrors.quoteExpired();
  }
}

/**
 * Volumetric weight, at the standard air-freight divisor of 5000 (cm³ per kg).
 * Air carriers bill the greater of actual and dimensional weight.
 */
function dimensionalWeightKg(dims: { l: number; w: number; h: number } | undefined): number {
  if (!dims) return 0;
  return (dims.l * dims.w * dims.h) / 5000;
}

function usdToIrr8(usd: number, rate: number): Money {
  return Money.fromMajor(usd.toFixed(2), 'USD').convert(rate, 'IRR');
}

/** What the customer would be refunded, and what it costs us. Used by the ops queue. */
export function marginAtRisk(quote: ComputedQuote): Money {
  return quote.breakdown.serviceFee;
}

export type { Currency };
