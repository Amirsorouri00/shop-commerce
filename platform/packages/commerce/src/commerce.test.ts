import { describe, it, expect } from 'vitest';
import { Money } from '@xb/core';
import { MarketplaceRegistry, marketplaceRegistry } from './marketplace.ts';
import { MemoryRateLimiter, RateLimitExceededError, bucketConfigsFrom } from './rate-limit.ts';
import { ResolutionPipeline, resolutionRiskFactor } from './resolution.ts';
import { extractJsonLdProduct, extractWeightKg } from './strategies.ts';
import { ProcurementEngine, confirmOperatorPurchase } from './procurement.ts';
import type { ResolutionStrategy, StorePort, StrategyResult } from './types.ts';

describe('MarketplaceRegistry', () => {
  it('matches an enabled marketplace by exact host', () => {
    expect(marketplaceRegistry.match('https://www.amazon.ae/dp/B0CHWRXH8B')?.id).toBe('amazon.ae');
  });

  it('rejects a lookalike host', () => {
    // The whole reason hosts are matched exactly rather than by substring.
    expect(marketplaceRegistry.match('https://amazon.ae.attacker.example/dp/B0X')).toBeUndefined();
    expect(marketplaceRegistry.match('https://notamazon.ae/dp/B0X')).toBeUndefined();
  });

  it('rejects a marketplace that is designed but not yet enabled', () => {
    expect(marketplaceRegistry.match('https://www.amazon.com.tr/dp/B0CHWRXH8B')).toBeUndefined();
  });

  it('rejects non-http protocols', () => {
    expect(marketplaceRegistry.match('javascript:alert(1)')).toBeUndefined();
    expect(marketplaceRegistry.match('file:///etc/passwd')).toBeUndefined();
  });

  it('extracts the product id from every Amazon URL shape', () => {
    const shapes = [
      'https://www.amazon.ae/dp/B0CHWRXH8B',
      'https://www.amazon.ae/dp/B0CHWRXH8B?ref=tracking&tag=junk',
      'https://www.amazon.ae/gp/product/B0CHWRXH8B',
      'https://www.amazon.ae/Apple-AirPods-Pro/dp/B0CHWRXH8B/ref=sr_1_1',
    ];
    for (const url of shapes) {
      expect(marketplaceRegistry.parse(url)?.productId).toBe('B0CHWRXH8B');
    }
  });

  it('produces a canonical URL free of tracking parameters', () => {
    const parsed = marketplaceRegistry.parse('https://www.amazon.ae/dp/B0CHWRXH8B?tag=aff-123');
    expect(parsed!.marketplace.canonicalUrl(parsed!.productId)).toBe(
      'https://www.amazon.ae/dp/B0CHWRXH8B',
    );
  });
});

describe('rate limiting', () => {
  it('permits a burst then throttles', async () => {
    const limiter = new MemoryRateLimiter(new Map([['amazon.ae', { ratePerSecond: 2, burst: 3 }]]));
    expect(await limiter.tryAcquire('amazon.ae')).toBe(true);
    expect(await limiter.tryAcquire('amazon.ae')).toBe(true);
    expect(await limiter.tryAcquire('amazon.ae')).toBe(true);
    expect(await limiter.tryAcquire('amazon.ae')).toBe(false); // burst exhausted
  });

  it('refills over time', async () => {
    const limiter = new MemoryRateLimiter(new Map([['m', { ratePerSecond: 20, burst: 1 }]]));
    expect(await limiter.tryAcquire('m')).toBe(true);
    expect(await limiter.tryAcquire('m')).toBe(false);
    await new Promise((r) => setTimeout(r, 80)); // 20/s => a token in 50ms
    expect(await limiter.tryAcquire('m')).toBe(true);
  });

  it('throws rather than waiting past the caller deadline', async () => {
    const limiter = new MemoryRateLimiter(new Map([['m', { ratePerSecond: 0.1, burst: 1 }]]));
    await limiter.acquire('m');
    await expect(limiter.acquire('m', 50)).rejects.toBeInstanceOf(RateLimitExceededError);
  });

  it('builds bucket configs from marketplace descriptors', () => {
    const cfg = bucketConfigsFrom([{ id: 'amazon.ae', rateLimitPerSecond: 2, burst: 5 }]);
    expect(cfg.get('amazon.ae')).toEqual({ ratePerSecond: 2, burst: 5 });
  });
});

/** A strategy contributing exactly the fields it is told to, at a stated confidence. */
function strategyStub(
  name: string,
  tier: ResolutionStrategy['tier'],
  costUnits: number,
  fields: StrategyResult['fields'],
  confidence: StrategyResult['confidence'],
  onCall?: () => void,
): ResolutionStrategy {
  return {
    name,
    tier,
    costUnits,
    canHandle: () => true,
    async resolve() {
      onCall?.();
      return { fields, confidence };
    },
  };
}

describe('ResolutionPipeline', () => {
  const limiter = new MemoryRateLimiter(
    new Map([['amazon.ae', { ratePerSecond: 100, burst: 100 }]]),
  );
  const url = 'https://www.amazon.ae/dp/B0CHWRXH8B';

  it('stops at the cheapest tier when it answers everything confidently', async () => {
    let visionCalls = 0;

    const pipeline = new ResolutionPipeline({
      registry: marketplaceRegistry,
      rateLimiter: limiter,
      strategies: [
        strategyStub(
          'api',
          'api',
          1,
          {
            title: 'AirPods',
            price: Money.fromMajor('899.00', 'AED'),
            available: true,
            weightKg: 0.35,
            category: 'electronics',
          },
          { title: 0.99, price: 0.99, available: 0.95, weightKg: 0.9, category: 0.9 },
        ),
        strategyStub('vision', 'vision', 20, {}, {}, () => {
          visionCalls++;
        }),
      ],
    });

    const outcome = await pipeline.resolve(url, 'corr-1');

    expect(outcome.status).toBe('RESOLVED');
    expect(visionCalls).toBe(0); // never paid for the expensive tier
    expect(outcome.totalCostUnits).toBe(1);
  });

  it('escalates only for the fields still missing, and keeps the authoritative value', async () => {
    const pipeline = new ResolutionPipeline({
      registry: marketplaceRegistry,
      rateLimiter: limiter,
      strategies: [
        // The realistic API case: authoritative commercially, weak on shipping weight.
        strategyStub(
          'api',
          'api',
          1,
          {
            title: 'AirPods',
            price: Money.fromMajor('899.00', 'AED'),
            available: true,
            category: 'electronics',
          },
          { title: 0.99, price: 0.99, available: 0.95, category: 0.9 },
        ),
        strategyStub(
          'vision',
          'vision',
          20,
          { weightKg: 0.4, title: 'AirPods (from image)', price: Money.fromMajor('999.00', 'AED') },
          { weightKg: 0.7, title: 0.8, price: 0.75 },
        ),
      ],
    });

    const outcome = await pipeline.resolve(url, 'corr-2');

    expect(outcome.status).toBe('RESOLVED');
    expect(outcome.strategiesTried).toEqual(['api', 'vision']);
    expect(outcome.product!.weightKg).toBe(0.4); // gap filled by the vision tier

    // The authoritative API price wins over the model's reading of it despite running first.
    // A later, more expensive tier does not mean a more trustworthy answer.
    expect(outcome.product!.price.amount).toBe(89_900);
    expect(outcome.product!.title).toBe('AirPods');
    expect(outcome.product!.provenance.price?.tier).toBe('api');
    expect(outcome.product!.provenance.weightKg?.tier).toBe('vision');
  });

  it('flags for review when a required field stays below the floor', async () => {
    const pipeline = new ResolutionPipeline({
      registry: marketplaceRegistry,
      rateLimiter: limiter,
      strategies: [
        strategyStub(
          'api',
          'api',
          1,
          {
            title: 'Mystery item',
            price: Money.fromMajor('100.00', 'AED'),
            available: true,
            category: 'general',
            weightKg: 2,
          },
          { title: 0.99, price: 0.99, available: 0.9, category: 0.9, weightKg: 0.2 },
        ),
      ],
    });

    const outcome = await pipeline.resolve(url, 'corr-3');

    expect(outcome.status).toBe('NEEDS_REVIEW');
    expect(outcome.missingFields).toContain('weightKg');
    expect(outcome.product).toBeDefined(); // still shown to an operator to complete
  });

  it('keeps going when a tier throws', async () => {
    const pipeline = new ResolutionPipeline({
      registry: marketplaceRegistry,
      rateLimiter: limiter,
      strategies: [
        {
          name: 'broken-api',
          tier: 'api',
          costUnits: 1,
          canHandle: () => true,
          async resolve(): Promise<StrategyResult> {
            throw new Error('SP-API 503');
          },
        },
        strategyStub(
          'structured',
          'structured',
          3,
          {
            title: 'Recovered',
            price: Money.fromMajor('50.00', 'AED'),
            available: true,
            weightKg: 1,
            category: 'general',
          },
          { title: 0.9, price: 0.85, available: 0.8, weightKg: 0.6, category: 0.7 },
        ),
      ],
    });

    const outcome = await pipeline.resolve(url, 'corr-4');
    expect(outcome.status).toBe('RESOLVED');
    expect(outcome.notes.some((n) => n.includes('broken-api failed'))).toBe(true);
  });

  it('refuses a URL outside the enabled marketplaces', async () => {
    const pipeline = new ResolutionPipeline({
      registry: new MarketplaceRegistry(),
      rateLimiter: limiter,
      strategies: [],
    });
    expect((await pipeline.resolve('https://ebay.com/itm/1', 'corr-5')).status).toBe('FAILED');
  });

  it('respects the cost budget', async () => {
    let expensiveCalls = 0;
    const pipeline = new ResolutionPipeline({
      registry: marketplaceRegistry,
      rateLimiter: limiter,
      costBudget: 5,
      strategies: [
        strategyStub('cheap', 'api', 1, { title: 'Partial' }, { title: 0.9 }),
        strategyStub('expensive', 'vision', 20, {}, {}, () => {
          expensiveCalls++;
        }),
      ],
    });

    const outcome = await pipeline.resolve(url, 'corr-6');
    expect(expensiveCalls).toBe(0);
    expect(outcome.notes.some((n) => n.includes('cost budget'))).toBe(true);
  });

  it('raises the risk factor as weight confidence falls', async () => {
    const build = async (weightConfidence: number) => {
      const pipeline = new ResolutionPipeline({
        registry: marketplaceRegistry,
        rateLimiter: limiter,
        confidenceFloor: 0.1,
        strategies: [
          strategyStub(
            'api',
            'api',
            1,
            {
              title: 'x',
              price: Money.fromMajor('10.00', 'AED'),
              available: true,
              weightKg: 1,
              category: 'general',
            },
            {
              title: 0.99,
              price: 0.99,
              available: 0.99,
              weightKg: weightConfidence,
              category: 0.99,
            },
          ),
        ],
      });
      return resolutionRiskFactor((await pipeline.resolve(url, 'c')).product!);
    };

    // Freight is charged per kilo, so a soft weight is the costliest kind of uncertainty.
    expect(await build(0.2)).toBeGreaterThan(await build(0.95));
  });
});

describe('JSON-LD extraction', () => {
  it('finds a Product node inside a @graph wrapper', () => {
    const html = `<html><script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[
        {"@type":"BreadcrumbList"},
        {"@type":"Product","name":"Test Item","offers":{"price":"12.50","priceCurrency":"AED"}}
      ]}</script></html>`;
    expect(extractJsonLdProduct(html)?.name).toBe('Test Item');
  });

  it('skips malformed blocks rather than failing the tier', () => {
    const html = `
      <script type="application/ld+json">{ this is not json }</script>
      <script type="application/ld+json">{"@type":"Product","name":"Good"}</script>`;
    expect(extractJsonLdProduct(html)?.name).toBe('Good');
  });

  it('normalises weight units to kilograms', () => {
    expect(extractWeightKg({ weight: { value: 500, unitCode: 'GRM' } })).toBeCloseTo(0.5);
    expect(extractWeightKg({ weight: { value: 2, unitCode: 'LBR' } })).toBeCloseTo(0.907, 2);
    expect(extractWeightKg({ weight: { value: 1.5, unitCode: 'KGM' } })).toBe(1.5);
    // An unrecognised unit must yield nothing rather than a confidently wrong number.
    expect(extractWeightKg({ weight: { value: 5, unitCode: 'CUBITS' } })).toBeUndefined();
  });
});

describe('ProcurementEngine', () => {
  const makeStore = (price: Money, available = true): StorePort => ({
    supports: () => true,
    resolve: async () => {
      throw new Error('not used in these tests');
    },
    checkOffer: async () => ({ price, available }),
  });

  const request = (max: Money, qty = 1) => ({
    procurementOrderId: 'po-1',
    marketplaceId: 'amazon.ae' as const,
    externalProductId: 'B0CHWRXH8B',
    quantity: qty,
    expectedPrice: Money.fromMajor('899.00', 'AED'),
    maxPrice: max,
    idempotencyKey: 'idem-1',
  });

  it('hands to an operator when the live price is within the ceiling', async () => {
    const engine = new ProcurementEngine({
      mode: 'assisted',
      store: makeStore(Money.fromMajor('899.00', 'AED')),
      registry: marketplaceRegistry,
    });

    const result = await engine.purchase(request(Money.fromMajor('917.00', 'AED')));
    expect(result.reason).toBe('REQUIRES_OPERATOR');
    expect(result.operatorTask?.maxAuthorised.amount).toBe(91_700);
  });

  it('blocks rather than buying when the live price breaches the ceiling', async () => {
    const engine = new ProcurementEngine({
      mode: 'assisted',
      store: makeStore(Money.fromMajor('1060.00', 'AED')), // seller raised the price
      registry: marketplaceRegistry,
    });

    const result = await engine.purchase(request(Money.fromMajor('917.00', 'AED')));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('PRICE_CHANGED');
    expect(result.operatorTask).toBeUndefined(); // no human is asked to approve a breach
  });

  it('checks the ceiling against the line total, not the unit price', async () => {
    const engine = new ProcurementEngine({
      mode: 'assisted',
      store: makeStore(Money.fromMajor('500.00', 'AED')),
      registry: marketplaceRegistry,
    });

    // 3 x 500 = 1500 > 917. A per-unit check would have wrongly allowed this.
    expect((await engine.purchase(request(Money.fromMajor('917.00', 'AED'), 3))).reason).toBe(
      'PRICE_CHANGED',
    );
  });

  it('reports out of stock without consulting price', async () => {
    const engine = new ProcurementEngine({
      mode: 'assisted',
      store: makeStore(Money.fromMajor('899.00', 'AED'), false),
      registry: marketplaceRegistry,
    });
    expect((await engine.purchase(request(Money.fromMajor('917.00', 'AED')))).reason).toBe(
      'OUT_OF_STOCK',
    );
  });

  it('rejects an operator confirmation above the authorised maximum', () => {
    expect(() =>
      confirmOperatorPurchase({
        maxAuthorised: Money.fromMajor('917.00', 'AED'),
        actualPaid: Money.fromMajor('1000.00', 'AED'),
        externalOrderId: 'AMZ-1',
      }),
    ).toThrowError(/exceeds/i);
  });

  it('accepts an operator confirmation within the maximum', () => {
    const r = confirmOperatorPurchase({
      maxAuthorised: Money.fromMajor('917.00', 'AED'),
      actualPaid: Money.fromMajor('905.00', 'AED'),
      externalOrderId: 'AMZ-1',
    });
    expect(r.ok).toBe(true);
  });
});
