import { describe, it, expect } from 'vitest';
import { Money, UpstreamError } from '@xb/core';
import { MemorySandboxSessionStore, buildContext, seededRandom } from './session.ts';
import { createSandboxAdapters } from './adapters.ts';
import { listScenarios, SCENARIOS, type ScenarioId } from './scenario.ts';

const AIRPODS_URL = 'https://www.amazon.ae/dp/B0CHWRXH8B';
const HOUR = 3_600_000;

function harness(scenarioId: ScenarioId, seed = 42) {
  const store = new MemorySandboxSessionStore();
  const session = store.create(scenarioId, seed);
  const ctx = () => buildContext(session);
  return { store, session, ctx, adapters: createSandboxAdapters(ctx) };
}

describe('scenario catalogue', () => {
  it('covers every stage of the journey, not just the happy path', () => {
    const stages = new Set(listScenarios().map((s) => s.stage));
    expect(stages).toEqual(
      new Set(['resolution', 'quote', 'checkout', 'procurement', 'fulfilment']),
    );
  });

  it('gives every scenario bilingual copy for the demo UI', () => {
    for (const s of listScenarios()) {
      expect(s.title.en.length).toBeGreaterThan(0);
      expect(s.title.fa.length).toBeGreaterThan(0);
      expect(s.description.fa.length).toBeGreaterThan(0);
    }
  });
});

describe('determinism', () => {
  it('replays identically for the same seed', () => {
    const a = seededRandom(1234);
    const b = seededRandom(1234);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it('produces the same FX rate twice for one seed, and a different one for another', async () => {
    const one = harness('HAPPY_PATH', 7);
    const two = harness('HAPPY_PATH', 7);
    const three = harness('HAPPY_PATH', 8);

    const r1 = await one.adapters.fx.getRate('AED', 'IRR');
    const r2 = await two.adapters.fx.getRate('AED', 'IRR');
    const r3 = await three.adapters.fx.getRate('AED', 'IRR');

    expect(r1.rate).toBe(r2.rate); // a demo replays exactly
    expect(r3.rate).not.toBe(r1.rate); // a different seed explores a different path
  });
});

describe('resolution scenarios', () => {
  it('resolves from the API tier on the happy path', async () => {
    const { adapters } = harness('HAPPY_PATH');
    const outcome = await adapters.store.resolve(AIRPODS_URL, 'corr');

    expect(outcome.status).toBe('RESOLVED');
    expect(outcome.product!.title).toContain('AirPods');
    expect(outcome.strategiesTried).toEqual(['sandbox-api']);
    expect(outcome.product!.price.currency).toBe('AED');
  });

  it('shows the escalation ladder on the vision-fallback scenario', async () => {
    const { adapters } = harness('SLOW_RESOLUTION');
    const outcome = await adapters.store.resolve(AIRPODS_URL, 'corr');

    expect(outcome.strategiesTried).toEqual(['sandbox-api', 'sandbox-vision']);
    expect(outcome.totalCostUnits).toBeGreaterThan(1); // the expensive tier was needed
    expect(outcome.product!.provenance.weightKg!.confidence).toBeLessThan(0.6);
  });

  it('routes a low-confidence weight to operator review', async () => {
    const { adapters } = harness('RESOLUTION_NEEDS_REVIEW');
    const outcome = await adapters.store.resolve(AIRPODS_URL, 'corr');

    expect(outcome.status).toBe('NEEDS_REVIEW');
    expect(outcome.missingFields).toContain('weightKg');
  });

  it('reports an unavailable product without failing resolution', async () => {
    const { adapters } = harness('UNSUPPORTED_PRODUCT');
    const outcome = await adapters.store.resolve(AIRPODS_URL, 'corr');

    expect(outcome.status).toBe('RESOLVED');
    expect(outcome.product!.available).toBe(false);
  });

  it('refuses a URL outside the enabled marketplaces', async () => {
    const { adapters } = harness('HAPPY_PATH');
    expect(adapters.store.supports('https://ebay.com/itm/1')).toBe(false);
    expect((await adapters.store.resolve('https://ebay.com/itm/1', 'c')).status).toBe('FAILED');
  });
});

describe('FX scenarios', () => {
  it('refuses to quote when every provider is down, rather than guessing', async () => {
    const { adapters } = harness('FX_PROVIDER_DOWN');
    await expect(adapters.fx.getRate('AED', 'IRR')).rejects.toBeInstanceOf(UpstreamError);
  });

  it('serves an identity rate without consulting a provider', async () => {
    const { adapters } = harness('FX_PROVIDER_DOWN');
    // Same-currency conversion is arithmetic, not a lookup, so it survives an outage.
    const q = await adapters.fx.getRate('IRR', 'IRR');
    expect(q.rate).toBe(1);
  });
});

describe('checkout scenarios', () => {
  const intentInput = {
    orderId: 'ord-1',
    amount: Money.of(134_950_000, 'IRR'),
    idempotencyKey: 'idem-1',
    returnUrl: 'https://app.example.ir/checkout/return',
  };

  it('settles on the happy path', async () => {
    const { adapters } = harness('HAPPY_PATH');
    const intent = await adapters.payment.createIntent(intentInput);

    // The customer is redirected off-site to a gateway page, exactly as a real IRR gateway
    // would do — settlement then comes back server-side rather than through the redirect.
    expect(intent.redirectUrl).toContain('/v1/sandbox/gateway');
    expect(intent.redirectUrl).toContain(encodeURIComponent(intentInput.returnUrl));
    expect((await adapters.payment.verify(intent.providerRef)).settled).toBe(true);
  });

  it('declines with a reason the UI can show', async () => {
    const { adapters } = harness('PAYMENT_DECLINED');
    const intent = await adapters.payment.createIntent(intentInput);
    const verification = await adapters.payment.verify(intent.providerRef);

    expect(verification.settled).toBe(false);
    expect(verification.failureReason).toBe('INSUFFICIENT_FUNDS');
  });

  it('times out first and settles second — the case idempotency exists for', async () => {
    const { adapters } = harness('PAYMENT_GATEWAY_TIMEOUT');
    const intent = await adapters.payment.createIntent(intentInput);

    await expect(adapters.payment.verify(intent.providerRef)).rejects.toBeInstanceOf(UpstreamError);
    // The webhook arrives later and settles the same reference.
    expect((await adapters.payment.verify(intent.providerRef)).settled).toBe(true);
  });

  it('still requires a webhook signature in sandbox', async () => {
    const { adapters } = harness('HAPPY_PATH');
    expect(adapters.payment.verifyWebhook('{}', 'wrong')).toBe(false);
    expect(adapters.payment.verifyWebhook('{}', 'sandbox-signature')).toBe(true);
  });

  it('counts payment attempts so a retry demo is visible', async () => {
    const { adapters, session } = harness('PAYMENT_DECLINED');
    await adapters.payment.createIntent(intentInput);
    await adapters.payment.createIntent(intentInput);
    expect(session.counters['paymentAttempts']).toBe(2);
  });
});

describe('procurement scenarios', () => {
  const req = {
    procurementOrderId: 'po-1',
    marketplaceId: 'amazon.ae' as const,
    externalProductId: 'B0CHWRXH8B',
    quantity: 1,
    expectedPrice: Money.fromMajor('899.00', 'AED'),
    maxPrice: Money.fromMajor('917.00', 'AED'), // the 2% tolerance from the quote
    idempotencyKey: 'idem-1',
  };

  it('holds the original price at checkout and moves it before purchase', async () => {
    const { adapters } = harness('PRICE_CHANGED_BREACH');

    // First check is checkout revalidation: the price has not moved yet, so the order is
    // allowed through and the customer pays.
    const atCheckout = await adapters.store.checkOffer('amazon.ae', 'B0CHWRXH8B');
    expect(atCheckout.price.amount).toBe(89_900);

    // Second check is procurement, immediately before buying: now the seller has moved it,
    // which is the case the max-procurement guard exists to catch.
    const atPurchase = await adapters.store.checkOffer('amazon.ae', 'B0CHWRXH8B');
    expect(atPurchase.price.greaterThan(atCheckout.price)).toBe(true);
  });

  it('reports stock at checkout and sold-out at purchase', async () => {
    const { adapters } = harness('OUT_OF_STOCK_AT_PROCUREMENT');

    expect((await adapters.store.checkOffer('amazon.ae', 'B0CHWRXH8B')).available).toBe(true);
    expect((await adapters.store.checkOffer('amazon.ae', 'B0CHWRXH8B')).available).toBe(false);
  });

  it('passes the guard on a small price rise', async () => {
    const { adapters } = harness('PRICE_DRIFT_WITHIN_TOLERANCE');
    const result = await adapters.procurement.purchase(req);

    // 899 * 1.015 = 912.485 <= 917, so the order proceeds to an operator.
    expect(result.reason).toBe('REQUIRES_OPERATOR');
    expect(result.operatorTask).toBeDefined();
  });

  it('breaches the guard on a large price rise and never buys', async () => {
    const { adapters } = harness('PRICE_CHANGED_BREACH');
    const result = await adapters.procurement.purchase(req);

    // 899 * 1.18 = 1060.82 > 917.
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('PRICE_CHANGED');
    expect(result.operatorTask).toBeUndefined();
    expect(result.actualPrice.greaterThan(req.maxPrice)).toBe(true);
  });

  it('reports sold-out after payment', async () => {
    const { adapters } = harness('OUT_OF_STOCK_AT_PROCUREMENT');
    expect((await adapters.procurement.purchase(req)).reason).toBe('OUT_OF_STOCK');
  });
});

describe('fulfilment: the virtual clock', () => {
  it('reveals nothing before purchase', async () => {
    const { adapters } = harness('HAPPY_PATH');
    expect(await adapters.carrier.track('SBX-1')).toEqual([]);
  });

  it('reveals legs as the demo fast-forwards, without any real waiting', async () => {
    const { adapters, store, session } = harness('HAPPY_PATH');
    const { shipmentId } = await adapters.carrier.createShipment({
      orderId: 'ord-1',
      weightKg: 0.35,
      origin: 'Dubai',
      destination: 'Tehran',
    });

    const legCount = async () => (await adapters.carrier.track(shipmentId))[0]!.events.length;

    expect(await legCount()).toBe(0);

    store.advance(session.id, 7 * HOUR); // seller dispatches at +6h
    expect(await legCount()).toBe(1);

    store.advance(session.id, 24 * HOUR); // +31h: local transit, warehouse
    expect(await legCount()).toBe(3);

    store.advance(session.id, 96 * HOUR); // +127h: everything through delivery
    const events = (await adapters.carrier.track(shipmentId))[0]!.events;
    expect(events.at(-1)!.status).toBe('DELIVERED');
    expect(events).toHaveLength(7);
  });

  it('keeps raw carrier wording out of the customer-facing status', async () => {
    const { adapters, store, session } = harness('HAPPY_PATH');
    const { shipmentId } = await adapters.carrier.createShipment({
      orderId: 'ord-1',
      weightKg: 1,
      origin: 'Dubai',
      destination: 'Tehran',
    });
    store.advance(session.id, 7 * HOUR);

    const event = (await adapters.carrier.track(shipmentId))[0]!.events[0]!;
    expect(event.status).toBe('DISPATCHED_BY_SELLER'); // normalised
    expect(event.rawStatus).toBe('SBX_DISPATCHED_BY_SELLER'); // kept for audit only
    expect(event.location!.fa).toBeTruthy();
  });

  it('raises a customs exception on the customs-hold scenario', async () => {
    const { adapters, store, session } = harness('CUSTOMS_HOLD');
    const { shipmentId } = await adapters.carrier.createShipment({
      orderId: 'ord-1',
      weightKg: 1,
      origin: 'Dubai',
      destination: 'Tehran',
    });
    store.advance(session.id, 80 * HOUR);

    const statuses = (await adapters.carrier.track(shipmentId))[0]!.events.map((e) => e.status);
    expect(statuses).toContain('CUSTOMS_EXCEPTION');
  });

  it('goes quiet mid-transit on the stalled scenario, so stall detection can fire', async () => {
    const { adapters, store, session } = harness('SHIPMENT_STALLED');
    const { shipmentId } = await adapters.carrier.createShipment({
      orderId: 'ord-1',
      weightKg: 1,
      origin: 'Dubai',
      destination: 'Tehran',
    });

    store.advance(session.id, 200 * HOUR); // far past the full schedule
    const events = (await adapters.carrier.track(shipmentId))[0]!.events;

    expect(events).toHaveLength(4); // stops after leg index 3
    expect(events.at(-1)!.status).toBe('INTERNATIONAL_TRANSIT');
    expect(events.map((e) => e.status)).not.toContain('DELIVERED');
  });
});

describe('session isolation and control', () => {
  it('keeps two concurrent demos independent', async () => {
    const store = new MemorySandboxSessionStore();
    const a = store.create('HAPPY_PATH', 1);
    const b = store.create('HAPPY_PATH', 1);

    store.advance(a.id, 50 * HOUR);

    expect(store.get(a.id)!.virtualOffsetMs).toBe(50 * HOUR);
    expect(store.get(b.id)!.virtualOffsetMs).toBe(0);
  });

  it('never runs the clock backwards', () => {
    const store = new MemorySandboxSessionStore();
    const s = store.create('HAPPY_PATH');
    store.advance(s.id, 10 * HOUR);
    store.advance(s.id, -100 * HOUR);
    expect(store.get(s.id)!.virtualOffsetMs).toBe(10 * HOUR);
  });

  it('resets a session back to the start for a re-run', async () => {
    const { adapters, store, session } = harness('HAPPY_PATH');
    await adapters.carrier.createShipment({
      orderId: 'o',
      weightKg: 1,
      origin: 'a',
      destination: 'b',
    });
    store.advance(session.id, 100 * HOUR);

    store.reset(session.id);
    const after = store.get(session.id)!;
    expect(after.virtualOffsetMs).toBe(0);
    expect(after.purchasedAtVirtual).toBeUndefined();
    expect(after.log).toHaveLength(0);
  });

  it('writes a bilingual activity log the demo UI can render', async () => {
    const { adapters, session } = harness('PRICE_CHANGED_BREACH');
    await adapters.store.resolve(AIRPODS_URL, 'corr');
    await adapters.procurement.purchase({
      procurementOrderId: 'po-1',
      marketplaceId: 'amazon.ae',
      externalProductId: 'B0CHWRXH8B',
      quantity: 1,
      expectedPrice: Money.fromMajor('899.00', 'AED'),
      maxPrice: Money.fromMajor('917.00', 'AED'),
      idempotencyKey: 'i',
    });

    expect(session.log.length).toBeGreaterThanOrEqual(2);
    for (const entry of session.log) {
      expect(entry.message.en.length).toBeGreaterThan(0);
      expect(entry.message.fa.length).toBeGreaterThan(0);
    }
    expect(session.log.some((e) => e.stage === 'procurement')).toBe(true);
  });
});

describe('every scenario is runnable end to end', () => {
  it.each(Object.keys(SCENARIOS) as ScenarioId[])('%s completes without throwing', async (id) => {
    const { adapters, store, session } = harness(id);

    // Resolution — FX_PROVIDER_DOWN throws only at the FX step, not here.
    const outcome = await adapters.store.resolve(AIRPODS_URL, 'corr');
    expect(['RESOLVED', 'NEEDS_REVIEW', 'FAILED']).toContain(outcome.status);

    // FX is the one step a scenario may legitimately refuse.
    if (SCENARIOS[id].fxAvailable) {
      expect((await adapters.fx.getRate('AED', 'IRR')).rate).toBeGreaterThan(0);
    }

    await adapters.carrier.createShipment({
      orderId: 'o',
      weightKg: 1,
      origin: 'Dubai',
      destination: 'Tehran',
    });
    store.advance(session.id, 130 * HOUR);
    const legs = await adapters.carrier.track('SBX-1');
    expect(Array.isArray(legs)).toBe(true);
  });
});
