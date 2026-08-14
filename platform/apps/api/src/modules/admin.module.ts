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
  HttpCode,
} from '@nestjs/common';
import { desc, eq, isNull, and } from 'drizzle-orm';
import { Money, NotFoundError, uuidv7, type LocalizedMessage } from '@xb/core';
import {
  adminOrderSearchQuery,
  confirmProcurementRequest,
  repriceOrderRequest,
  transitionOrderRequest,
  type AdminOrderSearchQuery,
  type AdminOrderSearchResultDto,
  type ExceptionItemDto,
  type OrderDto,
  type OrderState,
} from '@xb/contracts';
import { correlationId, metrics, METRIC } from '@xb/observability';
import { breakerRegistry } from '@xb/resilience';
import { confirmOperatorPurchase, type ResolvedProduct, type StorePort } from '@xb/commerce';
import {
  ExceptionRepository,
  LedgerRepository,
  OrderRepository,
  ProcurementRepository,
  QuoteRepository,
  UnitOfWork,
  exceptions as exceptionsTable,
  ledgerEntries,
  orders as ordersTable,
  type Database,
} from '@xb/db';
import { Actor, Roles, type AuthenticatedActor } from '../common/http.ts';
import { zodBody } from '../common/zod-pipe.ts';
import { parseOrThrow } from '@xb/validation';
import { assertTransition } from '../domain/order-state-machine.ts';
import { buildOrderDto } from '../domain/order-dto.ts';
import { DB, STORE_PORT, UNIT_OF_WORK } from '../tokens.ts';

/**
 * The back office.
 *
 * Manage-by-exception: the default view is the ranked queue of orders that need a human, not
 * a list of healthy ones. An operator's screen should only ever contain work.
 *
 * Every mutation here is audited with the operator's identity and subject to the same
 * transition table as the automated path — an operator cannot move an order somewhere the
 * machine could not.
 */

@Injectable()
export class OpsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(STORE_PORT) private readonly store: StorePort,
  ) {}

  async listExceptions(cursor: string | undefined, limit: number, type?: string) {
    const { items, nextCursor } = await new ExceptionRepository(this.db).listOpen(
      cursor,
      limit,
      type,
    );

    const orderRepo = new OrderRepository(this.db);

    const dtos: ExceptionItemDto[] = await Promise.all(
      items.map(async (e) => {
        const order = await orderRepo.findById(e.orderId);
        return {
          id: e.id,
          orderId: e.orderId,
          publicRef: order?.publicRef ?? '—',
          type: e.type,
          state: e.state as OrderState,
          marginAtRisk: { amount: Number(e.marginAtRiskMinor), currency: e.currency },
          ageMinutes: Math.floor((Date.now() - e.createdAt.getTime()) / 60_000),
          rank: Number(e.rank),
          rankedBy: e.rankedBy as 'model' | 'deterministic',
          assignee: e.assignee,
          summary: summariseException(e.type, e.state as OrderState),
        };
      }),
    );

    return { items: dtos, nextCursor };
  }

  /**
   * Procurement copilot context.
   *
   * Recomputes the live price rather than reading the stored expectation, because the whole
   * point of this screen is telling the operator what the price is *now*.
   */
  async copilot(procurementId: string) {
    const procurement = await new ProcurementRepository(this.db).requireById(procurementId);
    const order = await new OrderRepository(this.db).requireById(procurement.orderId);
    const quote = await new QuoteRepository(this.db).requireById(order.quoteId);
    const snapshot = quote.productSnapshot as unknown as ResolvedProduct; // title only; no Money accessed

    const offer = await this.store.checkOffer(
      procurement.marketplace as never,
      procurement.externalProductId,
    );

    const expected = Money.of(Number(procurement.expectedPriceMinor), procurement.currency);
    const current = offer.price.multiply(procurement.quantity);
    const maxAuthorised = Money.of(
      Number(order.maxProcurementMinor),
      order.maxProcurementCurrency,
    );
    const withinGuard = !current.greaterThan(maxAuthorised);

    // What the service fee becomes if we proceed at the current price.
    const serviceFee = (quote.breakdown as { serviceFee?: { amount: number; currency: string } })
      .serviceFee;
    const feeMoney = Money.of(serviceFee?.amount ?? 0, (serviceFee?.currency ?? 'IRR') as never);
    const overspend = current.greaterThan(expected) ? current.subtract(expected) : null;

    return {
      procurementId: procurement.id,
      orderId: order.id,
      publicRef: order.publicRef,
      marketplace: procurement.marketplace,
      productTitle: snapshot.title,
      productUrl: snapshot.canonicalUrl,
      quantity: procurement.quantity,
      expectedPrice: expected.toJSON(),
      currentPrice: current.toJSON(),
      maxAuthorised: maxAuthorised.toJSON(),
      withinGuard,
      marginIfProceed: feeMoney.toJSON(),
      recommendation: {
        action: withinGuard ? ('PROCEED' as const) : ('HOLD' as const),
        rationale: withinGuard
          ? {
              en: 'Current price is within the authorised ceiling. Safe to purchase.',
              fa: 'قیمت فعلی درون سقف مجاز است و خرید بلامانع است.',
            }
          : {
              en: `Current price exceeds the authorised maximum${overspend ? ` by ${overspend.format('en')}` : ''}. Contact the customer before proceeding.`,
              fa: 'قیمت فعلی از حداکثر مبلغ مجاز بیشتر است. پیش از ادامه با مشتری هماهنگ کنید.',
            },
      },
    };
  }

  /**
   * Confirm an operator-completed purchase.
   *
   * `confirmOperatorPurchase` re-checks the ceiling. An operator who types a figure above
   * the authorised maximum is stopped — the guard is a system property, not a courtesy the
   * operator extends.
   */
  async confirmProcurement(input: {
    procurementId: string;
    externalOrderId: string;
    actualPaid: { amount: number; currency: string };
    operator: AuthenticatedActor;
    note?: string;
  }) {
    const procRepo = new ProcurementRepository(this.db);
    const procurement = await procRepo.requireById(input.procurementId);
    const order = await new OrderRepository(this.db).requireById(procurement.orderId);

    const maxAuthorised = Money.of(
      Number(order.maxProcurementMinor),
      order.maxProcurementCurrency,
    );
    const actualPaid = Money.of(input.actualPaid.amount, input.actualPaid.currency as never);

    confirmOperatorPurchase({
      maxAuthorised,
      actualPaid,
      externalOrderId: input.externalOrderId,
    });

    return this.uow.run(async (ctx) => {
      const confirmed = await new ProcurementRepository(ctx.tx).confirm({
        id: procurement.id,
        externalOrderId: input.externalOrderId,
        actualPrice: actualPaid,
        confirmedBy: input.operator.id,
      });

      if (!confirmed) throw new NotFoundError('Procurement order', procurement.id);

      const orderRepo = new OrderRepository(ctx.tx);
      assertTransition(order.state as OrderState, 'PURCHASED');
      await orderRepo.transition({
        orderId: order.id,
        from: order.state,
        to: 'PURCHASED',
        actor: `operator:${input.operator.id}`,
        reason: input.note ?? `external order ${input.externalOrderId}`,
        correlationId: correlationId(),
      });

      // Foreign spend: an asset (goods in transit) acquired against our float.
      await new LedgerRepository(ctx.tx).post({
        refType: 'procurement',
        refId: procurement.id,
        lines: [
          { account: 'assets:goods_in_transit', debit: actualPaid },
          { account: 'assets:foreign_float', credit: actualPaid },
        ],
      });

      ctx.emit({
        topic: 'procurement.purchased',
        aggregateId: order.id,
        aggregateType: 'order',
        payload: {
          orderId: order.id,
          procurementId: procurement.id,
          externalOrderId: input.externalOrderId,
        },
      });

      metrics.counter(METRIC.orderTransition, 1, { to: 'PURCHASED' });
      return { ok: true, orderId: order.id, state: 'PURCHASED' as const };
    });
  }

  async transition(input: {
    orderId: string;
    to: OrderState;
    reason: string;
    operator: AuthenticatedActor;
    expectedVersion?: number;
  }) {
    const order = await new OrderRepository(this.db).requireById(input.orderId);
    assertTransition(order.state as OrderState, input.to);

    return this.uow.run(async (ctx) => {
      const repo = new OrderRepository(ctx.tx);
      await repo.transition({
        orderId: order.id,
        from: order.state,
        to: input.to,
        actor: `operator:${input.operator.id}`,
        reason: input.reason,
        correlationId: correlationId(),
        ...(input.expectedVersion !== undefined ? { expectedVersion: input.expectedVersion } : {}),
      });

      ctx.emit({
        topic: 'order.state_changed',
        aggregateId: order.id,
        aggregateType: 'order',
        payload: { orderId: order.id, from: order.state, to: input.to, manual: true },
      });

      return { ok: true, orderId: order.id, state: input.to };
    });
  }

  async reprice(input: {
    orderId: string;
    newMaxPrice: { amount: number; currency: string };
    reason: string;
    operator: AuthenticatedActor;
    expectedVersion?: number;
  }) {
    const order = await new OrderRepository(this.db).requireById(input.orderId);
    const newMax = Money.of(input.newMaxPrice.amount, input.newMaxPrice.currency as never);

    return this.uow.run(async (ctx) => {
      const repo = new OrderRepository(ctx.tx);
      await repo.updateMaxProcurement(order.id, newMax);

      assertTransition(order.state as OrderState, 'PROCUREMENT_PENDING');
      await repo.transition({
        orderId: order.id,
        from: order.state,
        to: 'PROCUREMENT_PENDING',
        actor: `operator:${input.operator.id}`,
        reason: `reprice: ${input.reason}`,
        payload: { newMaxMinor: newMax.amount, currency: newMax.currency },
        correlationId: correlationId(),
        ...(input.expectedVersion !== undefined ? { expectedVersion: input.expectedVersion } : {}),
      });

      ctx.emit({
        topic: 'order.state_changed',
        aggregateId: order.id,
        aggregateType: 'order',
        payload: { orderId: order.id, to: 'PROCUREMENT_PENDING', repriced: true },
      });

      return { ok: true, orderId: order.id, state: 'PROCUREMENT_PENDING' as const };
    });
  }

  async resolveException(id: string, note: string) {
    await new ExceptionRepository(this.db).resolve(id, note);
    return { ok: true };
  }

  /**
   * Read any order as an operator.
   *
   * The customer route cannot serve this. `OrderService.get` compares the order's customer to
   * the caller and raises `NotFoundError` on a mismatch — correct for a customer, and for an
   * operator it means every order is missing, which silently broke the back office's order
   * screen and with it the procurement copilot.
   *
   * Note what this is *not*: a list. Manage-by-exception means the queue shows orders that
   * need a human, and a healthy order is deliberately absent from it. This is deliberate
   * lookup of one known order — what support does when a customer quotes a reference — so it
   * accepts the public reference (`XB-…`) as well as the internal id, because the public one
   * is the only identifier a customer ever sees.
   */
  /**
   * Search orders, healthy ones included.
   *
   * The counterpart to the exception queue rather than a replacement for it. The queue stays
   * the default view and still shows only what needs a human; this is the screen an operator
   * opens when a customer is on the phone quoting a reference, or when finance asks which
   * orders over some amount are still unpaid.
   */
  async searchOrders(q: AdminOrderSearchQuery): Promise<AdminOrderSearchResultDto> {
    const { rows, total } = await new OrderRepository(this.db).search({
      q: q.q,
      states: q.state,
      customerId: q.customerId,
      minTotal: q.minTotal,
      maxTotal: q.maxTotal,
      createdFrom: q.createdFrom,
      createdTo: q.createdTo,
      sandbox: q.sandbox,
      sort: q.sort,
      limit: q.limit,
      offset: q.offset,
    });

    return {
      items: rows.map((r) => {
        const snapshot = r.productSnapshot as { title?: string; marketplace?: string } | null;
        return {
          id: r.id,
          publicRef: r.publicRef,
          state: r.state as OrderState,
          total: { amount: Number(r.totalAmountMinor), currency: r.totalCurrency },
          productTitle: snapshot?.title ?? '—',
          quantity: r.quantity ?? 1,
          marketplace: snapshot?.marketplace ?? '—',
          customer: {
            id: r.customerId ?? '00000000-0000-0000-0000-000000000000',
            phone: r.customerPhone ?? '—',
            displayName: r.customerName ?? null,
          },
          isSandbox: r.sandboxSessionId !== null,
          exceptionType: r.exceptionType ?? null,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        };
      }),
      total,
      limit: q.limit,
      offset: q.offset,
    };
  }

  async getOrder(idOrRef: string): Promise<OrderDto> {
    const repo = new OrderRepository(this.db);

    const order = idOrRef.toUpperCase().startsWith('XB-')
      ? await repo.findByPublicRef(idOrRef.toUpperCase())
      : await repo.findById(idOrRef);

    if (!order) throw new NotFoundError('Order', idOrRef);

    return buildOrderDto(order.id, this.db);
  }
}

@Injectable()
export class FinanceService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async ledger(refId: string | undefined, limit: number) {
    const rows = refId
      ? await this.db
          .select()
          .from(ledgerEntries)
          .where(eq(ledgerEntries.refId, refId))
          .orderBy(desc(ledgerEntries.seq))
          .limit(limit)
      : await this.db.select().from(ledgerEntries).orderBy(desc(ledgerEntries.seq)).limit(limit);

    return {
      items: rows.map((r) => ({
        seq: String(r.seq),
        txnId: r.txnId,
        account: r.account,
        debit: Number(r.debitMinor),
        credit: Number(r.creditMinor),
        currency: r.currency,
        refType: r.refType,
        refId: r.refId,
        postedAt: r.postedAt.toISOString(),
      })),
      nextCursor: null,
    };
  }

  async balances() {
    const repo = new LedgerRepository(this.db);
    const accounts = [
      'assets:cash:irr',
      'liabilities:customer_prepayment',
      'assets:goods_in_transit',
      'assets:foreign_float',
    ];

    return Promise.all(
      accounts.map(async (account) => ({
        account,
        balance: (await repo.balance(account, account.includes('irr') || account.includes('customer') ? 'IRR' : 'AED')).toJSON(),
      })),
    );
  }
}

@Roles('ops', 'admin')
@Controller('v1/admin')
export class AdminController {
  constructor(
    private readonly ops: OpsService,
    private readonly finance: FinanceService,
  ) {}

  @Get('exceptions')
  async exceptions(
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('type') type: string | undefined,
  ) {
    return this.ops.listExceptions(cursor, Math.min(Number(limit ?? 20) || 20, 100), type);
  }

  /**
   * Search orders. Query is parsed by the same Zod schema the client derives its types from,
   * so an unknown sort or an out-of-range limit is a 400 with a bilingual message rather than
   * a surprise further down.
   */
  @Get('orders')
  async orders(@Query() query: Record<string, unknown>) {
    // `parseOrThrow`, not `schema.parse`: the latter raises a ZodError the exception filter
    // does not recognise, so a mistyped sort key came back as a 500 rather than a 400 with a
    // message naming the bad field.
    return this.ops.searchOrders(parseOrThrow(adminOrderSearchQuery, normaliseOrderQuery(query)));
  }

  /** Deliberate lookup of one order, by internal id or public reference. */
  @Get('orders/:id')
  async order(@Param('id') id: string) {
    return this.ops.getOrder(id);
  }

  @Get('procurements/:id/copilot')
  async copilot(@Param('id') id: string) {
    return this.ops.copilot(id);
  }

  @Post('procurements/:id/confirm')
  @HttpCode(200)
  async confirm(
    @Param('id') id: string,
    @Body(zodBody(confirmProcurementRequest))
    body: { externalOrderId: string; actualPaid: { amount: number; currency: string }; note?: string },
    @Actor() operator: AuthenticatedActor,
  ) {
    return this.ops.confirmProcurement({
      procurementId: id,
      externalOrderId: body.externalOrderId,
      actualPaid: body.actualPaid,
      operator,
      ...(body.note ? { note: body.note } : {}),
    });
  }

  @Post('orders/:id/transition')
  @HttpCode(200)
  async transition(
    @Param('id') id: string,
    @Body(zodBody(transitionOrderRequest)) body: { to: OrderState; reason: string },
    @Actor() operator: AuthenticatedActor,
    @Headers('if-match') ifMatch: string | undefined,
  ) {
    return this.ops.transition({
      orderId: id,
      to: body.to,
      reason: body.reason,
      operator,
      ...(ifMatch ? { expectedVersion: Number(ifMatch) } : {}),
    });
  }

  @Post('orders/:id/reprice')
  @HttpCode(200)
  async reprice(
    @Param('id') id: string,
    @Body(zodBody(repriceOrderRequest))
    body: { newMaxPrice: { amount: number; currency: string }; reason: string },
    @Actor() operator: AuthenticatedActor,
    @Headers('if-match') ifMatch: string | undefined,
  ) {
    return this.ops.reprice({
      orderId: id,
      newMaxPrice: body.newMaxPrice,
      reason: body.reason,
      operator,
      ...(ifMatch ? { expectedVersion: Number(ifMatch) } : {}),
    });
  }

  @Get('finance/ledger')
  @Roles('finance', 'admin')
  async ledger(@Query('refId') refId: string | undefined, @Query('limit') limit: string | undefined) {
    return this.finance.ledger(refId, Math.min(Number(limit ?? 50) || 50, 200));
  }

  @Get('finance/balances')
  @Roles('finance', 'admin')
  async balances() {
    return this.finance.balances();
  }

  /** Provider health — the same state the failover selector reads. */
  @Get('providers')
  async providers() {
    return breakerRegistry.snapshot().map((s) => {
      const [port = 'unknown', provider = 'unknown'] = s.provider.split(':');
      return {
        port,
        provider,
        state: s.state === 'OPEN' ? 'QUARANTINED' : s.state === 'HALF_OPEN' ? 'PROBING' : 'HEALTHY',
        priority: 0,
        lastError: s.lastError ?? null,
      };
    });
  }
}

/**
 * Reshape a raw query string into what the schema expects.
 *
 * Two mismatches, both from how query strings actually arrive rather than from the schema
 * being wrong. `?state=PAID` is a string and `?state=PAID&state=DELIVERED` is an array, so
 * the single case is lifted into an array. And a form submits its empty fields as `?q=`,
 * which would fail `min(1)` — an empty filter means "no filter", not a validation error.
 */
function normaliseOrderQuery(query: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(query)) {
    if (value === '' || value === undefined || value === null) continue;
    out[key] = key === 'state' && !Array.isArray(value) ? [value] : value;
  }

  return out;
}

function summariseException(type: string, state: OrderState): LocalizedMessage {
  const map: Record<string, LocalizedMessage> = {
    PRICE_CHANGED: {
      en: 'Seller raised the price above the authorised ceiling.',
      fa: 'فروشنده قیمت را بیش از سقف مجاز افزایش داده است.',
    },
    OUT_OF_STOCK: {
      en: 'Item became unavailable after payment.',
      fa: 'کالا پس از پرداخت ناموجود شد.',
    },
    PROCUREMENT_FAILED: {
      en: 'Purchase attempt failed and needs a manual decision.',
      fa: 'تلاش برای خرید ناموفق بود و به تصمیم دستی نیاز دارد.',
    },
    SHIPMENT_EXCEPTION: {
      en: 'Tracking has stalled beyond the SLA.',
      fa: 'به‌روزرسانی رهگیری بیش از مهلت مجاز متوقف شده است.',
    },
    CUSTOMS_EXCEPTION: {
      en: 'Parcel held at customs.',
      fa: 'مرسوله در گمرک متوقف شده است.',
    },
  };
  return map[type] ?? { en: `Order is in ${state}.`, fa: `سفارش در وضعیت ${state} است.` };
}

@Module({
  controllers: [AdminController],
  providers: [OpsService, FinanceService],
  exports: [OpsService],
})
export class AdminModule {}
