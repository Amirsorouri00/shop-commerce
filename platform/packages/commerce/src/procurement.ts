import { Money, DomainErrors } from '@xb/core';
import { logger, metrics } from '@xb/observability';
import type { MarketplaceRegistry } from './marketplace.ts';
import type {
  ProcurementMode,
  ProcurementPort,
  ProcurementRequest,
  ProcurementResult,
  StorePort,
} from './types.ts';

/**
 * The procurement engine.
 *
 * Buying abroad is the step where money actually leaves, so it is deliberately the most
 * conservative part of the system. Three properties are non-negotiable:
 *
 *   1. **The guard is checked against a live offer, immediately before purchase.** The price
 *      in the quote is minutes or hours old. Buying against a stale price is how an order
 *      goes negative-margin without anyone noticing.
 *
 *   2. **Exceeding the guard branches the order — it never buys anyway.** No "close enough"
 *      tolerance beyond the one already baked into `maxPrice` at quote time.
 *
 *   3. **Purchase is never retried automatically.** A timeout on a purchase request is
 *      ambiguous: the order may or may not have been placed. Retrying resolves that
 *      ambiguity in the worst possible direction. Ambiguous purchases go to an operator.
 *
 * The three modes are the roadmap, not three different code paths for the domain: the order
 * flow calls `purchase()` and handles the same result shape regardless of which is live.
 */

export interface ProcurementEngineOptions {
  readonly mode: ProcurementMode;
  readonly store: StorePort;
  readonly registry: MarketplaceRegistry;
  /** Only used in `api` mode, where a marketplace actually permits programmatic purchase. */
  readonly apiExecutor?: ApiPurchaseExecutor;
  /** Used in `agentic` mode — a supervised browser agent that drives checkout. */
  readonly agent?: AgenticPurchaseExecutor;
}

export interface ApiPurchaseExecutor {
  placeOrder(req: ProcurementRequest): Promise<{ externalOrderId: string; chargedPrice: Money }>;
  getOrderStatus(
    externalOrderId: string,
  ): Promise<{ status: string; shippedAt?: string; trackingNumber?: string }>;
}

export interface AgenticPurchaseExecutor {
  /** Drives a real checkout. Returns `requiresOperator` when it hits something it won't decide. */
  attemptPurchase(req: ProcurementRequest): Promise<
    | { outcome: 'placed'; externalOrderId: string; chargedPrice: Money }
    | { outcome: 'requiresOperator'; checkoutUrl: string; reason: string }
    | { outcome: 'failed'; reason: string }
  >;
}

export class ProcurementEngine implements ProcurementPort {
  readonly mode: ProcurementMode;

  constructor(private readonly options: ProcurementEngineOptions) {
    this.mode = options.mode;
  }

  async purchase(req: ProcurementRequest): Promise<ProcurementResult> {
    const marketplace = this.options.registry.get(req.marketplaceId);
    if (!marketplace) {
      return this.failure(req, 'PROCUREMENT_FAILED', req.expectedPrice);
    }

    // ── the guard, checked against a live offer ──
    const offer = await this.options.store.checkOffer(req.marketplaceId, req.externalProductId);

    if (!offer.available) {
      metrics.counter('commerce.procurement.blocked', 1, { reason: 'OUT_OF_STOCK' });
      return this.failure(req, 'OUT_OF_STOCK', offer.price);
    }

    const lineTotal = offer.price.multiply(req.quantity);

    if (lineTotal.greaterThan(req.maxPrice)) {
      logger.warn(
        {
          procurementOrderId: req.procurementOrderId,
          actual: lineTotal.amount,
          max: req.maxPrice.amount,
          currency: lineTotal.currency,
        },
        'procurement guard breached; branching order instead of purchasing',
      );
      metrics.counter('commerce.procurement.blocked', 1, { reason: 'PRICE_CHANGED' });
      return this.failure(req, 'PRICE_CHANGED', lineTotal);
    }

    // ── within the guard: execute per mode ──
    switch (this.mode) {
      case 'api':
        return this.purchaseViaApi(req, lineTotal);
      case 'agentic':
        return this.purchaseViaAgent(req, lineTotal, marketplace.canonicalUrl(req.externalProductId));
      case 'assisted':
      default:
        return this.handToOperator(req, lineTotal, marketplace.canonicalUrl(req.externalProductId));
    }
  }

  /**
   * Programmatic purchase. Available only where a marketplace genuinely permits it — which
   * today is nowhere in our corridor, hence the capability check upstream.
   */
  private async purchaseViaApi(req: ProcurementRequest, expected: Money): Promise<ProcurementResult> {
    if (!this.options.apiExecutor) {
      return this.failure(req, 'REQUIRES_OPERATOR', expected);
    }

    try {
      const placed = await this.options.apiExecutor.placeOrder(req);

      // Re-verify what was actually charged. An executor that charged above the ceiling is a
      // bug we want surfaced loudly, not absorbed.
      if (placed.chargedPrice.greaterThan(req.maxPrice)) {
        logger.error(
          {
            procurementOrderId: req.procurementOrderId,
            charged: placed.chargedPrice.amount,
            max: req.maxPrice.amount,
          },
          'executor charged above the authorised maximum',
        );
      }

      return {
        ok: true,
        externalOrderId: placed.externalOrderId,
        actualPrice: placed.chargedPrice,
        reason: undefined,
        mode: this.mode,
        operatorTask: undefined,
      };
    } catch (e) {
      // Never retried here — see the class comment. An ambiguous purchase goes to a human.
      logger.error({ procurementOrderId: req.procurementOrderId, err: e }, 'api purchase failed');
      return this.failure(req, 'REQUIRES_OPERATOR', expected);
    }
  }

  private async purchaseViaAgent(
    req: ProcurementRequest,
    expected: Money,
    checkoutUrl: string,
  ): Promise<ProcurementResult> {
    if (!this.options.agent) return this.handToOperator(req, expected, checkoutUrl);

    const result = await this.options.agent.attemptPurchase(req);

    if (result.outcome === 'placed') {
      return {
        ok: true,
        externalOrderId: result.externalOrderId,
        actualPrice: result.chargedPrice,
        reason: undefined,
        mode: this.mode,
        operatorTask: undefined,
      };
    }

    if (result.outcome === 'requiresOperator') {
      return this.handToOperator(req, expected, result.checkoutUrl, result.reason);
    }

    return this.failure(req, 'PROCUREMENT_FAILED', expected);
  }

  /**
   * Assisted mode — the MVP path.
   *
   * The machine has already done everything that can be done safely: matched the product,
   * confirmed availability, and verified the live price against the authorised ceiling. What
   * remains is the irreducible human step of authorising a real spend.
   */
  private handToOperator(
    req: ProcurementRequest,
    expected: Money,
    checkoutUrl: string,
    reason?: string,
  ): ProcurementResult {
    metrics.counter('commerce.procurement.operator_task', 1, { marketplace: req.marketplaceId });

    return {
      ok: false,
      externalOrderId: undefined,
      actualPrice: expected,
      reason: 'REQUIRES_OPERATOR',
      mode: this.mode,
      operatorTask: {
        procurementOrderId: req.procurementOrderId,
        checkoutUrl,
        expectedPrice: expected,
        maxAuthorised: req.maxPrice,
        instructions: {
          en: reason
            ? `Complete this purchase manually. Agent stopped: ${reason}. Do not exceed the authorised maximum.`
            : `Purchase ${req.quantity} x this item. Do not exceed the authorised maximum.`,
          fa: reason
            ? `این خرید را به‌صورت دستی تکمیل کنید. عامل خودکار متوقف شد. از حداکثر مبلغ مجاز فراتر نروید.`
            : `تعداد ${req.quantity} عدد از این کالا را خریداری کنید. از حداکثر مبلغ مجاز فراتر نروید.`,
        },
      },
    };
  }

  private failure(
    req: ProcurementRequest,
    reason: ProcurementResult['reason'],
    actualPrice: Money,
  ): ProcurementResult {
    return {
      ok: false,
      externalOrderId: undefined,
      actualPrice,
      reason,
      mode: this.mode,
      operatorTask: undefined,
    };
  }

  async checkOrderStatus(
    _marketplaceId: ProcurementRequest['marketplaceId'],
    externalOrderId: string,
  ): Promise<{ status: string; shippedAt?: string; trackingNumber?: string }> {
    if (this.options.apiExecutor) {
      return this.options.apiExecutor.getOrderStatus(externalOrderId);
    }
    // Assisted mode: status arrives from operator input and forwarder scans, not the marketplace.
    return { status: 'UNKNOWN' };
  }
}

/**
 * Confirm an operator-completed purchase.
 *
 * Re-checks the ceiling one final time. An operator who typed a price above the authorised
 * maximum is stopped here — the guard is a system property, not an operator courtesy.
 */
export function confirmOperatorPurchase(input: {
  readonly maxAuthorised: Money;
  readonly actualPaid: Money;
  readonly externalOrderId: string;
}): ProcurementResult {
  if (input.actualPaid.greaterThan(input.maxAuthorised)) {
    throw DomainErrors.procurementGuardBreached(
      input.actualPaid.amount,
      input.maxAuthorised.amount,
      input.actualPaid.currency,
    );
  }

  return {
    ok: true,
    externalOrderId: input.externalOrderId,
    actualPrice: input.actualPaid,
    reason: undefined,
    mode: 'assisted',
    operatorTask: undefined,
  };
}
