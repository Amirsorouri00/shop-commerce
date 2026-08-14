import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Injectable,
  Module,
  Param,
  Post,
  Query,
  Res,
  HttpCode,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import {
  DomainErrors,
  Money,
  NotFoundError,
  publicRef,
  uuidv7,
  type CustomsPort,
  type FxPort,
  type PaymentPort,
} from '@xb/core';
import {
  createOrderRequest,
  createProductRequestBody,
  createQuoteRequest,
  type OrderDto,
  type OrderState,
  type ProductRequestDto,
  type QuoteDto,
} from '@xb/contracts';
import type { Env } from '@xb/contracts';
import { correlationId, logger, metrics, METRIC } from '@xb/observability';
import { hashUrl } from '@xb/cache';
import type { StorePort, ResolvedProduct } from '@xb/commerce';
import {
  OrderRepository,
  ProductRequestRepository,
  QuoteRepository,
  PaymentRepository,
  LedgerRepository,
  UnitOfWork,
  orders as ordersTable,
  orderEvents,
  type Database,
} from '@xb/db';
import { Actor, Idempotent, Public, type AuthenticatedActor } from '../common/http.ts';
import { zodBody } from '../common/zod-pipe.ts';
import { QuoteEngine, marginAtRisk } from '../domain/quote-engine.ts';
import { alertFor, assertTransition, buildCustomerTimeline } from '../domain/order-state-machine.ts';
import { buildOrderDto, hydrateProduct, toProductDto } from '../domain/order-dto.ts';
import { CUSTOMS_PORT, DB, ENV, FX_PORT, PAYMENT_PORT, STORE_PORT, UNIT_OF_WORK } from '../tokens.ts';

/**
 * The customer-facing commerce flow: resolve a link, quote it, order it, pay for it.
 *
 * Every state change here goes through `UnitOfWork.run`, so the row update, its timeline
 * entry, its ledger posting and its outbox event share one transaction. That is the property
 * that makes the system recoverable: there is no window in which an order is paid but
 * unrecorded, or recorded but unannounced.
 */

@Injectable()
export class CatalogService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORE_PORT) private readonly store: StorePort,
  ) {}

  async createRequest(url: string, customerId: string | undefined): Promise<ProductRequestDto> {
    const repo = new ProductRequestRepository(this.db);

    const outcome = await this.store.resolve(url, correlationId());
    const product = outcome.product;

    const row = await repo.create({
      id: uuidv7(),
      customerId: customerId ?? null,
      sourceUrl: url,
      urlHash: hashUrl(url),
      marketplace: product?.marketplace ?? null,
      externalProductId: product?.externalProductId ?? null,
      status: outcome.status,
      failureReason: outcome.status === 'FAILED' ? (outcome.notes[0] ?? 'RESOLUTION_FAILED') : null,
      resolution: outcome as unknown as Record<string, unknown>,
    });

    metrics.counter('business.product_request', 1, { status: outcome.status });

    return {
      id: row.id,
      url,
      status: outcome.status as ProductRequestDto['status'],
      product: product ? toProductDto(product) : null,
      failureReason: row.failureReason,
      missingFields: [...outcome.missingFields],
    };
  }

  async getRequest(id: string): Promise<ProductRequestDto> {
    const row = await new ProductRequestRepository(this.db).requireById(id);
    const outcome = row.resolution as { product?: ResolvedProduct; missingFields?: string[] } | null;
    const product = outcome?.product ? hydrateProduct(outcome.product) : null;

    return {
      id: row.id,
      url: row.sourceUrl,
      status: row.status as ProductRequestDto['status'],
      product: product ? toProductDto(product) : null,
      failureReason: row.failureReason,
      missingFields: outcome?.missingFields ?? [],
    };
  }
}

@Injectable()
export class QuoteService {
  private readonly engine: QuoteEngine;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(FX_PORT) fx: FxPort,
    @Inject(CUSTOMS_PORT) customs: CustomsPort,
  ) {
    this.engine = new QuoteEngine(fx, customs);
  }

  get quoteEngine(): QuoteEngine {
    return this.engine;
  }

  async create(requestId: string, quantity: number, customerId: string | undefined): Promise<QuoteDto> {
    const request = await new ProductRequestRepository(this.db).requireById(requestId);
    const outcome = request.resolution as { product?: ResolvedProduct } | null;
    const product = outcome?.product ? hydrateProduct(outcome.product) : undefined;

    if (!product) throw DomainErrors.unsupportedMarketplace(request.sourceUrl);
    if (!product.available) throw DomainErrors.outOfStock();

    const computed = await this.engine.createQuote(product, quantity);

    const row = await new QuoteRepository(this.db).create({
      id: uuidv7(),
      productRequestId: request.id,
      customerId: customerId ?? null,
      productSnapshot: product as unknown as Record<string, unknown>,
      quantity,
      fxRateMicro: BigInt(Math.round(computed.fxRate * 1_000_000)),
      breakdown: serialiseBreakdown(computed.breakdown),
      finalAmountMinor: BigInt(computed.finalPrice.amount),
      finalCurrency: computed.finalPrice.currency,
      maxProcurementMinor: BigInt(computed.maxProcurementPrice.amount),
      maxProcurementCurrency: computed.maxProcurementPrice.currency,
      overheadRatio: computed.overheadRatio.toFixed(4),
      riskFactor: computed.riskFactor.toFixed(4),
      viable: computed.viable,
      expiresAt: new Date(computed.expiresAt),
    });

    metrics.counter(METRIC.quoteCreated, 1, { viable: String(computed.viable) });

    return toQuoteDto(row.id, computed);
  }

  /** Revalidate offer, availability and FX. Produces a new quote; never mutates the old one. */
  async refresh(quoteId: string, store: StorePort): Promise<QuoteDto> {
    const repo = new QuoteRepository(this.db);
    const existing = await repo.requireById(quoteId);
    const snapshot = hydrateProduct(existing.productSnapshot);

    const offer = await store.checkOffer(snapshot.marketplace, snapshot.externalProductId);
    if (!offer.available) throw DomainErrors.outOfStock();

    const refreshed: ResolvedProduct = { ...snapshot, price: offer.price, available: true };
    const computed = await this.engine.createQuote(refreshed, existing.quantity);

    const row = await repo.create({
      id: uuidv7(),
      productRequestId: existing.productRequestId,
      customerId: existing.customerId,
      productSnapshot: refreshed as unknown as Record<string, unknown>,
      quantity: existing.quantity,
      fxRateMicro: BigInt(Math.round(computed.fxRate * 1_000_000)),
      breakdown: serialiseBreakdown(computed.breakdown),
      finalAmountMinor: BigInt(computed.finalPrice.amount),
      finalCurrency: computed.finalPrice.currency,
      maxProcurementMinor: BigInt(computed.maxProcurementPrice.amount),
      maxProcurementCurrency: computed.maxProcurementPrice.currency,
      overheadRatio: computed.overheadRatio.toFixed(4),
      riskFactor: computed.riskFactor.toFixed(4),
      viable: computed.viable,
      expiresAt: new Date(computed.expiresAt),
    });

    await repo.supersede(existing.id, row.id);
    return toQuoteDto(row.id, computed);
  }
}

@Injectable()
export class OrderService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(STORE_PORT) private readonly store: StorePort,
    @Inject(PAYMENT_PORT) private readonly payment: PaymentPort,
    @Inject(ENV) private readonly env: Env,
    private readonly quotes: QuoteService,
  ) {}

  /**
   * Convert a quote into an order.
   *
   * Revalidates server-side regardless of whether the client already refreshed. A client
   * that revalidated, waited, and then submitted is exactly the case this catches, and it is
   * not a rare one — users leave checkout open.
   */
  async create(input: {
    quoteId: string;
    addressId: string;
    customerId: string;
    sandboxSessionId?: string;
  }): Promise<OrderDto> {
    const quoteRepo = new QuoteRepository(this.db);
    const quote = await quoteRepo.requireById(input.quoteId);

    this.quotes.quoteEngine.assertNotExpired(quote.expiresAt.toISOString());
    if (!quote.viable) throw DomainErrors.notViable();

    const snapshot = hydrateProduct(quote.productSnapshot);
    const offer = await this.store.checkOffer(snapshot.marketplace, snapshot.externalProductId);
    if (!offer.available) throw DomainErrors.outOfStock();

    const maxProcurement = Money.of(
      Number(quote.maxProcurementMinor),
      quote.maxProcurementCurrency,
    );
    const liveLineTotal = offer.price.multiply(quote.quantity);

    if (liveLineTotal.greaterThan(maxProcurement)) throw DomainErrors.quoteStale();

    const ref = publicRef('XB');

    return this.uow.run(async (ctx) => {
      const orderRepo = new OrderRepository(ctx.tx);

      const order = await orderRepo.create({
        id: uuidv7(),
        publicRef: ref,
        customerId: input.customerId,
        quoteId: quote.id,
        addressId: input.addressId,
        state: 'DRAFT',
        maxProcurementMinor: quote.maxProcurementMinor,
        maxProcurementCurrency: quote.maxProcurementCurrency,
        totalAmountMinor: quote.finalAmountMinor,
        totalCurrency: quote.finalCurrency,
        sandboxSessionId: input.sandboxSessionId ?? null,
      });

      // Walk the declared path rather than jumping straight to AWAITING_PAYMENT, so the
      // timeline records how the order actually got there.
      for (const [from, to] of [
        ['DRAFT', 'QUOTING'],
        ['QUOTING', 'QUOTED'],
        ['QUOTED', 'AWAITING_PAYMENT'],
      ] as const) {
        assertTransition(from, to);
        await orderRepo.transition({
          orderId: order.id,
          from,
          to,
          actor: 'system',
          correlationId: correlationId(),
        });
      }

      ctx.emit({
        topic: 'order.created',
        aggregateId: order.id,
        aggregateType: 'order',
        payload: { orderId: order.id, publicRef: ref, customerId: input.customerId },
      });

      metrics.counter(METRIC.orderTransition, 1, { to: 'AWAITING_PAYMENT' });

      return this.buildDto(order.id, ctx.tx);
    });
  }

  async startPayment(orderId: string, customerId: string, idempotencyKey: string) {
    const order = await new OrderRepository(this.db).requireById(orderId);
    if (order.customerId !== customerId) throw new NotFoundError('Order', orderId);
    if (order.state !== 'AWAITING_PAYMENT') throw DomainErrors.paymentAlreadySettled();

    const amount = Money.of(Number(order.totalAmountMinor), order.totalCurrency);

    const intent = await this.payment.createIntent({
      orderId: order.id,
      amount,
      idempotencyKey,
      // Carries the order id so the return page can poll for settlement rather than
      // trusting the redirect, which anyone could forge.
      returnUrl: `${this.env.API_CORS_ORIGINS[0] ?? 'http://localhost:3010'}/checkout/return/?order=${order.id}`,
    });

    await new PaymentRepository(this.db).create({
      id: uuidv7(),
      orderId: order.id,
      provider: intent.provider,
      providerRef: intent.providerRef,
      amountMinor: BigInt(amount.amount),
      currency: amount.currency,
      status: 'PENDING',
      idempotencyKey,
    });

    return {
      paymentId: intent.providerRef,
      provider: intent.provider,
      redirectUrl: intent.redirectUrl ?? '',
      expiresAt: intent.expiresAt,
    };
  }

  /**
   * Settle a payment.
   *
   * Idempotent at the database level: `settleOnce` only updates a row that is not already
   * settled, so a redelivered webhook cannot post the ledger entry twice.
   *
   * The result is `PAID`. It is never `PURCHASED` — the foreign purchase has not happened,
   * and a worker will attempt it after this transaction commits.
   */
  async settlePayment(provider: string, providerRef: string): Promise<void> {
    await this.uow.run(async (ctx) => {
      const paymentRepo = new PaymentRepository(ctx.tx);
      const stored = await paymentRepo.findByProviderRef(provider, providerRef);
      if (!stored) throw new NotFoundError('Payment', providerRef);

      const settled = await paymentRepo.settleOnce(stored.id);
      if (!settled) {
        logger.info({ providerRef }, 'payment already settled; webhook replay ignored');
        return;
      }

      const orderRepo = new OrderRepository(ctx.tx);
      const order = await orderRepo.requireById(stored.orderId);
      const amount = Money.of(Number(stored.amountMinor), stored.currency);

      assertTransition(order.state, 'PAID');
      await orderRepo.transition({
        orderId: order.id,
        from: order.state,
        to: 'PAID',
        actor: `gateway:${provider}`,
        reason: `settled ${providerRef}`,
        correlationId: correlationId(),
      });

      // Double-entry: cash increases, and we now owe the customer a delivered product.
      await new LedgerRepository(ctx.tx).post({
        refType: 'order',
        refId: order.id,
        lines: [
          { account: 'assets:cash:irr', debit: amount, memo: `payment ${providerRef}` },
          { account: 'liabilities:customer_prepayment', credit: amount },
        ],
      });

      assertTransition('PAID', 'PROCUREMENT_PENDING');
      await orderRepo.transition({
        orderId: order.id,
        from: 'PAID',
        to: 'PROCUREMENT_PENDING',
        actor: 'system',
        correlationId: correlationId(),
      });

      ctx.emit({
        topic: 'order.paid',
        aggregateId: order.id,
        aggregateType: 'order',
        payload: {
          orderId: order.id,
          amountMinor: Number(stored.amountMinor),
          currency: stored.currency,
        },
      });
    });
  }

  async get(orderId: string, customerId: string): Promise<OrderDto> {
    const order = await new OrderRepository(this.db).requireById(orderId);
    if (order.customerId !== customerId) throw new NotFoundError('Order', orderId);
    return this.buildDto(orderId, this.db);
  }

  async list(customerId: string, cursor: string | undefined, limit: number) {
    const { items, nextCursor } = await new OrderRepository(this.db).listByCustomer(
      customerId,
      cursor,
      limit,
    );

    const quoteRepo = new QuoteRepository(this.db);
    const summaries = await Promise.all(
      items.map(async (o) => {
        const quote = await quoteRepo.findById(o.quoteId);
        const snapshot = quote ? hydrateProduct(quote.productSnapshot) : undefined;
        return {
          id: o.id,
          publicRef: o.publicRef,
          state: o.state as OrderState,
          title: snapshot?.title ?? 'Order',
          imageUrl: snapshot?.imageUrl ?? null,
          finalPrice: { amount: Number(o.totalAmountMinor), currency: o.totalCurrency },
          createdAt: o.createdAt.toISOString(),
        };
      }),
    );

    return { items: summaries, nextCursor };
  }

  private async buildDto(
    orderId: string,
    db: Database | Parameters<typeof eq>[0],
  ): Promise<OrderDto> {
    return buildOrderDto(orderId, db as Database);
  }
}

// ─────────────────────────── controllers ───────────────────────────

@Controller('v1')
export class CommerceController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly quotes: QuoteService,
    private readonly orders: OrderService,
    @Inject(STORE_PORT) private readonly store: StorePort,
    @Inject(PAYMENT_PORT) private readonly payment: PaymentPort,
  ) {}

  // Public: a visitor can price an item before they have an account. Auth is required from
  // order creation onward, where an actor is genuinely needed.
  @Public()
  @Post('product-requests')
  @Idempotent()
  @HttpCode(201)
  async createProductRequest(
    @Body(zodBody(createProductRequestBody)) body: { url: string },
    @Actor() actor: AuthenticatedActor | undefined,
  ) {
    return this.catalog.createRequest(body.url, actor?.id);
  }

  @Public()
  @Get('product-requests/:id')
  async getProductRequest(@Param('id') id: string) {
    return this.catalog.getRequest(id);
  }

  @Public()
  @Post('quotes')
  @Idempotent()
  @HttpCode(201)
  async createQuote(
    @Body(zodBody(createQuoteRequest)) body: { requestId: string; quantity: number },
    @Actor() actor: AuthenticatedActor | undefined,
  ) {
    return this.quotes.create(body.requestId, body.quantity, actor?.id);
  }

  @Public()
  @Post('quotes/:id/refresh')
  @HttpCode(200)
  async refreshQuote(@Param('id') id: string) {
    return this.quotes.refresh(id, this.store);
  }

  @Post('orders')
  @Idempotent()
  @HttpCode(201)
  async createOrder(
    @Body(zodBody(createOrderRequest)) body: { quoteId: string; addressId: string },
    @Actor() actor: AuthenticatedActor,
    @Headers('x-sandbox-session') sandboxSession: string | undefined,
  ) {
    return this.orders.create({
      quoteId: body.quoteId,
      addressId: body.addressId,
      customerId: actor.id,
      ...(sandboxSession ? { sandboxSessionId: sandboxSession } : {}),
    });
  }

  @Get('orders')
  async listOrders(
    @Actor() actor: AuthenticatedActor,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
  ) {
    return this.orders.list(actor.id, cursor, Math.min(Number(limit ?? 20) || 20, 100));
  }

  @Get('orders/:id')
  async getOrder(
    @Param('id') id: string,
    @Actor() actor: AuthenticatedActor,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const order = await this.orders.get(id, actor.id);
    // The ETag is the order version, which clients send back as If-Match on mutations.
    void reply.header('etag', String(order.version));
    return order;
  }

  @Post('orders/:id/payments')
  @Idempotent()
  @HttpCode(200)
  async startPayment(
    @Param('id') id: string,
    @Actor() actor: AuthenticatedActor,
    @Headers('idempotency-key') key: string,
  ) {
    return this.orders.startPayment(id, actor.id, key);
  }
}

/**
 * Gateway webhooks.
 *
 * Public — the gateway has no bearer token — but signature-verified. Verification failure is
 * a 401 and nothing else happens, so an unsigned request cannot settle an order.
 */
@Controller('v1/webhooks')
export class WebhookController {
  constructor(
    private readonly orders: OrderService,
    @Inject(PAYMENT_PORT) private readonly payment: PaymentPort,
  ) {}

  @Post('payments/:provider')
  @HttpCode(204)
  async paymentWebhook(
    @Param('provider') provider: string,
    @Body() body: { providerRef?: string; ref?: string },
    @Headers('x-signature') signature: string | undefined,
  ) {
    if (!this.payment.verifyWebhook(JSON.stringify(body ?? {}), signature ?? '')) {
      const { UnauthorizedError } = await import('@xb/core');
      throw new UnauthorizedError('Webhook signature verification failed');
    }

    const ref = body.providerRef ?? body.ref;
    if (!ref) throw new NotFoundError('Payment reference');

    await this.orders.settlePayment(provider, ref);
  }
}

// ─────────────────────────── mappers ───────────────────────────

function serialiseBreakdown(b: {
  product: Money;
  freight: Money;
  handling: Money;
  lastMile: Money;
  customs: Money;
  insurance: Money;
  serviceFee: Money;
}): Record<string, unknown> {
  return {
    product: b.product.toJSON(),
    freight: b.freight.toJSON(),
    handling: b.handling.toJSON(),
    lastMile: b.lastMile.toJSON(),
    customs: b.customs.toJSON(),
    insurance: b.insurance.toJSON(),
    serviceFee: b.serviceFee.toJSON(),
  };
}

function toQuoteDto(id: string, c: ReturnType<QuoteEngine['createQuote']> extends Promise<infer T> ? T : never): QuoteDto {
  return {
    id,
    productSnapshot: toProductDto(c.productSnapshot),
    quantity: c.quantity,
    fxRate: c.fxRate,
    breakdown: {
      product: c.breakdown.product.toJSON(),
      freight: c.breakdown.freight.toJSON(),
      handling: c.breakdown.handling.toJSON(),
      lastMile: c.breakdown.lastMile.toJSON(),
      customs: c.breakdown.customs.toJSON(),
      insurance: c.breakdown.insurance.toJSON(),
      serviceFee: c.breakdown.serviceFee.toJSON(),
    },
    finalPrice: c.finalPrice.toJSON(),
    maxProcurementPrice: c.maxProcurementPrice.toJSON(),
    overheadRatio: c.overheadRatio,
    riskFactor: c.riskFactor,
    viable: c.viable,
    createdAt: c.createdAt,
    expiresAt: c.expiresAt,
  };
}

@Module({
  controllers: [CommerceController, WebhookController],
  providers: [CatalogService, QuoteService, OrderService],
  exports: [OrderService, QuoteService, CatalogService],
})
export class CommerceModule {}
