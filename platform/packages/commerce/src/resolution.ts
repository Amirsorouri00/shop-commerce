import { Money, ProviderUnavailableError, UpstreamError } from '@xb/core';
import { logger, metrics } from '@xb/observability';
import type { MarketplaceRegistry, MarketplaceDescriptor, MarketplaceId } from './marketplace.ts';
import type { RateLimiter } from './rate-limit.ts';
import {
  MIN_FIELD_CONFIDENCE,
  REQUIRED_FIELDS,
  type FieldProvenance,
  type ResolutionContext,
  type ResolutionOutcome,
  type ResolutionStrategy,
  type ResolvedProduct,
  type StrategyResult,
} from './types.ts';

/**
 * The resolution pipeline.
 *
 * Resolving a foreign product page is not one operation with one implementation — it is a
 * ladder of increasingly expensive techniques, and which rung you need depends on the
 * marketplace, the product, and whether the cheap rung happened to work today.
 *
 *   api        Official product API. Exact, fast, nearly free. Rarely covers shipping weight.
 *   structured JSON-LD / microdata on the page. Cheap, usually right, occasionally absent.
 *   vision     Render the page and read it with a vision model. Expensive and slower, but it
 *              sees anything a human would. The only tier that can estimate a weight from a
 *              product photo and description.
 *   manual     An operator fills the gaps. The floor that stops a resolution from ever being
 *              silently wrong.
 *
 * The pipeline runs cheap tiers first and escalates **only for the fields still missing**.
 * That last part is what keeps the cost down: when the API answered everything except
 * weight, the vision model is asked about weight, not about the whole product.
 *
 * Results merge field-by-field, keeping the highest-confidence value for each field. A
 * higher tier does not automatically win — an exact API price beats a model's reading of the
 * same number every time.
 */

export interface ResolutionPipelineOptions {
  readonly registry: MarketplaceRegistry;
  readonly strategies: readonly ResolutionStrategy[];
  readonly rateLimiter: RateLimiter;
  /** Stop escalating once every required field clears this. Default `MIN_FIELD_CONFIDENCE`. */
  readonly confidenceFloor?: number;
  /** Abort rather than escalate past this cumulative cost. */
  readonly costBudget?: number;
}

export class ResolutionPipeline {
  private readonly strategies: readonly ResolutionStrategy[];
  private readonly floor: number;
  private readonly budget: number;

  constructor(private readonly options: ResolutionPipelineOptions) {
    // Cheapest first — the escalation order is the cost order.
    this.strategies = [...options.strategies].sort((a, b) => a.costUnits - b.costUnits);
    this.floor = options.confidenceFloor ?? MIN_FIELD_CONFIDENCE;
    this.budget = options.costBudget ?? 100;
  }

  supports(url: string): boolean {
    return this.options.registry.parse(url) !== undefined;
  }

  /**
   * Re-check the live price and availability for a product already resolved.
   *
   * Separate from `resolve` because it is called at two points where a *stale* answer is
   * unacceptable — checkout revalidation and immediately before purchase — and because it
   * only needs the commercial facts, not the full product record. That makes it cheap enough
   * to run on the critical path.
   *
   * Never cached. The whole purpose is to see what the price is *now*; a cached answer here
   * would defeat the max-procurement guard that consumes it.
   */
  async checkOffer(
    marketplaceId: MarketplaceId,
    productId: string,
  ): Promise<{ price: Money; available: boolean }> {
    const marketplace = this.options.registry.get(marketplaceId);
    if (!marketplace) {
      throw new UpstreamError('resolution-pipeline', `Unknown marketplace ${marketplaceId}`);
    }

    const capable = this.strategies.filter((s) => s.canHandle(marketplaceId));
    if (capable.length === 0) {
      // Explicit and loud. Silently returning a stale or invented price here is how an order
      // gets purchased above its authorised ceiling.
      throw new ProviderUnavailableError('StorePort', {
        details: {
          marketplaceId,
          reason: 'No resolution strategy is registered — the marketplace gate has not cleared',
        },
      });
    }

    await this.options.rateLimiter.acquire(marketplaceId, 8_000);

    const ctx: ResolutionContext = {
      url: marketplace.canonicalUrl(productId),
      productId,
      marketplaceId,
      correlationId: 'offer-check',
    };

    let lastError: unknown;
    for (const strategy of capable) {
      try {
        const result = await strategy.resolve(ctx);
        const price = result.fields.price;
        if (price instanceof Money) {
          return { price, available: result.fields.available === true };
        }
      } catch (e) {
        lastError = e;
      }
    }

    throw new UpstreamError(
      'resolution-pipeline',
      `Could not re-check the offer for ${productId}`,
      lastError !== undefined ? { cause: lastError } : {},
    );
  }

  async resolve(url: string, correlationId: string): Promise<ResolutionOutcome> {
    const parsed = this.options.registry.parse(url);

    if (!parsed) {
      return {
        status: 'FAILED',
        product: undefined,
        missingFields: [...REQUIRED_FIELDS],
        strategiesTried: [],
        totalCostUnits: 0,
        notes: ['URL did not match any enabled marketplace'],
      };
    }

    const { marketplace, productId } = parsed;
    const ctx: ResolutionContext = {
      url,
      productId,
      marketplaceId: marketplace.id,
      correlationId,
    };

    const merged: Record<string, unknown> = {};
    const provenance: Record<string, { tier: string; strategy: string; confidence: number }> = {};
    const tried: string[] = [];
    const notes: string[] = [];
    let cost = 0;

    for (const strategy of this.strategies) {
      if (!strategy.canHandle(marketplace.id)) continue;

      const missing = this.missingRequired(merged, provenance);
      if (missing.length === 0) break; // everything needed is already confident enough

      if (cost + strategy.costUnits > this.budget) {
        notes.push(`Stopped before ${strategy.name}: cost budget exhausted`);
        break;
      }

      // Rate limit per marketplace, not per strategy — the marketplace is what blocks us.
      try {
        await this.options.rateLimiter.acquire(marketplace.id, 8_000);
      } catch (e) {
        notes.push(`Rate limit prevented ${strategy.name}`);
        logger.warn({ marketplace: marketplace.id, strategy: strategy.name }, 'rate limited');
        continue;
      }

      tried.push(strategy.name);
      cost += strategy.costUnits;

      try {
        const result = await strategy.resolve(ctx);
        this.merge(merged, provenance, result, strategy);
        if (result.notes) notes.push(...result.notes);

        metrics.counter('commerce.resolution.strategy', 1, {
          marketplace: marketplace.id,
          strategy: strategy.name,
          tier: strategy.tier,
          outcome: 'success',
        });
      } catch (e) {
        // A failing tier is expected — that is what the next rung is for.
        notes.push(`${strategy.name} failed: ${e instanceof Error ? e.message : String(e)}`);
        logger.warn(
          { marketplace: marketplace.id, strategy: strategy.name, err: e },
          'resolution strategy failed, escalating',
        );
        metrics.counter('commerce.resolution.strategy', 1, {
          marketplace: marketplace.id,
          strategy: strategy.name,
          tier: strategy.tier,
          outcome: 'error',
        });
      }
    }

    const missingFields = this.missingRequired(merged, provenance);
    const product = this.assemble(merged, provenance, marketplace, productId, missingFields);

    const status: ResolutionOutcome['status'] =
      missingFields.length === 0 ? 'RESOLVED' : product ? 'NEEDS_REVIEW' : 'FAILED';

    metrics.counter('commerce.resolution.total', 1, {
      marketplace: marketplace.id,
      status,
    });
    metrics.histogram('commerce.resolution.cost_units', cost, { marketplace: marketplace.id });

    return {
      status,
      product,
      missingFields,
      strategiesTried: tried,
      totalCostUnits: cost,
      notes,
    };
  }

  /**
   * Merge a strategy's output, keeping the more confident value per field.
   *
   * Ties go to the incumbent, so a cheap exact source is never displaced by an expensive
   * guess that happens to report the same confidence.
   */
  private merge(
    merged: Record<string, unknown>,
    provenance: Record<string, { tier: string; strategy: string; confidence: number }>,
    result: StrategyResult,
    strategy: ResolutionStrategy,
  ): void {
    for (const [field, value] of Object.entries(result.fields)) {
      if (value === undefined || value === null) continue;

      const confidence = result.confidence[field as keyof ResolvedProduct] ?? 0.5;
      const existing = provenance[field];

      if (!existing || confidence > existing.confidence) {
        merged[field] = value;
        provenance[field] = { tier: strategy.tier, strategy: strategy.name, confidence };
      }
    }
  }

  /** Required fields that are absent or below the confidence floor. */
  private missingRequired(
    merged: Record<string, unknown>,
    provenance: Record<string, { confidence: number }>,
  ): string[] {
    return REQUIRED_FIELDS.filter((f) => {
      if (merged[f] === undefined) return true;
      return (provenance[f]?.confidence ?? 0) < this.floor;
    });
  }

  private assemble(
    merged: Record<string, unknown>,
    provenance: Record<string, { tier: string; strategy: string; confidence: number }>,
    marketplace: MarketplaceDescriptor,
    productId: string,
    missing: readonly string[],
  ): ResolvedProduct | undefined {
    // Without a title and a price there is nothing to show a customer, even for review.
    if (merged['title'] === undefined || merged['price'] === undefined) return undefined;

    const price = merged['price'];
    if (!(price instanceof Money)) return undefined;

    return {
      marketplace: marketplace.id,
      externalProductId: productId,
      canonicalUrl: marketplace.canonicalUrl(productId),
      title: String(merged['title']),
      seller: typeof merged['seller'] === 'string' ? merged['seller'] : 'Unknown',
      brand: typeof merged['brand'] === 'string' ? merged['brand'] : undefined,
      variant: typeof merged['variant'] === 'string' ? merged['variant'] : undefined,
      imageUrl: typeof merged['imageUrl'] === 'string' ? merged['imageUrl'] : undefined,
      price,
      available: merged['available'] === true,
      // A missing weight defaults to a deliberately pessimistic 1kg so the quote overestimates
      // freight rather than underestimating it. `missing` still flags it for review.
      weightKg: typeof merged['weightKg'] === 'number' ? merged['weightKg'] : 1,
      dimensionsCm: merged['dimensionsCm'] as ResolvedProduct['dimensionsCm'],
      category: typeof merged['category'] === 'string' ? merged['category'] : 'general',
      route: marketplace.route,
      provenance: provenance as FieldProvenance,
      observedAt: new Date().toISOString(),
    };
  }
}

/**
 * How soft the data is, as a single number the quote engine can widen its risk reserve by.
 *
 * Weight is weighted heaviest because it is both the most commonly estimated field and the
 * one whose error costs the most: freight is charged per kilo, so a wrong weight is a
 * per-order margin loss that repeats on every order of that product.
 */
export function resolutionRiskFactor(product: ResolvedProduct): number {
  const weights: Partial<Record<keyof ResolvedProduct, number>> = {
    price: 0.3,
    weightKg: 0.5,
    available: 0.1,
    category: 0.1,
  };

  let risk = 0;
  for (const [field, weight] of Object.entries(weights)) {
    const confidence = product.provenance[field as keyof ResolvedProduct]?.confidence ?? 0.5;
    risk += (1 - confidence) * (weight ?? 0);
  }
  return Math.min(1, risk);
}
