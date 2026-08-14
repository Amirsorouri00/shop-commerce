import { Money, UpstreamError, type Currency } from '@xb/core';
import { logger } from '@xb/observability';
import type { MarketplaceId } from './marketplace.ts';
import type { ResolutionContext, ResolutionStrategy, StrategyResult } from './types.ts';

/**
 * Concrete resolution strategies.
 *
 * Each is a rung on the escalation ladder. They are written against the *shape* of the real
 * integration so that swapping in credentials is a change inside one class — the pipeline,
 * the quote engine and the order flow never learn which rung answered.
 *
 * Where a real credentialed integration is not yet available, the class says so explicitly
 * and throws `UpstreamError` rather than inventing data. A strategy that silently fabricates
 * a plausible weight is worse than one that fails: the pipeline can escalate past a failure,
 * but it cannot detect a confident lie.
 */

// ─────────────────────────── tier 1: official API ───────────────────────────

export interface MarketplaceApiClient {
  getProduct(
    marketplaceId: MarketplaceId,
    productId: string,
  ): Promise<{
    title: string;
    brand?: string;
    seller?: string;
    imageUrl?: string;
    priceMinor: number;
    currency: Currency;
    available: boolean;
    weightKg?: number;
    dimensionsCm?: { l: number; w: number; h: number };
    category?: string;
  }>;
}

/**
 * Official product API (Amazon SP-API `getCatalogItem`, or a marketplace equivalent).
 *
 * Highest confidence on commercial facts — price, availability, title are authoritative.
 * Notably weaker on shipping weight: catalogue weight is the *item* weight, which is not the
 * chargeable weight once packaging and dimensional weight are applied. Confidence is set
 * accordingly so the pipeline still escalates for it when it matters.
 */
export class ApiResolutionStrategy implements ResolutionStrategy {
  readonly name = 'marketplace-api';
  readonly tier = 'api' as const;
  readonly costUnits = 1;

  constructor(
    private readonly client: MarketplaceApiClient,
    private readonly supportedMarketplaces: readonly MarketplaceId[],
  ) {}

  canHandle(marketplaceId: MarketplaceId): boolean {
    return this.supportedMarketplaces.includes(marketplaceId);
  }

  async resolve(ctx: ResolutionContext): Promise<StrategyResult> {
    const item = await this.client.getProduct(ctx.marketplaceId, ctx.productId);

    return {
      fields: {
        title: item.title,
        brand: item.brand,
        seller: item.seller ?? 'Unknown',
        imageUrl: item.imageUrl,
        price: Money.of(item.priceMinor, item.currency),
        available: item.available,
        weightKg: item.weightKg,
        dimensionsCm: item.dimensionsCm,
        category: item.category,
      },
      confidence: {
        title: 0.99,
        brand: 0.95,
        seller: 0.95,
        imageUrl: 0.95,
        price: 0.99,
        available: 0.95,
        // Catalogue weight ignores packaging and dimensional weight, so it is a starting
        // point rather than the chargeable figure. Deliberately below the escalation floor.
        weightKg: item.weightKg === undefined ? 0 : 0.6,
        dimensionsCm: item.dimensionsCm === undefined ? 0 : 0.7,
        category: 0.8,
      },
    };
  }
}

// ─────────────────────────── tier 2: structured data ───────────────────────────

export interface PageFetcher {
  /** Fetch rendered HTML. Implementations handle proxying, headers and session reuse. */
  fetchHtml(url: string): Promise<string>;
  /** Render to an image for the vision tier. */
  screenshot?(url: string): Promise<Buffer>;
}

/**
 * JSON-LD / schema.org extraction.
 *
 * Most large marketplaces publish a `Product` node for their own SEO. It is cheap to read
 * and usually correct, but it is not a contract — it changes without notice, which is why
 * this is a middle rung and not the only one.
 */
export class StructuredDataStrategy implements ResolutionStrategy {
  readonly name = 'structured-data';
  readonly tier = 'structured' as const;
  readonly costUnits = 3;

  constructor(
    private readonly fetcher: PageFetcher,
    private readonly supportedMarketplaces: readonly MarketplaceId[],
  ) {}

  canHandle(marketplaceId: MarketplaceId): boolean {
    return this.supportedMarketplaces.includes(marketplaceId);
  }

  async resolve(ctx: ResolutionContext): Promise<StrategyResult> {
    const html = await this.fetcher.fetchHtml(ctx.url);
    const product = extractJsonLdProduct(html);

    if (!product) {
      throw new UpstreamError(this.name, 'No JSON-LD Product node found on the page');
    }

    const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
    const priceMajor = offer?.price !== undefined ? Number(offer.price) : undefined;
    const currency = offer?.priceCurrency as Currency | undefined;

    return {
      fields: {
        title: typeof product.name === 'string' ? product.name : undefined,
        brand: extractBrand(product),
        seller: typeof offer?.seller?.name === 'string' ? offer.seller.name : undefined,
        imageUrl: extractImage(product),
        price:
          priceMajor !== undefined && currency
            ? Money.fromMajor(priceMajor, currency)
            : undefined,
        available: offer?.availability
          ? /InStock/i.test(String(offer.availability))
          : undefined,
        weightKg: extractWeightKg(product),
        category: typeof product.category === 'string' ? product.category : undefined,
      },
      confidence: {
        title: 0.9,
        brand: 0.85,
        seller: 0.75,
        imageUrl: 0.9,
        price: 0.85,
        available: 0.8,
        weightKg: 0.55,
        category: 0.7,
      },
      notes: ['Resolved from page structured data; not an authoritative source'],
    };
  }
}

interface JsonLdOffer {
  price?: string | number;
  priceCurrency?: string;
  availability?: string;
  seller?: { name?: string };
}

interface JsonLdProduct {
  '@type'?: string | string[];
  name?: string;
  category?: string;
  brand?: string | { name?: string };
  image?: string | string[];
  weight?: { value?: string | number; unitCode?: string; unitText?: string };
  offers?: JsonLdOffer | JsonLdOffer[];
}

/** Pull the first schema.org Product node out of a page's JSON-LD blocks. */
export function extractJsonLdProduct(html: string): JsonLdProduct | undefined {
  const blocks = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );

  for (const block of blocks) {
    const raw = block[1];
    if (!raw) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      continue; // malformed JSON-LD is common; skip rather than fail the tier
    }

    // A block may be a single node, an array, or a @graph wrapper.
    const candidates: unknown[] = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed['@graph'])
        ? (parsed['@graph'] as unknown[])
        : [parsed];

    for (const node of candidates) {
      if (!isRecord(node)) continue;
      const type = node['@type'];
      const isProduct = Array.isArray(type)
        ? type.some((t) => String(t) === 'Product')
        : String(type) === 'Product';
      if (isProduct) return node as JsonLdProduct;
    }
  }

  return undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function extractBrand(p: JsonLdProduct): string | undefined {
  if (typeof p.brand === 'string') return p.brand;
  if (isRecord(p.brand) && typeof p.brand['name'] === 'string') return p.brand['name'];
  return undefined;
}

function extractImage(p: JsonLdProduct): string | undefined {
  if (typeof p.image === 'string') return p.image;
  if (Array.isArray(p.image) && typeof p.image[0] === 'string') return p.image[0];
  return undefined;
}

/** Normalise whatever unit the page used into kilograms. */
export function extractWeightKg(p: JsonLdProduct): number | undefined {
  const w = p.weight;
  if (!w || w.value === undefined) return undefined;

  const value = Number(w.value);
  if (!Number.isFinite(value) || value <= 0) return undefined;

  const unit = String(w.unitCode ?? w.unitText ?? 'KGM').toUpperCase();
  switch (unit) {
    case 'KGM':
    case 'KG':
    case 'KILOGRAM':
    case 'KILOGRAMS':
      return value;
    case 'GRM':
    case 'G':
    case 'GRAM':
    case 'GRAMS':
      return value / 1000;
    case 'LBR':
    case 'LB':
    case 'POUND':
    case 'POUNDS':
      return value * 0.453_592;
    case 'ONZ':
    case 'OZ':
    case 'OUNCE':
    case 'OUNCES':
      return value * 0.028_349_5;
    default:
      return undefined; // unknown unit is worse than no answer
  }
}

// ─────────────────────────── tier 3: vision model ───────────────────────────

export interface VisionExtractor {
  extractProduct(
    imageOrHtml: Buffer | string,
    wantedFields: readonly string[],
  ): Promise<{
    fields: Record<string, unknown>;
    confidence: Record<string, number>;
  }>;
}

/**
 * Vision-model fallback.
 *
 * The most capable and the most expensive rung, so it is asked only about the fields still
 * missing rather than the whole product. It is also the only tier that can produce a
 * *shipping* weight estimate — inferred from category, dimensions and product type — which
 * is exactly the field the cheaper tiers are weakest on.
 *
 * Its output never touches a monetary record directly: a model-supplied price is a candidate
 * that the procurement guard re-checks against the live offer before any money moves.
 */
export class VisionResolutionStrategy implements ResolutionStrategy {
  readonly name = 'vision-llm';
  readonly tier = 'vision' as const;
  readonly costUnits = 20;

  constructor(
    private readonly extractor: VisionExtractor,
    private readonly fetcher: PageFetcher,
  ) {}

  canHandle(): boolean {
    return true; // the universal fallback — it works wherever a page renders
  }

  async resolve(ctx: ResolutionContext): Promise<StrategyResult> {
    const wanted = ['title', 'price', 'available', 'weightKg', 'category', 'seller', 'variant'];

    const input: Buffer | string = this.fetcher.screenshot
      ? await this.fetcher.screenshot(ctx.url)
      : await this.fetcher.fetchHtml(ctx.url);

    const out = await this.extractor.extractProduct(input, wanted);

    logger.debug(
      { marketplace: ctx.marketplaceId, productId: ctx.productId },
      'vision extraction complete',
    );

    const priceMinor = out.fields['priceMinor'];
    const currency = out.fields['currency'];

    return {
      fields: {
        title: asString(out.fields['title']),
        seller: asString(out.fields['seller']),
        variant: asString(out.fields['variant']),
        price:
          typeof priceMinor === 'number' && typeof currency === 'string'
            ? Money.of(priceMinor, currency as Currency)
            : undefined,
        available: typeof out.fields['available'] === 'boolean' ? out.fields['available'] : undefined,
        weightKg: typeof out.fields['weightKg'] === 'number' ? out.fields['weightKg'] : undefined,
        category: asString(out.fields['category']),
      },
      // A model's confidence is capped: it is a self-report, and treating it as equal to an
      // API's certainty would let a confident hallucination outrank an authoritative fact.
      confidence: {
        title: cap(out.confidence['title'], 0.85),
        seller: cap(out.confidence['seller'], 0.7),
        variant: cap(out.confidence['variant'], 0.7),
        price: cap(out.confidence['price'], 0.75),
        available: cap(out.confidence['available'], 0.7),
        weightKg: cap(out.confidence['weightKg'], 0.7),
        category: cap(out.confidence['category'], 0.8),
      },
      notes: ['Fields estimated by a vision model; price re-checked before purchase'],
    };
  }
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function cap(value: number | undefined, ceiling: number): number {
  return Math.min(value ?? 0.5, ceiling);
}

// ─────────────────────────── tier 4: manual ───────────────────────────

/**
 * Operator-completed resolution.
 *
 * The floor of the ladder. When every automated tier has failed or produced low confidence,
 * an operator supplies the missing fields from the back office. Confidence is 1.0 — a human
 * looked at the page.
 */
export class ManualResolutionStrategy implements ResolutionStrategy {
  readonly name = 'manual-operator';
  readonly tier = 'manual' as const;
  readonly costUnits = 50; // expensive in the only currency that matters here: operator time

  canHandle(): boolean {
    return true;
  }

  async resolve(ctx: ResolutionContext): Promise<StrategyResult> {
    const overrides = ctx.manualOverrides;
    if (!overrides) {
      throw new UpstreamError(this.name, 'Manual resolution requires operator input');
    }

    const confidence: Record<string, number> = {};
    for (const key of Object.keys(overrides)) confidence[key] = 1;

    return {
      fields: overrides,
      confidence,
      notes: ['Completed by an operator'],
    };
  }
}
