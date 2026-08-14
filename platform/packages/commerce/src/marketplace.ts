import type { Currency } from '@xb/core';

/**
 * Marketplace descriptors.
 *
 * Adding a corridor — Turkey, Germany, UK — should be data plus one adapter, never a change
 * to the resolution engine, the quote engine or the order flow. That only holds if
 * everything the rest of the system needs to know about a marketplace lives in a descriptor
 * like this one, rather than in scattered conditionals.
 *
 * The capability matrix is the important part. Marketplaces differ in what they will let us
 * do — some expose a product API, some can be purchased through an API, most cannot — and
 * the procurement engine has to branch on that. Encoding it as data means the branch is a
 * lookup instead of an `if (marketplace === 'amazon.ae')` that gets copied five times.
 */

export type MarketplaceId =
  | 'amazon.ae'
  | 'amazon.com.tr'
  | 'amazon.de'
  | 'amazon.co.uk'
  | 'noon.com'
  | 'trendyol.com';

export type Route = 'UAE' | 'Turkey' | 'Germany' | 'UK' | 'Japan';

/** What a marketplace will actually let us do. Drives strategy selection at runtime. */
export interface MarketplaceCapabilities {
  /** An official product API exists and we hold credentials for it. */
  readonly productApi: boolean;
  /** Purchases can be placed programmatically. Almost never true today. */
  readonly purchaseApi: boolean;
  /** Structured data (JSON-LD, microdata) is reliable enough to extract from. */
  readonly structuredData: boolean;
  /** Rendering the page for a vision model is permitted and technically viable. */
  readonly visionFallback: boolean;
  /** Order status can be polled or received by webhook after purchase. */
  readonly orderTracking: boolean;
}

export interface MarketplaceDescriptor {
  readonly id: MarketplaceId;
  readonly displayName: { readonly en: string; readonly fa: string };
  /** Hostnames that belong to this marketplace. Matched exactly, never by substring. */
  readonly hosts: readonly string[];
  readonly currency: Currency;
  readonly route: Route;
  readonly capabilities: MarketplaceCapabilities;
  /**
   * Requests per second we allow ourselves against this marketplace.
   * Set below any published limit — being rate-limited is recoverable, being blocked is not.
   */
  readonly rateLimitPerSecond: number;
  /** Burst allowance for the token bucket. */
  readonly burst: number;
  /** Extract the marketplace's own product id from a URL. */
  readonly extractProductId: (url: URL) => string | undefined;
  /** Rebuild a canonical product URL from an id — user-pasted URLs carry tracking junk. */
  readonly canonicalUrl: (productId: string) => string;
  /** Live in MVP, or designed but not yet enabled. */
  readonly enabled: boolean;
}

const amazonProductId = (url: URL): string | undefined => {
  // /dp/B0XXXX, /gp/product/B0XXXX, and the /-/en/dp/B0XXXX locale variant.
  const m = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i.exec(url.pathname);
  return m?.[1]?.toUpperCase();
};

export const MARKETPLACES: readonly MarketplaceDescriptor[] = [
  {
    id: 'amazon.ae',
    displayName: { en: 'Amazon UAE', fa: 'آمازون امارات' },
    hosts: ['amazon.ae', 'www.amazon.ae'],
    currency: 'AED',
    route: 'UAE',
    capabilities: {
      productApi: true,
      purchaseApi: false, // assisted procurement only — see the procurement gate
      structuredData: true,
      visionFallback: true,
      orderTracking: true,
    },
    rateLimitPerSecond: 2,
    burst: 5,
    extractProductId: amazonProductId,
    canonicalUrl: (id) => `https://www.amazon.ae/dp/${id}`,
    enabled: true,
  },
  {
    id: 'amazon.com.tr',
    displayName: { en: 'Amazon Türkiye', fa: 'آمازون ترکیه' },
    hosts: ['amazon.com.tr', 'www.amazon.com.tr'],
    currency: 'TRY',
    route: 'Turkey',
    capabilities: {
      productApi: true,
      purchaseApi: false,
      structuredData: true,
      visionFallback: true,
      orderTracking: true,
    },
    rateLimitPerSecond: 2,
    burst: 5,
    extractProductId: amazonProductId,
    canonicalUrl: (id) => `https://www.amazon.com.tr/dp/${id}`,
    enabled: false, // corridor designed, not opened
  },
  {
    id: 'noon.com',
    displayName: { en: 'Noon', fa: 'نون' },
    hosts: ['noon.com', 'www.noon.com'],
    currency: 'AED',
    route: 'UAE',
    capabilities: {
      productApi: false,
      purchaseApi: false,
      structuredData: true,
      visionFallback: true,
      orderTracking: false,
    },
    rateLimitPerSecond: 1,
    burst: 3,
    extractProductId: (url) => /\/([A-Z0-9]+)\/p\//i.exec(url.pathname)?.[1],
    canonicalUrl: (id) => `https://www.noon.com/uae-en/${id}/p/`,
    enabled: false,
  },
];

export class MarketplaceRegistry {
  private readonly byHost = new Map<string, MarketplaceDescriptor>();
  private readonly byId = new Map<MarketplaceId, MarketplaceDescriptor>();

  constructor(descriptors: readonly MarketplaceDescriptor[] = MARKETPLACES) {
    for (const d of descriptors) {
      this.byId.set(d.id, d);
      for (const h of d.hosts) this.byHost.set(h.toLowerCase(), d);
    }
  }

  /**
   * Resolve a pasted URL to a marketplace.
   *
   * Matches the hostname exactly against the allowlist. Substring matching would accept
   * `amazon.ae.attacker.example`, which is precisely the trick a URL allowlist exists to stop.
   */
  match(rawUrl: string): MarketplaceDescriptor | undefined {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return undefined;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;

    const d = this.byHost.get(url.hostname.toLowerCase());
    return d?.enabled === true ? d : undefined;
  }

  get(id: MarketplaceId): MarketplaceDescriptor | undefined {
    return this.byId.get(id);
  }

  enabled(): MarketplaceDescriptor[] {
    return [...this.byId.values()].filter((d) => d.enabled);
  }

  /** Parse a URL into the pieces the resolution pipeline needs. */
  parse(rawUrl: string): { marketplace: MarketplaceDescriptor; productId: string } | undefined {
    const marketplace = this.match(rawUrl);
    if (!marketplace) return undefined;

    const productId = marketplace.extractProductId(new URL(rawUrl));
    if (!productId) return undefined;

    return { marketplace, productId };
  }
}

export const marketplaceRegistry = new MarketplaceRegistry();
