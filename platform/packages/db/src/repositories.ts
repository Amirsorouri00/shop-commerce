import { and, asc, desc, eq, gt, gte, isNull, lt, lte, sql, inArray } from 'drizzle-orm';
import { Money, uuidv7, NotFoundError, PreconditionFailedError, type Currency } from '@xb/core';
import type { Database } from './client.ts';
import type { Tx } from './unit-of-work.ts';
import {
  customers,
  identities,
  orders,
  orderEvents,
  payments,
  procurementOrders,
  quotes,
  productRequests,
  shipments,
  trackingEvents,
  ledgerEntries,
  exceptions,
  outbox,
  idempotencyKeys,
  processedEvents,
  addresses,
  orderStateEnum,
} from './schema.ts';

type Executor = Database | Tx;

/**
 * The order-state union.
 *
 * Derived from the enum's own values rather than from `$inferInsert['state']` — the latter
 * includes `undefined` because the column has a default, and under
 * `exactOptionalPropertyTypes` that `undefined` propagates into every cast.
 */
export type OrderStateValue = (typeof orderStateEnum.enumValues)[number];

/** Money crosses the persistence boundary as (minor, currency) and reassembles here. */
const toMoney = (minor: bigint | null, currency: string | null): Money =>
  Money.of(Number(minor ?? 0n), (currency ?? 'IRR') as Currency);

// ─────────────────────────── customers ───────────────────────────

export class CustomerRepository {
  constructor(private readonly db: Executor) {}

  async findByPhone(phoneE164: string) {
    const [row] = await this.db.select().from(customers).where(eq(customers.phoneE164, phoneE164)).limit(1);
    return row;
  }

  async findById(id: string) {
    const [row] = await this.db.select().from(customers).where(eq(customers.id, id)).limit(1);
    return row;
  }

  async create(input: { phoneE164: string; displayName?: string; locale?: string }) {
    const [row] = await this.db
      .insert(customers)
      .values({
        id: uuidv7(),
        phoneE164: input.phoneE164,
        displayName: input.displayName ?? null,
        locale: input.locale ?? 'fa',
      })
      .returning();
    return row!;
  }

  /**
   * Find or create by phone.
   *
   * `onConflictDoUpdate` rather than a select-then-insert: two OTP verifications racing on a
   * first login would both see "no customer" and both insert.
   */
  async upsertByPhone(phoneE164: string) {
    const [row] = await this.db
      .insert(customers)
      .values({ id: uuidv7(), phoneE164 })
      .onConflictDoUpdate({
        target: customers.phoneE164,
        set: { updatedAt: new Date() },
      })
      .returning();
    return row!;
  }

  async linkIdentity(customerId: string, provider: string, subject: string) {
    await this.db
      .insert(identities)
      .values({ id: uuidv7(), customerId, provider, subject })
      .onConflictDoNothing();
  }

  async listAddresses(customerId: string) {
    return this.db
      .select()
      .from(addresses)
      .where(eq(addresses.customerId, customerId))
      .orderBy(desc(addresses.isDefault), desc(addresses.createdAt));
  }

  async createAddress(input: typeof addresses.$inferInsert) {
    const [row] = await this.db.insert(addresses).values({ ...input, id: input.id ?? uuidv7() }).returning();
    return row!;
  }
}

// ─────────────────────────── catalog ───────────────────────────

export class ProductRequestRepository {
  constructor(private readonly db: Executor) {}

  async create(input: typeof productRequests.$inferInsert) {
    const [row] = await this.db
      .insert(productRequests)
      .values({ ...input, id: input.id ?? uuidv7() })
      .returning();
    return row!;
  }

  async findById(id: string) {
    const [row] = await this.db.select().from(productRequests).where(eq(productRequests.id, id)).limit(1);
    return row;
  }

  async requireById(id: string) {
    const row = await this.findById(id);
    if (!row) throw new NotFoundError('Product request', id);
    return row;
  }
}

export class QuoteRepository {
  constructor(private readonly db: Executor) {}

  async create(input: typeof quotes.$inferInsert) {
    const [row] = await this.db.insert(quotes).values({ ...input, id: input.id ?? uuidv7() }).returning();
    return row!;
  }

  async findById(id: string) {
    const [row] = await this.db.select().from(quotes).where(eq(quotes.id, id)).limit(1);
    return row;
  }

  async requireById(id: string) {
    const row = await this.findById(id);
    if (!row) throw new NotFoundError('Quote', id);
    return row;
  }

  /** Mark a quote replaced by a revalidated one. The original is never mutated. */
  async supersede(oldId: string, newId: string) {
    await this.db.update(quotes).set({ supersededByQuoteId: newId }).where(eq(quotes.id, oldId));
  }
}

// ─────────────────────────── orders ───────────────────────────

export interface OrderTransitionInput {
  readonly orderId: string;
  readonly from: string;
  readonly to: string;
  readonly actor: string;
  readonly reason?: string;
  readonly payload?: Record<string, unknown>;
  readonly correlationId: string;
  /** When supplied, the update fails unless the row is still at this version. */
  readonly expectedVersion?: number;
}

export class OrderRepository {
  constructor(private readonly db: Executor) {}

  async findById(id: string) {
    const [row] = await this.db.select().from(orders).where(eq(orders.id, id)).limit(1);
    return row;
  }

  async requireById(id: string) {
    const row = await this.findById(id);
    if (!row) throw new NotFoundError('Order', id);
    return row;
  }

  async findByPublicRef(ref: string) {
    const [row] = await this.db.select().from(orders).where(eq(orders.publicRef, ref)).limit(1);
    return row;
  }

  /**
   * Operator order search.
   *
   * Offset paging rather than the keyset cursor used everywhere else, and the deviation is
   * deliberate: this is the one screen where the operator needs to know *how many* orders
   * matched — "did this customer order once or eleven times" is the question behind half the
   * support calls — and a keyset cursor cannot produce a count. It also has to sort by
   * columns that are not unique (total, updated_at), where keyset paging needs a composite
   * tiebreaker per sort order. The row counts an operator filters down to are small; a
   * customer-facing endpoint would not get this concession.
   *
   * The joins are left joins on purpose. An order whose quote row or customer row is somehow
   * missing is exactly the kind of order an operator is hunting for, and an inner join would
   * hide it.
   */
  async search(f: {
    q?: string | undefined;
    states?: readonly string[] | undefined;
    customerId?: string | undefined;
    minTotal?: number | undefined;
    maxTotal?: number | undefined;
    createdFrom?: string | undefined;
    createdTo?: string | undefined;
    sandbox: 'exclude' | 'only' | 'include';
    sort: 'newest' | 'oldest' | 'total_desc' | 'total_asc' | 'updated';
    limit: number;
    offset: number;
  }) {
    const where = [];

    if (f.q) {
      const term = f.q.trim();
      const like = `%${term.toLowerCase()}%`;
      // A public reference is what a customer reads off their screen, so it is matched
      // case-insensitively and whole; ids are matched exactly because a partial uuid is
      // never something anyone types on purpose.
      const clauses = [
        sql`lower(${orders.publicRef}) LIKE ${like}`,
        sql`lower(${customers.phoneE164}) LIKE ${like}`,
        sql`lower(coalesce(${customers.displayName}, '')) LIKE ${like}`,
      ];
      if (/^[0-9a-f-]{36}$/i.test(term)) {
        clauses.push(sql`${orders.id}::text = ${term.toLowerCase()}`);
        clauses.push(sql`${orders.customerId}::text = ${term.toLowerCase()}`);
      }
      where.push(sql`(${sql.join(clauses, sql` OR `)})`);
    }

    if (f.states?.length) where.push(inArray(orders.state, f.states as never));
    if (f.customerId) where.push(eq(orders.customerId, f.customerId));

    // `gte`/`lte` rather than a raw `sql` fragment. The operators carry the column's type
    // mapper, so a bigint goes to Postgres as a bigint and a Date as a timestamptz; inside a
    // raw fragment the driver sees a bare JS value with no column to infer from and refuses
    // to serialise a Date at all.
    if (f.minTotal !== undefined) where.push(gte(orders.totalAmountMinor, BigInt(f.minTotal)));
    if (f.maxTotal !== undefined) where.push(lte(orders.totalAmountMinor, BigInt(f.maxTotal)));
    if (f.createdFrom) where.push(gte(orders.createdAt, new Date(f.createdFrom)));
    if (f.createdTo) where.push(lte(orders.createdAt, new Date(f.createdTo)));
    if (f.sandbox === 'exclude') where.push(isNull(orders.sandboxSessionId));
    if (f.sandbox === 'only') where.push(sql`${orders.sandboxSessionId} IS NOT NULL`);

    const predicate = where.length > 0 ? and(...where) : undefined;

    const order = {
      newest: [desc(orders.createdAt), desc(orders.id)],
      oldest: [asc(orders.createdAt), asc(orders.id)],
      total_desc: [desc(orders.totalAmountMinor), desc(orders.id)],
      total_asc: [asc(orders.totalAmountMinor), asc(orders.id)],
      updated: [desc(orders.updatedAt), desc(orders.id)],
    }[f.sort];

    const rows = await this.db
      .select({
        id: orders.id,
        publicRef: orders.publicRef,
        state: orders.state,
        totalAmountMinor: orders.totalAmountMinor,
        totalCurrency: orders.totalCurrency,
        sandboxSessionId: orders.sandboxSessionId,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
        customerId: customers.id,
        customerPhone: customers.phoneE164,
        customerName: customers.displayName,
        productSnapshot: quotes.productSnapshot,
        quantity: quotes.quantity,
        exceptionType: exceptions.type,
      })
      .from(orders)
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .leftJoin(quotes, eq(quotes.id, orders.quoteId))
      // Only unresolved exceptions, so the badge means "needs attention now" rather than
      // "once had a problem".
      .leftJoin(exceptions, and(eq(exceptions.orderId, orders.id), isNull(exceptions.resolvedAt)))
      .where(predicate)
      .orderBy(...order)
      .limit(f.limit)
      .offset(f.offset);

    const [counted] = await this.db
      .select({ total: sql<number>`count(DISTINCT ${orders.id})::int` })
      .from(orders)
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .where(predicate);

    return { rows, total: counted?.total ?? 0 };
  }

  async create(input: typeof orders.$inferInsert) {
    const [row] = await this.db.insert(orders).values({ ...input, id: input.id ?? uuidv7() }).returning();
    return row!;
  }

  /**
   * Apply a state transition and append its timeline entry.
   *
   * The version bump is part of the same UPDATE and is conditional on the expected version,
   * so two operators acting on one exception cannot both win: the second update matches zero
   * rows and raises a 412 rather than silently overwriting the first.
   *
   * The legality of the transition itself is decided by the state machine in the domain
   * layer before this is called — this method enforces concurrency, not policy.
   */
  async transition(input: OrderTransitionInput) {
    const where =
      input.expectedVersion === undefined
        ? eq(orders.id, input.orderId)
        : and(eq(orders.id, input.orderId), eq(orders.version, input.expectedVersion));

    const [updated] = await this.db
      .update(orders)
      .set({
        state: input.to as OrderStateValue,
        version: sql`${orders.version} + 1`,
        updatedAt: new Date(),
      })
      .where(where)
      .returning();

    if (!updated) {
      // Distinguish "gone" from "changed underneath you" — they need different client action.
      const exists = await this.findById(input.orderId);
      if (!exists) throw new NotFoundError('Order', input.orderId);
      throw new PreconditionFailedError('Order version mismatch', {
        details: { expected: input.expectedVersion, actual: exists.version },
      });
    }

    await this.db.insert(orderEvents).values({
      orderId: input.orderId,
      fromState: input.from as OrderStateValue,
      toState: input.to as OrderStateValue,
      actor: input.actor,
      reason: input.reason ?? null,
      payload: input.payload ?? null,
      correlationId: input.correlationId,
    });

    return updated;
  }

  async timeline(orderId: string) {
    return this.db
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.orderId, orderId))
      .orderBy(asc(orderEvents.seq));
  }

  /**
   * Cursor pagination.
   *
   * Keyset rather than OFFSET: the order list is written to constantly, and an OFFSET page
   * silently skips or repeats rows whenever something is inserted between two page fetches.
   */
  async listByCustomer(customerId: string, cursor: string | undefined, limit: number) {
    const conditions = [eq(orders.customerId, customerId)];
    if (cursor) conditions.push(lt(orders.id, cursor));

    const rows = await this.db
      .select()
      .from(orders)
      .where(and(...conditions))
      .orderBy(desc(orders.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
  }

  async updateMaxProcurement(orderId: string, max: Money) {
    await this.db
      .update(orders)
      .set({
        maxProcurementMinor: BigInt(max.amount),
        maxProcurementCurrency: max.currency,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId));
  }
}

// ─────────────────────────── payments ───────────────────────────

export class PaymentRepository {
  constructor(private readonly db: Executor) {}

  async create(input: typeof payments.$inferInsert) {
    const [row] = await this.db.insert(payments).values({ ...input, id: input.id ?? uuidv7() }).returning();
    return row!;
  }

  async findByProviderRef(provider: string, providerRef: string) {
    const [row] = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.provider, provider), eq(payments.providerRef, providerRef)))
      .limit(1);
    return row;
  }

  /**
   * Settle a payment, but only if it is not already settled.
   *
   * The `status <> 'SETTLED'` predicate is what makes a redelivered webhook a no-op: the
   * second call updates zero rows and returns undefined, so the caller skips the ledger post.
   */
  async settleOnce(id: string) {
    const [row] = await this.db
      .update(payments)
      .set({ status: 'SETTLED', settledAt: new Date() })
      .where(and(eq(payments.id, id), sql`${payments.status} <> 'SETTLED'`))
      .returning();
    return row;
  }

  async markFailed(id: string, reason: string) {
    await this.db.update(payments).set({ status: 'FAILED', failureReason: reason }).where(eq(payments.id, id));
  }

  async listByOrder(orderId: string) {
    return this.db.select().from(payments).where(eq(payments.orderId, orderId)).orderBy(desc(payments.createdAt));
  }
}

export class ProcurementRepository {
  constructor(private readonly db: Executor) {}

  async create(input: typeof procurementOrders.$inferInsert) {
    const [row] = await this.db
      .insert(procurementOrders)
      .values({ ...input, id: input.id ?? uuidv7() })
      .returning();
    return row!;
  }

  async findById(id: string) {
    const [row] = await this.db.select().from(procurementOrders).where(eq(procurementOrders.id, id)).limit(1);
    return row;
  }

  async requireById(id: string) {
    const row = await this.findById(id);
    if (!row) throw new NotFoundError('Procurement order', id);
    return row;
  }

  async listByOrder(orderId: string) {
    return this.db.select().from(procurementOrders).where(eq(procurementOrders.orderId, orderId));
  }

  async confirm(input: {
    id: string;
    externalOrderId: string;
    actualPrice: Money;
    confirmedBy: string;
  }) {
    const [row] = await this.db
      .update(procurementOrders)
      .set({
        status: 'PURCHASED',
        externalOrderId: input.externalOrderId,
        actualPriceMinor: BigInt(input.actualPrice.amount),
        confirmedBy: input.confirmedBy,
        confirmedAt: new Date(),
      })
      .where(and(eq(procurementOrders.id, input.id), sql`${procurementOrders.status} <> 'PURCHASED'`))
      .returning();
    return row;
  }

  async markFailed(id: string, reason: string) {
    await this.db
      .update(procurementOrders)
      .set({ status: 'FAILED', failureReason: reason })
      .where(eq(procurementOrders.id, id));
  }
}

// ─────────────────────────── shipments ───────────────────────────

export class ShipmentRepository {
  constructor(private readonly db: Executor) {}

  async create(input: typeof shipments.$inferInsert) {
    const [row] = await this.db.insert(shipments).values({ ...input, id: input.id ?? uuidv7() }).returning();
    return row!;
  }

  async findByOrder(orderId: string) {
    const [row] = await this.db.select().from(shipments).where(eq(shipments.orderId, orderId)).limit(1);
    return row;
  }

  /** Ignores duplicates via the (shipment, dedupeKey) unique index, so re-polling is safe. */
  async appendEvents(shipmentId: string, events: (typeof trackingEvents.$inferInsert)[]) {
    if (events.length === 0) return 0;

    const inserted = await this.db
      .insert(trackingEvents)
      .values(events)
      .onConflictDoNothing()
      .returning();

    if (inserted.length > 0) {
      await this.db
        .update(shipments)
        .set({ lastEventAt: new Date() })
        .where(eq(shipments.id, shipmentId));
    }
    return inserted.length;
  }

  async listEvents(shipmentId: string) {
    return this.db
      .select()
      .from(trackingEvents)
      .where(eq(trackingEvents.shipmentId, shipmentId))
      .orderBy(asc(trackingEvents.occurredAt));
  }

  /** Shipments with no tracking update inside the SLA — candidates for a stall exception. */
  async findStalled(slaHours: number) {
    const cutoff = new Date(Date.now() - slaHours * 3_600_000);
    return this.db
      .select()
      .from(shipments)
      .where(and(sql`${shipments.status} <> 'DELIVERED'`, lt(shipments.lastEventAt, cutoff)))
      .limit(100);
  }
}

// ─────────────────────────── ledger ───────────────────────────

export interface LedgerLine {
  readonly account: string;
  readonly debit?: Money;
  readonly credit?: Money;
  readonly memo?: string;
}

export class LedgerRepository {
  constructor(private readonly db: Executor) {}

  /**
   * Post a balanced group of entries.
   *
   * Balance is checked here for a fast, legible error, and again by a deferred constraint
   * trigger in the database. The application check is a convenience; the database check is
   * the guarantee, because it also covers code that has not been written yet.
   */
  async post(input: { refType: string; refId: string; lines: readonly LedgerLine[] }) {
    const txnId = uuidv7();

    const byCurrency = new Map<string, { debit: number; credit: number }>();
    for (const line of input.lines) {
      const currency = line.debit?.currency ?? line.credit?.currency;
      if (!currency) throw new Error('Ledger line must carry a debit or a credit');
      const acc = byCurrency.get(currency) ?? { debit: 0, credit: 0 };
      acc.debit += line.debit?.amount ?? 0;
      acc.credit += line.credit?.amount ?? 0;
      byCurrency.set(currency, acc);
    }

    for (const [currency, { debit, credit }] of byCurrency) {
      if (debit !== credit) {
        throw new Error(
          `Unbalanced ledger transaction in ${currency}: debits ${debit} != credits ${credit}`,
        );
      }
    }

    await this.db.insert(ledgerEntries).values(
      input.lines.map((line) => ({
        txnId,
        account: line.account,
        debitMinor: BigInt(line.debit?.amount ?? 0),
        creditMinor: BigInt(line.credit?.amount ?? 0),
        currency: (line.debit?.currency ?? line.credit!.currency) as Currency,
        refType: input.refType,
        refId: input.refId,
        memo: line.memo ?? null,
      })),
    );

    return txnId;
  }

  async balance(account: string, currency: Currency): Promise<Money> {
    const [row] = await this.db
      .select({
        debit: sql<string>`coalesce(sum(${ledgerEntries.debitMinor}), 0)`,
        credit: sql<string>`coalesce(sum(${ledgerEntries.creditMinor}), 0)`,
      })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.account, account), eq(ledgerEntries.currency, currency)));

    return Money.of(Number(row?.debit ?? 0) - Number(row?.credit ?? 0), currency);
  }

  async listByRef(refType: string, refId: string) {
    return this.db
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.refType, refType), eq(ledgerEntries.refId, refId)))
      .orderBy(asc(ledgerEntries.seq));
  }
}

// ─────────────────────────── ops ───────────────────────────

export class ExceptionRepository {
  constructor(private readonly db: Executor) {}

  async raise(input: typeof exceptions.$inferInsert) {
    const [row] = await this.db.insert(exceptions).values({ ...input, id: input.id ?? uuidv7() }).returning();
    return row!;
  }

  /** The back office's default view: open work only, most urgent first. */
  async listOpen(cursor: string | undefined, limit: number, type?: string) {
    const conditions = [isNull(exceptions.resolvedAt)];
    if (type) conditions.push(eq(exceptions.type, type));
    if (cursor) conditions.push(lt(exceptions.id, cursor));

    const rows = await this.db
      .select()
      .from(exceptions)
      .where(and(...conditions))
      .orderBy(desc(exceptions.rank), desc(exceptions.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
  }

  async resolve(id: string, note: string) {
    await this.db
      .update(exceptions)
      .set({ resolvedAt: new Date(), resolutionNote: note })
      .where(eq(exceptions.id, id));
  }

  async updateRanks(updates: readonly { id: string; rank: number; rankedBy: string }[]) {
    for (const u of updates) {
      await this.db
        .update(exceptions)
        .set({ rank: String(u.rank), rankedBy: u.rankedBy })
        .where(eq(exceptions.id, u.id));
    }
  }
}

// ─────────────────────────── infrastructure ───────────────────────────

export class OutboxRepository {
  constructor(private readonly db: Executor) {}

  /**
   * Claim a batch of unpublished events.
   *
   * `FOR UPDATE SKIP LOCKED` lets several relay replicas drain the outbox concurrently
   * without any of them blocking on or duplicating another's rows.
   */
  async claimBatch(limit: number) {
    return this.db.execute<{
      id: string;
      topic: string;
      aggregate_id: string;
      aggregate_type: string;
      payload: unknown;
      correlation_id: string;
      version: number;
      created_at: Date;
    }>(sql`
      SELECT id, topic, aggregate_id, aggregate_type, payload, correlation_id, version, created_at
      FROM outbox
      WHERE published_at IS NULL
      ORDER BY created_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `);
  }

  async markPublished(ids: readonly string[]) {
    if (ids.length === 0) return;
    await this.db.update(outbox).set({ publishedAt: new Date() }).where(inArray(outbox.id, [...ids]));
  }

  async markFailed(id: string, error: string) {
    await this.db
      .update(outbox)
      .set({ attempts: sql`${outbox.attempts} + 1`, lastError: error })
      .where(eq(outbox.id, id));
  }

  /** Oldest unpublished age, in seconds — the relay's lag metric. */
  async lagSeconds(): Promise<number> {
    const [row] = await this.db
      .select({ oldest: sql<string | null>`extract(epoch from (now() - min(created_at)))` })
      .from(outbox)
      .where(isNull(outbox.publishedAt));
    return Number(row?.oldest ?? 0);
  }
}

export class IdempotencyRepository {
  constructor(private readonly db: Executor) {}

  /**
   * Reserve a key, or return what happened last time.
   *
   * `onConflictDoNothing` makes the reservation atomic — two concurrent requests with the
   * same key cannot both believe they are first.
   */
  async reserve(input: {
    key: string;
    endpoint: string;
    requestHash: string;
    customerId?: string;
    ttlSeconds?: number;
  }): Promise<
    | { status: 'reserved' }
    | { status: 'replay'; responseStatus: number; responseBody: unknown }
    | { status: 'in-flight' }
    | { status: 'conflict' }
  > {
    const [inserted] = await this.db
      .insert(idempotencyKeys)
      .values({
        key: input.key,
        endpoint: input.endpoint,
        requestHash: input.requestHash,
        customerId: input.customerId ?? null,
        state: 'IN_FLIGHT',
        expiresAt: new Date(Date.now() + (input.ttlSeconds ?? 86_400) * 1000),
      })
      .onConflictDoNothing()
      .returning();

    if (inserted) return { status: 'reserved' };

    const [existing] = await this.db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, input.key))
      .limit(1);

    if (!existing) return { status: 'reserved' };

    // Same key, different body: a client bug worth surfacing, not silently answering.
    if (existing.requestHash !== input.requestHash) return { status: 'conflict' };

    if (existing.state === 'COMPLETED' && existing.responseStatus !== null) {
      return {
        status: 'replay',
        responseStatus: existing.responseStatus,
        responseBody: existing.responseBody,
      };
    }

    return { status: 'in-flight' };
  }

  async complete(key: string, responseStatus: number, responseBody: unknown) {
    await this.db
      .update(idempotencyKeys)
      .set({ state: 'COMPLETED', responseStatus, responseBody })
      .where(eq(idempotencyKeys.key, key));
  }

  /** Release a reservation whose request failed, so the client may genuinely retry. */
  async release(key: string) {
    await this.db.delete(idempotencyKeys).where(eq(idempotencyKeys.key, key));
  }

  async purgeExpired() {
    await this.db.delete(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, new Date()));
  }
}

/** Turns at-least-once delivery into effectively-once processing. */
export class ProcessedEventRepository {
  constructor(private readonly db: Executor) {}

  async markProcessed(eventId: string, consumer: string): Promise<boolean> {
    const [row] = await this.db
      .insert(processedEvents)
      .values({ eventId, consumer })
      .onConflictDoNothing()
      .returning();
    return row !== undefined; // false => already handled, skip
  }

  async purgeOlderThan(days: number) {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    await this.db.delete(processedEvents).where(lt(processedEvents.processedAt, cutoff));
  }
}

export { toMoney };
