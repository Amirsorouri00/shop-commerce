// Pricing / Quote engine — landed cost. Deterministic. Mirrors the v0.3 economics model.

import { money, genId } from '../shared/kernel.ts';
import type { Money } from '../shared/kernel.ts';
import type { FxProvider, CustomsEstimator, ResolvedProduct, Route } from '../ports.ts';

// Rate card (illustrative — same as Logistics-Economics-v0.3.xlsx). Real quotes replace these.
const FREIGHT_USD_PER_KG: Record<Route, number> = {
  UAE: 6, Turkey: 7, Germany: 12, UK: 13, Japan: 16,
};
const HANDLING_USD = 8;
const LASTMILE_USD = 3;
const INSURANCE_PCT = 0.02;
const MARGIN_PCT = 0.12;
const MAX_PROCUREMENT_TOLERANCE = 0.02; // actual may exceed expected by up to 2%
const VIABILITY_THRESHOLD = 0.25;       // logistics overhead cap (fraction of value)
const QUOTE_TTL_SECONDS = 300;

export interface QuoteBreakdown {
  productIRR: number;
  freightIRR: number;
  handlingIRR: number;
  lastMileIRR: number;
  customsIRR: number;
  insuranceIRR: number;
  feeIRR: number;
}

export interface Quote {
  id: string;
  productSnapshot: ResolvedProduct;
  fxRate: number;
  breakdown: QuoteBreakdown;
  finalPrice: Money;         // IRR
  maxProcurementPrice: Money; // in source currency (guard)
  overheadRatio: number;      // logistics / product value
  viable: boolean;
  createdAt: string;
  expiresAt: string;
}

export class QuoteEngine {
  private fx: FxProvider;
  private customs: CustomsEstimator;
  constructor(fx: FxProvider, customs: CustomsEstimator) {
    this.fx = fx;
    this.customs = customs;
  }

  async createQuote(p: ResolvedProduct, category = 'electronics', qty = 1): Promise<Quote> {
    const aedIrr = await this.fx.getRate(p.price.currency, 'IRR');
    const usdIrr = await this.fx.getRate('USD', 'IRR');
    const customsPct = await this.customs.estimatePct(p.route, category);

    const productValueUSD = (p.price.amount * qty) * (aedIrr / usdIrr); // for the overhead ratio
    const chargeableKg = Math.max(p.weightKg * qty, 0.1);

    const productIRR = p.price.amount * qty * aedIrr;
    const freightUSD = FREIGHT_USD_PER_KG[p.route] * chargeableKg;
    const freightIRR = freightUSD * usdIrr;
    const handlingIRR = HANDLING_USD * usdIrr;
    const lastMileIRR = LASTMILE_USD * usdIrr;
    const insuranceIRR = INSURANCE_PCT * productIRR;
    const customsIRR = customsPct * productIRR;

    const logisticsIRR = freightIRR + handlingIRR + lastMileIRR + insuranceIRR;
    const overheadRatio = logisticsIRR / productIRR;

    const preFee = productIRR + logisticsIRR + customsIRR;
    const feeIRR = MARGIN_PCT * preFee;
    const finalIRR = preFee + feeIRR;

    const now = Date.now();
    return {
      id: genId('QUO'),
      productSnapshot: p,
      fxRate: aedIrr,
      breakdown: { productIRR, freightIRR, handlingIRR, lastMileIRR, customsIRR, insuranceIRR, feeIRR },
      finalPrice: money(finalIRR, 'IRR'),
      maxProcurementPrice: money(p.price.amount * qty * (1 + MAX_PROCUREMENT_TOLERANCE), p.price.currency),
      overheadRatio,
      viable: overheadRatio <= VIABILITY_THRESHOLD,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + QUOTE_TTL_SECONDS * 1000).toISOString(),
    };
  }
}
