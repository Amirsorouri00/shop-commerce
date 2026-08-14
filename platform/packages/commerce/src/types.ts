import type { Money } from '@xb/core';
import type { MarketplaceId, Route } from './marketplace.ts';

/**
 * The canonical product shape.
 *
 * Every marketplace normalises to this, so the quote engine, the order flow and both
 * frontends never learn that Amazon and Noon describe a product differently.
 */
export interface ResolvedProduct {
  readonly marketplace: MarketplaceId;
  readonly externalProductId: string;
  readonly canonicalUrl: string;
  readonly title: string;
  readonly seller: string;
  readonly brand: string | undefined;
  readonly variant: string | undefined;
  readonly imageUrl: string | undefined;
  readonly price: Money;
  readonly available: boolean;
  /** Chargeable weight drives freight, which is most of the landed cost. */
  readonly weightKg: number;
  readonly dimensionsCm: { l: number; w: number; h: number } | undefined;
  readonly category: string;
  readonly route: Route;
  /** Which tier produced each field, and how confident it is. */
  readonly provenance: FieldProvenance;
  readonly observedAt: string;
}

export type ResolutionTier = 'api' | 'structured' | 'vision' | 'manual';

export interface FieldConfidence {
  readonly tier: ResolutionTier;
  readonly strategy: string;
  /** 0..1. Below `MIN_FIELD_CONFIDENCE` the field is treated as missing. */
  readonly confidence: number;
}

/**
 * Per-field provenance.
 *
 * Whole-record confidence is not good enough here. An API answer gives an exact price and
 * no shipping weight; a vision model estimates a weight it cannot know precisely. Those two
 * facts have very different reliability and very different consequences — a wrong price is
 * caught by the procurement guard, a wrong weight silently destroys the margin on every
 * order of that product. Tracking confidence per field is what lets the quote engine widen
 * its risk reserve exactly where the data is soft.
 */
export type FieldProvenance = Readonly<Partial<Record<keyof ResolvedProduct, FieldConfidence>>>;

/** Fields a quote cannot be produced without. */
export const REQUIRED_FIELDS = [
  'title',
  'price',
  'available',
  'weightKg',
  'category',
] as const satisfies readonly (keyof ResolvedProduct)[];

/** Below this, a field is not trustworthy enough to use. */
export const MIN_FIELD_CONFIDENCE = 0.5;

/**
 * Optional-with-explicit-undefined.
 *
 * Plain `Partial<T>` is not enough under `exactOptionalPropertyTypes`: it makes a property
 * omittable but still refuses an explicitly assigned `undefined`. Strategies genuinely need
 * to say "I looked for this field and did not find it", which is an assigned `undefined`,
 * so the mapped type has to admit it.
 */
export type Incomplete<T> = { readonly [K in keyof T]?: T[K] | undefined };

/** The fields a strategy is allowed to contribute — the rest are derived by the pipeline. */
export type ContributableFields = Omit<
  ResolvedProduct,
  'provenance' | 'marketplace' | 'externalProductId' | 'canonicalUrl' | 'route' | 'observedAt'
>;

/** What a strategy returns — a partial product plus how sure it is of each field. */
export interface StrategyResult {
  readonly fields: Incomplete<ContributableFields>;
  readonly confidence: Readonly<Partial<Record<keyof ResolvedProduct, number>>>;
  /** Non-fatal notes surfaced to operators when a resolution needs review. */
  readonly notes?: readonly string[];
}

export interface ResolutionContext {
  readonly url: string;
  readonly productId: string;
  readonly marketplaceId: MarketplaceId;
  readonly correlationId: string;
  /** Operator-supplied values when a human is completing a failed resolution. */
  readonly manualOverrides?: Partial<ResolvedProduct>;
}

export interface ResolutionStrategy {
  readonly name: string;
  readonly tier: ResolutionTier;
  /**
   * Relative cost of running this strategy — an API call is cheap, a vision model is not.
   * The pipeline runs cheap strategies first and only escalates when it must.
   */
  readonly costUnits: number;
  /** Whether this strategy can run for this marketplace at all. */
  canHandle(marketplaceId: MarketplaceId): boolean;
  resolve(ctx: ResolutionContext): Promise<StrategyResult>;
}

export type ResolutionStatus = 'RESOLVED' | 'NEEDS_REVIEW' | 'FAILED';

export interface ResolutionOutcome {
  readonly status: ResolutionStatus;
  readonly product: ResolvedProduct | undefined;
  /** Required fields still missing or below the confidence floor. */
  readonly missingFields: readonly string[];
  readonly strategiesTried: readonly string[];
  readonly totalCostUnits: number;
  readonly notes: readonly string[];
}

// ─────────────────────────── ports ───────────────────────────

/** Product resolution. Implemented by the pipeline; consumed through the proxy chain. */
export interface StorePort {
  supports(url: string): boolean;
  resolve(url: string, correlationId: string): Promise<ResolutionOutcome>;
  /** Cheap re-check used at checkout revalidation and before procurement. */
  checkOffer(
    marketplaceId: MarketplaceId,
    productId: string,
  ): Promise<{ price: Money; available: boolean }>;
}

export type ProcurementMode = 'assisted' | 'agentic' | 'api';

export interface ProcurementRequest {
  readonly procurementOrderId: string;
  readonly marketplaceId: MarketplaceId;
  readonly externalProductId: string;
  readonly quantity: number;
  readonly expectedPrice: Money;
  /** Hard ceiling. Exceeding it must branch the order, never buy. */
  readonly maxPrice: Money;
  readonly idempotencyKey: string;
}

export type ProcurementFailureReason =
  | 'PRICE_CHANGED'
  | 'OUT_OF_STOCK'
  | 'PAYMENT_INSTRUMENT_DECLINED'
  | 'REQUIRES_OPERATOR'
  | 'PROCUREMENT_FAILED';

export interface ProcurementResult {
  readonly ok: boolean;
  readonly externalOrderId: string | undefined;
  readonly actualPrice: Money;
  readonly reason: ProcurementFailureReason | undefined;
  readonly mode: ProcurementMode;
  /** Set when the mode requires a human to finish the purchase. */
  readonly operatorTask: OperatorTask | undefined;
}

export interface OperatorTask {
  readonly procurementOrderId: string;
  readonly checkoutUrl: string;
  readonly expectedPrice: Money;
  readonly maxAuthorised: Money;
  readonly instructions: { readonly en: string; readonly fa: string };
}

export interface ProcurementPort {
  readonly mode: ProcurementMode;
  purchase(req: ProcurementRequest): Promise<ProcurementResult>;
  /** Poll a placed order's status at the marketplace. */
  checkOrderStatus(
    marketplaceId: MarketplaceId,
    externalOrderId: string,
  ): Promise<{ status: string; shippedAt?: string; trackingNumber?: string }>;
}
