/**
 * Domain events.
 *
 * These are the only way modules learn about each other. A module never imports another
 * module's service; it subscribes to its events. That constraint is what makes extracting
 * a module into its own service a transport change rather than a rewrite.
 *
 * Event names are `<aggregate>.<past-tense-verb>` and become AMQP routing keys verbatim,
 * so a consumer can bind `order.*` and get every order event including ones added later.
 */

export interface DomainEvent<TPayload = unknown> {
  /** Unique per event instance. Consumers dedupe on this — delivery is at-least-once. */
  readonly id: string;
  /** Routing key, e.g. `order.paid`. */
  readonly type: string;
  /** The aggregate this concerns, for correlation and for partitioning later. */
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly payload: TPayload;
  readonly occurredAt: string;
  /** Trace id from the request that caused this, so a worker's spans join the original trace. */
  readonly correlationId: string;
  /** Schema version, so a consumer can handle an old shape during a rolling deploy. */
  readonly version: number;
}

export const EVENT_TYPES = {
  CustomerRegistered: 'customer.registered',

  ProductRequested: 'product.requested',
  ProductResolved: 'product.resolved',
  ProductResolutionFailed: 'product.resolution_failed',

  QuoteCreated: 'quote.created',
  QuoteExpired: 'quote.expired',

  OrderCreated: 'order.created',
  OrderPaid: 'order.paid',
  OrderStateChanged: 'order.state_changed',
  OrderCancelled: 'order.cancelled',

  PaymentInitiated: 'payment.initiated',
  PaymentSettled: 'payment.settled',
  PaymentFailed: 'payment.failed',

  ProcurementRequired: 'procurement.required',
  ProcurementPurchased: 'procurement.purchased',
  ProcurementFailed: 'procurement.failed',

  ShipmentLegUpdated: 'shipment.leg_updated',
  ShipmentException: 'shipment.exception',

  ExceptionRaised: 'exception.raised',
  ExceptionResolved: 'exception.resolved',

  LedgerPosted: 'ledger.posted',
  ReconciliationUnmatched: 'reconciliation.unmatched',

  FxUpdated: 'fx.updated',
  NotificationRequested: 'notification.requested',
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

export interface EventEnvelopeInput<T> {
  readonly type: EventType;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly payload: T;
  readonly correlationId: string;
  readonly version?: number;
}

export function createEvent<T>(input: EventEnvelopeInput<T>, id: string): DomainEvent<T> {
  return {
    id,
    type: input.type,
    aggregateId: input.aggregateId,
    aggregateType: input.aggregateType,
    payload: input.payload,
    occurredAt: new Date().toISOString(),
    correlationId: input.correlationId,
    version: input.version ?? 1,
  };
}
