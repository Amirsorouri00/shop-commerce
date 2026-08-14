import { Money } from '@xb/core';
import type { OrderDto, OrderState } from '@xb/contracts';
import type { ResolvedProduct } from '@xb/commerce';
import { OrderRepository, QuoteRepository, type Database } from '@xb/db';
import { alertFor, buildCustomerTimeline } from './order-state-machine.ts';

/**
 * The order projection.
 *
 * It lives in the domain layer rather than inside a feature module because two audiences read
 * the same order through different doors — a customer through `/v1/orders/:id`, an operator
 * through `/v1/admin/orders/:id` — and they must see the same aggregate. Putting the
 * projection in one of those modules would mean the other imports it across a boundary, or
 * worse, grows a second copy that drifts.
 *
 * Authorisation is deliberately *not* here. Who may read an order is a different question
 * from what an order looks like, and answering both in one function is how a projection ends
 * up quietly deciding access control.
 */

/**
 * Restore `Money` after a JSONB round-trip.
 *
 * Every read path that deserialises a snapshot must go through here. That is the cost of
 * putting a value object behind a JSON column, and it is worth paying: the alternative is
 * passing raw numbers around and losing the currency-mismatch protection entirely.
 */
export function hydrateProduct(raw: unknown): ResolvedProduct {
  const p = raw as ResolvedProduct & { price: unknown };
  return {
    ...p,
    price: p.price instanceof Money ? p.price : Money.from(p.price as never),
  };
}

export function toProductDto(p: ResolvedProduct) {
  return {
    marketplace: p.marketplace,
    externalProductId: p.externalProductId,
    canonicalUrl: p.canonicalUrl,
    title: p.title,
    seller: p.seller,
    brand: p.brand ?? null,
    variant: p.variant ?? null,
    imageUrl: p.imageUrl ?? null,
    price: p.price instanceof Money ? p.price.toJSON() : (p.price as never),
    available: p.available,
    weightKg: p.weightKg,
    category: p.category,
    route: p.route,
    provenance: p.provenance as never,
  };
}

/** Build the full order view. `db` may be a transaction, so it is passed rather than injected. */
export async function buildOrderDto(orderId: string, db: Database): Promise<OrderDto> {
  const orderRepo = new OrderRepository(db);
  const order = await orderRepo.requireById(orderId);
  const quote = await new QuoteRepository(db).requireById(order.quoteId);
  const events = await orderRepo.timeline(orderId);

  const stateTimestamps: Partial<Record<OrderState, string>> = {};
  for (const e of events) stateTimestamps[e.toState as OrderState] = e.at.toISOString();

  const snapshot = hydrateProduct(quote.productSnapshot);
  const state = order.state as OrderState;

  return {
    id: order.id,
    publicRef: order.publicRef,
    state,
    version: order.version,
    quote: {
      id: quote.id,
      productSnapshot: toProductDto(snapshot),
      quantity: quote.quantity,
      fxRate: Number(quote.fxRateMicro) / 1_000_000,
      breakdown: quote.breakdown as never,
      finalPrice: { amount: Number(quote.finalAmountMinor), currency: quote.finalCurrency },
      maxProcurementPrice: {
        amount: Number(quote.maxProcurementMinor),
        currency: quote.maxProcurementCurrency,
      },
      overheadRatio: Number(quote.overheadRatio),
      riskFactor: Number(quote.riskFactor),
      viable: quote.viable,
      createdAt: quote.createdAt.toISOString(),
      expiresAt: quote.expiresAt.toISOString(),
    },
    timeline: buildCustomerTimeline({ state, stateTimestamps }),
    alert: alertFor(state),
    createdAt: order.createdAt.toISOString(),
  };
}
