// STUB ADAPTERS — ship first so the core + UI work today. Swap for real providers
// once each feasibility gate clears. Each implements a port from ports.ts.

import { money } from './shared/kernel.ts';
import type {
  StoreAdapter, ResolvedProduct, FxProvider, PaymentGateway, PaymentResult,
  ProcurementExecutor, ProcurementRequest, ProcurementResult,
  CarrierAdapter, TrackingEvent, CustomsEstimator, Route,
} from './ports.ts';
import type { Currency } from './shared/kernel.ts';

// --- Store: Amazon UAE stub with a pretend "vision-llm fallback" ---
export class AmazonAeStubStore implements StoreAdapter {
  supports(url: string): boolean {
    return url.includes('amazon.ae');
  }
  async resolve(url: string): Promise<ResolvedProduct> {
    // A real adapter calls SP-API, then vision-LLM on the rendered page if fields are missing.
    return {
      marketplace: 'amazon.ae',
      externalProductId: url.split('/dp/')[1]?.split(/[/?]/)[0] ?? 'B0UNKNOWN',
      title: 'Apple AirPods Pro (2nd generation)',
      seller: 'Apple',
      variant: 'White',
      price: money(899, 'AED'),
      available: true,
      weightKg: 0.3,
      route: 'UAE',
      resolvedVia: 'api',
      confidence: 0.98,
    };
  }
}

// --- FX: fixed illustrative rates + manual fallback ---
export class StubFx implements FxProvider {
  private rates: Record<string, number> = {
    'AED_IRR': 15000, 'USD_IRR': 55000, 'TRY_IRR': 1600, 'EUR_IRR': 60000, 'GBP_IRR': 70000,
  };
  async getRate(from: Currency, to: Currency): Promise<number> {
    if (from === to) return 1;
    const r = this.rates[`${from}_${to}`];
    if (r == null) throw new Error(`No FX rate ${from}->${to}`);
    return r;
  }
}

// --- Payment: always approves in the sandbox ---
export class StubPayment implements PaymentGateway {
  async charge(orderId: string, amount: { amount: number }): Promise<PaymentResult> {
    return { ok: true, gatewayRef: `PAY-${orderId}-${amount.amount}` };
  }
}

// --- Procurement: assisted mode; honours the max-price tolerance guard ---
export class AssistedProcurement implements ProcurementExecutor {
  readonly mode = 'assisted' as const;
  // priceOverride lets the demo simulate a marketplace price move.
  private priceOverride?: number;
  constructor(priceOverride?: number) {
    this.priceOverride = priceOverride;
  }
  async purchase(req: ProcurementRequest): Promise<ProcurementResult> {
    const actualAmount = this.priceOverride ?? req.expectedPrice.amount;
    const actual = money(actualAmount, req.expectedPrice.currency);
    if (actual.amount > req.maxPrice.amount) {
      return { ok: false, actualPrice: actual, reason: 'PRICE_CHANGED' };
    }
    return { ok: true, externalOrderId: `AMZ-${Date.now()}`, actualPrice: actual };
  }
}

// --- Carrier: canned multi-leg lifecycle ---
export class StubCarrier implements CarrierAdapter {
  async createShipment(orderId: string): Promise<string> {
    return `SHP-${orderId}`;
  }
  async track(shipmentId: string): Promise<TrackingEvent[]> {
    const now = new Date().toISOString();
    return [
      { status: 'DISPATCHED_BY_SELLER', at: now },
      { status: 'LOCAL_TRANSIT', at: now },
      { status: 'WAREHOUSE_RECEIVED', at: now },
      { status: 'INTERNATIONAL_TRANSIT', at: now },
      { status: 'CUSTOMS', at: now },
      { status: 'DOMESTIC_TRANSIT', at: now },
      { status: 'DELIVERED', at: now },
    ];
  }
}

// --- Customs: category-prior estimate ---
export class StubCustoms implements CustomsEstimator {
  async estimatePct(_route: Route, _category: string): Promise<number> {
    return 0.10; // placeholder — real engine validated at the customs gate
  }
}
