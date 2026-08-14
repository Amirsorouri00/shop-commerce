import {
  pgTable,
  text,
  bigint,
  integer,
  boolean,
  timestamp,
  jsonb,
  uuid,
  index,
  uniqueIndex,
  primaryKey,
  bigserial,
  numeric,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { sql, relations } from 'drizzle-orm';

/**
 * Schema.
 *
 * Money is always a `bigint` of minor units plus an explicit currency column. There is no
 * `numeric` or `double precision` money column anywhere, because the moment one exists
 * somebody sums it and the ledger stops balancing.
 *
 * Three tables are append-only by design and have no UPDATE path in any repository:
 * `order_event`, `ledger_entry`, and `outbox` (which is only ever stamped as published).
 */

export const orderStateEnum = pgEnum('order_state', [
  'DRAFT',
  'QUOTING',
  'QUOTED',
  'AWAITING_PAYMENT',
  'PAID',
  'PROCUREMENT_PENDING',
  'PURCHASED',
  'SELLER_PROCESSING',
  'LOCAL_TRANSIT',
  'WAREHOUSE_RECEIVED',
  'INTERNATIONAL_TRANSIT',
  'CUSTOMS',
  'DOMESTIC_TRANSIT',
  'DELIVERED',
  'PRICE_CHANGED',
  'OUT_OF_STOCK',
  'PAYMENT_FAILED',
  'PROCUREMENT_FAILED',
  'CUSTOMER_ACTION_REQUIRED',
  'SHIPMENT_EXCEPTION',
  'CUSTOMS_EXCEPTION',
  'REFUND_PENDING',
  'REFUNDED',
  'CANCELLED',
]);

export const currencyEnum = pgEnum('currency', ['IRR', 'AED', 'USD', 'TRY', 'EUR', 'GBP']);

// ─────────────────────────── identity ───────────────────────────

export const customers = pgTable(
  'customer',
  {
    id: uuid('id').primaryKey(),
    phoneE164: text('phone_e164').notNull(),
    displayName: text('display_name'),
    locale: text('locale').notNull().default('fa'),
    /** Comparison-normalised name for search — see @xb/validation normalizeForComparison. */
    displayNameNormalized: text('display_name_normalized'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    phoneIdx: uniqueIndex('customer_phone_uq').on(t.phoneE164),
    nameIdx: index('customer_name_idx').on(t.displayNameNormalized),
  }),
);

/**
 * One row per (provider, subject). A customer can hold several — phone OTP today, Google
 * tomorrow — without the identity module knowing which providers exist.
 */
export const identities = pgTable(
  'identity',
  {
    id: uuid('id').primaryKey(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    subject: text('subject').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    providerSubjectIdx: uniqueIndex('identity_provider_subject_uq').on(t.provider, t.subject),
    customerIdx: index('identity_customer_idx').on(t.customerId),
  }),
);

/**
 * Refresh-token families.
 *
 * Rotation is tracked as a family so a *reused* token can revoke every descendant. A reused
 * refresh token means the token was captured; revoking only that one token leaves the thief
 * holding the newer one.
 */
export const refreshTokens = pgTable(
  'refresh_token',
  {
    id: uuid('id').primaryKey(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    hashIdx: uniqueIndex('refresh_token_hash_uq').on(t.tokenHash),
    familyIdx: index('refresh_token_family_idx').on(t.familyId),
  }),
);

export const otpChallenges = pgTable(
  'otp_challenge',
  {
    id: uuid('id').primaryKey(),
    phoneE164: text('phone_e164').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ phoneIdx: index('otp_phone_idx').on(t.phoneE164, t.createdAt) }),
);

export const addresses = pgTable(
  'address',
  {
    id: uuid('id').primaryKey(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    recipientName: text('recipient_name').notNull(),
    /** Required for customs clearance; a wrong one holds the parcel. */
    nationalId: text('national_id'),
    phoneE164: text('phone_e164').notNull(),
    province: text('province').notNull(),
    city: text('city').notNull(),
    line1: text('line1').notNull(),
    postalCode: text('postal_code').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ customerIdx: index('address_customer_idx').on(t.customerId) }),
);

// ─────────────────────────── catalog & quoting ───────────────────────────

export const productRequests = pgTable(
  'product_request',
  {
    id: uuid('id').primaryKey(),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    sourceUrl: text('source_url').notNull(),
    urlHash: text('url_hash').notNull(),
    marketplace: text('marketplace'),
    externalProductId: text('external_product_id'),
    status: text('status').notNull().default('PENDING'),
    failureReason: text('failure_reason'),
    /** Full ResolutionOutcome, including per-field provenance and which tiers ran. */
    resolution: jsonb('resolution'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    hashIdx: index('product_request_hash_idx').on(t.urlHash),
    customerIdx: index('product_request_customer_idx').on(t.customerId, t.createdAt),
  }),
);

export const quotes = pgTable(
  'quote',
  {
    id: uuid('id').primaryKey(),
    productRequestId: uuid('product_request_id')
      .notNull()
      .references(() => productRequests.id),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    /** Frozen product snapshot — the quote must not change if the listing does. */
    productSnapshot: jsonb('product_snapshot').notNull(),
    quantity: integer('quantity').notNull().default(1),
    /** Rate x 1e6, integer, so the exact rate used is reproducible from the row. */
    fxRateMicro: bigint('fx_rate_micro', { mode: 'bigint' }).notNull(),
    breakdown: jsonb('breakdown').notNull(),
    finalAmountMinor: bigint('final_amount_minor', { mode: 'bigint' }).notNull(),
    finalCurrency: currencyEnum('final_currency').notNull(),
    maxProcurementMinor: bigint('max_procurement_minor', { mode: 'bigint' }).notNull(),
    maxProcurementCurrency: currencyEnum('max_procurement_currency').notNull(),
    overheadRatio: numeric('overhead_ratio', { precision: 6, scale: 4 }).notNull(),
    riskFactor: numeric('risk_factor', { precision: 6, scale: 4 }).notNull().default('0'),
    viable: boolean('viable').notNull(),
    supersededByQuoteId: uuid('superseded_by_quote_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    customerIdx: index('quote_customer_idx').on(t.customerId, t.createdAt),
    expiryIdx: index('quote_expiry_idx').on(t.expiresAt),
  }),
);

// ─────────────────────────── orders ───────────────────────────

export const orders = pgTable(
  'order',
  {
    id: uuid('id').primaryKey(),
    publicRef: text('public_ref').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    quoteId: uuid('quote_id')
      .notNull()
      .references(() => quotes.id),
    addressId: uuid('address_id').references(() => addresses.id),
    state: orderStateEnum('state').notNull().default('DRAFT'),
    maxProcurementMinor: bigint('max_procurement_minor', { mode: 'bigint' }).notNull(),
    maxProcurementCurrency: currencyEnum('max_procurement_currency').notNull(),
    totalAmountMinor: bigint('total_amount_minor', { mode: 'bigint' }).notNull(),
    totalCurrency: currencyEnum('total_currency').notNull(),
    /** Optimistic concurrency — surfaced as the ETag, required as If-Match on mutations. */
    version: integer('version').notNull().default(1),
    /** Set when this order was produced inside a sandbox session, never in production data. */
    sandboxSessionId: text('sandbox_session_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    refIdx: uniqueIndex('order_public_ref_uq').on(t.publicRef),
    customerIdx: index('order_customer_idx').on(t.customerId, t.createdAt),
    stateIdx: index('order_state_idx').on(t.state, t.updatedAt),
    sandboxIdx: index('order_sandbox_idx').on(t.sandboxSessionId),
  }),
);

/**
 * The order timeline. Append-only: no repository exposes an update or delete.
 * This is the source of truth for tracking, audit and support.
 */
export const orderEvents = pgTable(
  'order_event',
  {
    seq: bigserial('seq', { mode: 'bigint' }).primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    fromState: orderStateEnum('from_state'),
    toState: orderStateEnum('to_state').notNull(),
    /** `system`, `worker:procurement`, or `operator:<id>` — never anonymous. */
    actor: text('actor').notNull(),
    reason: text('reason'),
    payload: jsonb('payload'),
    correlationId: text('correlation_id').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ orderIdx: index('order_event_order_idx').on(t.orderId, t.seq) }),
);

// ─────────────────────────── payments ───────────────────────────

export const payments = pgTable(
  'payment',
  {
    id: uuid('id').primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    provider: text('provider').notNull(),
    providerRef: text('provider_ref').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: currencyEnum('currency').notNull(),
    status: text('status').notNull().default('PENDING'),
    failureReason: text('failure_reason'),
    idempotencyKey: text('idempotency_key').notNull(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // The uniqueness that stops a redelivered webhook posting a second settlement.
    providerRefIdx: uniqueIndex('payment_provider_ref_uq').on(t.provider, t.providerRef),
    orderIdx: index('payment_order_idx').on(t.orderId),
  }),
);

export const procurementOrders = pgTable(
  'procurement_order',
  {
    id: uuid('id').primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    marketplace: text('marketplace').notNull(),
    externalProductId: text('external_product_id').notNull(),
    externalOrderId: text('external_order_id'),
    quantity: integer('quantity').notNull().default(1),
    expectedPriceMinor: bigint('expected_price_minor', { mode: 'bigint' }).notNull(),
    actualPriceMinor: bigint('actual_price_minor', { mode: 'bigint' }),
    currency: currencyEnum('currency').notNull(),
    status: text('status').notNull().default('PENDING'),
    failureReason: text('failure_reason'),
    /** Who authorised the spend. Assisted procurement always has a named human here. */
    confirmedBy: text('confirmed_by'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orderIdx: index('procurement_order_idx').on(t.orderId),
    statusIdx: index('procurement_status_idx').on(t.status, t.createdAt),
  }),
);

// ─────────────────────────── shipments ───────────────────────────

export const shipments = pgTable(
  'shipment',
  {
    id: uuid('id').primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    carrierShipmentId: text('carrier_shipment_id'),
    status: text('status').notNull().default('CREATED'),
    /** Used by the stall detector: no update in N hours raises a shipment exception. */
    lastEventAt: timestamp('last_event_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orderIdx: index('shipment_order_idx').on(t.orderId),
    stallIdx: index('shipment_stall_idx').on(t.status, t.lastEventAt),
  }),
);

export const trackingEvents = pgTable(
  'tracking_event',
  {
    seq: bigserial('seq', { mode: 'bigint' }).primaryKey(),
    shipmentId: uuid('shipment_id')
      .notNull()
      .references(() => shipments.id, { onDelete: 'cascade' }),
    /** Normalised lifecycle status — what the customer sees. */
    status: text('status').notNull(),
    /** The carrier's own wording. Kept for audit; never rendered to a customer. */
    rawStatus: text('raw_status').notNull(),
    location: jsonb('location'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    /** Dedupe key so re-polling the same carrier feed does not duplicate the timeline. */
    dedupeKey: text('dedupe_key').notNull(),
  },
  (t) => ({
    dedupeIdx: uniqueIndex('tracking_dedupe_uq').on(t.shipmentId, t.dedupeKey),
    shipmentIdx: index('tracking_shipment_idx').on(t.shipmentId, t.occurredAt),
  }),
);

// ─────────────────────────── finance ───────────────────────────

/**
 * Double-entry ledger. Append-only.
 *
 * Rows sharing a `txn_id` must balance per currency. That is asserted by a deferred
 * constraint trigger in the migration rather than by application code, so there is no code
 * path — including a future one written by someone who has not read this comment — that can
 * post a half-entry.
 */
export const ledgerEntries = pgTable(
  'ledger_entry',
  {
    seq: bigserial('seq', { mode: 'bigint' }).primaryKey(),
    txnId: uuid('txn_id').notNull(),
    account: text('account').notNull(),
    debitMinor: bigint('debit_minor', { mode: 'bigint' }).notNull().default(0n),
    creditMinor: bigint('credit_minor', { mode: 'bigint' }).notNull().default(0n),
    currency: currencyEnum('currency').notNull(),
    refType: text('ref_type').notNull(),
    refId: uuid('ref_id').notNull(),
    memo: text('memo'),
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    txnIdx: index('ledger_txn_idx').on(t.txnId),
    accountIdx: index('ledger_account_idx').on(t.account, t.postedAt),
    refIdx: index('ledger_ref_idx').on(t.refType, t.refId),
  }),
);

export const reconciliationItems = pgTable(
  'reconciliation_item',
  {
    id: uuid('id').primaryKey(),
    source: text('source').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: currencyEnum('currency').notNull(),
    externalRef: text('external_ref'),
    matchedOrderId: uuid('matched_order_id').references(() => orders.id),
    /** `exact_ref` posts automatically; `fuzzy` always waits for a human. */
    matchBasis: text('match_basis'),
    status: text('status').notNull().default('UNMATCHED'),
    candidates: jsonb('candidates'),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ statusIdx: index('recon_status_idx').on(t.status, t.observedAt) }),
);

// ─────────────────────────── ops ───────────────────────────

export const exceptions = pgTable(
  'exception',
  {
    id: uuid('id').primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    state: orderStateEnum('state').notNull(),
    marginAtRiskMinor: bigint('margin_at_risk_minor', { mode: 'bigint' }).notNull().default(0n),
    currency: currencyEnum('currency').notNull().default('IRR'),
    rank: numeric('rank', { precision: 12, scale: 4 }).notNull().default('0'),
    rankedBy: text('ranked_by').notNull().default('deterministic'),
    assignee: text('assignee'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionNote: text('resolution_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // The ops queue's primary read: open exceptions, highest rank first.
    openIdx: index('exception_open_idx').on(t.resolvedAt, t.rank),
    orderIdx: index('exception_order_idx').on(t.orderId),
  }),
);

export const operators = pgTable(
  'operator',
  {
    id: uuid('id').primaryKey(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    /** `ops`, `finance`, `admin`. Checked by the RBAC guard on every admin route. */
    role: text('role').notNull().default('ops'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ emailIdx: uniqueIndex('operator_email_uq').on(t.email) }),
);

// ─────────────────────────── infrastructure ───────────────────────────

/**
 * Transactional outbox.
 *
 * Written in the same transaction as the state change it describes, then relayed to
 * RabbitMQ by a worker. This is what makes "the state changed but the event never fired"
 * structurally impossible rather than merely unlikely.
 */
export const outbox = pgTable(
  'outbox',
  {
    id: uuid('id').primaryKey(),
    topic: text('topic').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    payload: jsonb('payload').notNull(),
    correlationId: text('correlation_id').notNull(),
    version: integer('version').notNull().default(1),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Partial index: the relay only ever scans unpublished rows, and this keeps that scan
    // proportional to the backlog rather than to the table.
    unpublishedIdx: index('outbox_unpublished_idx')
      .on(t.createdAt)
      .where(sql`published_at IS NULL`),
  }),
);

/**
 * Idempotency records.
 *
 * Stores the response so a replayed key returns byte-identical output. `requestHash` guards
 * against the same key being reused with a *different* body, which is a client bug worth
 * surfacing rather than silently serving the wrong cached answer.
 */
export const idempotencyKeys = pgTable(
  'idempotency_key',
  {
    key: text('key').primaryKey(),
    customerId: uuid('customer_id'),
    endpoint: text('endpoint').notNull(),
    requestHash: text('request_hash').notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    state: text('state').notNull().default('IN_FLIGHT'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => ({ expiryIdx: index('idempotency_expiry_idx').on(t.expiresAt) }),
);

/** Consumed message ids, so at-least-once delivery becomes effectively-once processing. */
export const processedEvents = pgTable(
  'processed_event',
  {
    eventId: text('event_id').notNull(),
    consumer: text('consumer').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.eventId, t.consumer] }) }),
);

export const fxSnapshots = pgTable(
  'fx_snapshot',
  {
    seq: bigserial('seq', { mode: 'bigint' }).primaryKey(),
    baseCurrency: currencyEnum('base_currency').notNull(),
    quoteCurrency: currencyEnum('quote_currency').notNull(),
    rateMicro: bigint('rate_micro', { mode: 'bigint' }).notNull(),
    source: text('source').notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  },
  (t) => ({ pairIdx: index('fx_pair_idx').on(t.baseCurrency, t.quoteCurrency, t.observedAt) }),
);

// ─────────────────────────── relations ───────────────────────────

export const customerRelations = relations(customers, ({ many }) => ({
  identities: many(identities),
  addresses: many(addresses),
  orders: many(orders),
}));

export const orderRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, { fields: [orders.customerId], references: [customers.id] }),
  quote: one(quotes, { fields: [orders.quoteId], references: [quotes.id] }),
  address: one(addresses, { fields: [orders.addressId], references: [addresses.id] }),
  events: many(orderEvents),
  payments: many(payments),
  procurements: many(procurementOrders),
  shipments: many(shipments),
  exceptions: many(exceptions),
}));

export const shipmentRelations = relations(shipments, ({ one, many }) => ({
  order: one(orders, { fields: [shipments.orderId], references: [orders.id] }),
  events: many(trackingEvents),
}));

export const schema = {
  customers,
  identities,
  refreshTokens,
  otpChallenges,
  addresses,
  productRequests,
  quotes,
  orders,
  orderEvents,
  payments,
  procurementOrders,
  shipments,
  trackingEvents,
  ledgerEntries,
  reconciliationItems,
  exceptions,
  operators,
  outbox,
  idempotencyKeys,
  processedEvents,
  fxSnapshots,
};
