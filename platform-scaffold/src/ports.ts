// PORTS — the gated seams. Core talks to these interfaces; adapters (stub now, real later)
// implement them. Nothing in the core knows which adapter is live.

import type { Money, Currency } from './shared/kernel.ts';

export type Route = 'UAE' | 'Turkey' | 'Germany' | 'UK' | 'Japan';
export type Marketplace = 'amazon.ae' | 'amazon.com.tr' | 'amazon.de' | 'amazon.co.uk';

export interface ResolvedProduct {
  marketplace: Marketplace;
  externalProductId: string;
  title: string;
  seller: string;
  variant: string;
  price: Money;           // in source currency, e.g. AED
  available: boolean;
  weightKg: number;       // may be estimated
  route: Route;
  resolvedVia: 'api' | 'vision-llm';
  confidence: number;     // 0..1 per-field confidence (weight/dims are the risky ones)
}

// --- Store port (product resolution) ---
export interface StoreAdapter {
  supports(url: string): boolean;
  resolve(url: string): Promise<ResolvedProduct>;
}

// --- FX port ---
export interface FxProvider {
  getRate(from: Currency, to: Currency): Promise<number>;
}

// --- Payment port (customer IRR) ---
export interface PaymentResult { ok: boolean; gatewayRef: string; }
export interface PaymentGateway {
  charge(orderId: string, amount: Money): Promise<PaymentResult>;
}

// --- Procurement port (foreign purchase) ---
export interface ProcurementRequest {
  procurementOrderId: string;
  marketplace: Marketplace;
  externalProductId: string;
  expectedPrice: Money;
  maxPrice: Money;          // tolerance guard
}
export interface ProcurementResult {
  ok: boolean;
  externalOrderId?: string;
  actualPrice: Money;
  reason?: 'PRICE_CHANGED' | 'OUT_OF_STOCK' | 'PROCUREMENT_FAILED';
}
export interface ProcurementExecutor {
  // mode reflects the roadmap: assisted -> agentic -> api
  readonly mode: 'assisted' | 'agentic' | 'api';
  purchase(req: ProcurementRequest): Promise<ProcurementResult>;
}

// --- Carrier port (shipment legs + tracking) ---
export interface TrackingEvent { status: string; at: string; }
export interface CarrierAdapter {
  createShipment(orderId: string): Promise<string>;    // returns shipmentId
  track(shipmentId: string): Promise<TrackingEvent[]>;
}

// --- Customs estimator ---
export interface CustomsEstimator {
  estimatePct(route: Route, category: string): Promise<number>; // fraction of value
}
