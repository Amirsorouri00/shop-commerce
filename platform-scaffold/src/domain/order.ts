// Order aggregate + state machine. Every transition appends an immutable timeline event.

import { genId } from '../shared/kernel.ts';
import type { Money, DomainEvent } from '../shared/kernel.ts';

export const ORDER_STATES = [
  'DRAFT', 'QUOTING', 'QUOTED', 'AWAITING_PAYMENT', 'PAID',
  'PROCUREMENT_PENDING', 'PURCHASED', 'SELLER_PROCESSING', 'LOCAL_TRANSIT',
  'WAREHOUSE_RECEIVED', 'INTERNATIONAL_TRANSIT', 'CUSTOMS', 'DOMESTIC_TRANSIT',
  'DELIVERED',
  // exception / terminal
  'PRICE_CHANGED', 'OUT_OF_STOCK', 'PAYMENT_FAILED', 'PROCUREMENT_FAILED',
  'CUSTOMER_ACTION_REQUIRED', 'SHIPMENT_EXCEPTION', 'CUSTOMS_EXCEPTION',
  'REFUND_PENDING', 'REFUNDED', 'CANCELLED',
] as const;

export type OrderState = typeof ORDER_STATES[number];

// Allowed forward transitions (happy path + the exception branches we permit).
const TRANSITIONS: Record<string, OrderState[]> = {
  DRAFT: ['QUOTING'],
  QUOTING: ['QUOTED', 'OUT_OF_STOCK'],
  QUOTED: ['AWAITING_PAYMENT', 'PRICE_CHANGED'],
  AWAITING_PAYMENT: ['PAID', 'PAYMENT_FAILED', 'CANCELLED'],
  PAID: ['PROCUREMENT_PENDING'],
  PROCUREMENT_PENDING: ['PURCHASED', 'PRICE_CHANGED', 'OUT_OF_STOCK', 'PROCUREMENT_FAILED'],
  PURCHASED: ['SELLER_PROCESSING'],
  SELLER_PROCESSING: ['LOCAL_TRANSIT'],
  LOCAL_TRANSIT: ['WAREHOUSE_RECEIVED', 'SHIPMENT_EXCEPTION'],
  WAREHOUSE_RECEIVED: ['INTERNATIONAL_TRANSIT', 'SHIPMENT_EXCEPTION'],
  INTERNATIONAL_TRANSIT: ['CUSTOMS', 'SHIPMENT_EXCEPTION'],
  CUSTOMS: ['DOMESTIC_TRANSIT', 'CUSTOMS_EXCEPTION'],
  DOMESTIC_TRANSIT: ['DELIVERED', 'SHIPMENT_EXCEPTION'],
  // exception recoveries
  PRICE_CHANGED: ['PROCUREMENT_PENDING', 'REFUND_PENDING', 'CANCELLED'],
  PROCUREMENT_FAILED: ['PROCUREMENT_PENDING', 'REFUND_PENDING'],
  OUT_OF_STOCK: ['REFUND_PENDING', 'CANCELLED'],
  SHIPMENT_EXCEPTION: ['INTERNATIONAL_TRANSIT', 'DOMESTIC_TRANSIT', 'REFUND_PENDING'],
  CUSTOMS_EXCEPTION: ['DOMESTIC_TRANSIT', 'REFUND_PENDING'],
  REFUND_PENDING: ['REFUNDED'],
};

export interface TimelineEntry { state: OrderState; at: string; note?: string; }

export class Order {
  readonly id: string;
  readonly customerId: string;
  readonly quoteId: string;
  maxProcurementPrice: Money;
  state: OrderState;
  timeline: TimelineEntry[];

  constructor(customerId: string, quoteId: string, maxProcurementPrice: Money) {
    this.id = genId('ORD');
    this.customerId = customerId;
    this.quoteId = quoteId;
    this.maxProcurementPrice = maxProcurementPrice;
    this.state = 'DRAFT';
    this.timeline = [{ state: 'DRAFT', at: new Date().toISOString() }];
  }

  canTransition(to: OrderState): boolean {
    return (TRANSITIONS[this.state] ?? []).includes(to);
  }

  transition(to: OrderState, note?: string): void {
    if (!this.canTransition(to)) {
      throw new Error(`Illegal transition ${this.state} -> ${to}`);
    }
    this.state = to;
    this.timeline.push({ state: to, at: new Date().toISOString(), note });
  }
}

// Map raw carrier statuses -> order states (the "unified tracking" normalization).
export function carrierStatusToState(status: string): OrderState | null {
  const map: Record<string, OrderState> = {
    DISPATCHED_BY_SELLER: 'SELLER_PROCESSING',
    LOCAL_TRANSIT: 'LOCAL_TRANSIT',
    WAREHOUSE_RECEIVED: 'WAREHOUSE_RECEIVED',
    INTERNATIONAL_TRANSIT: 'INTERNATIONAL_TRANSIT',
    CUSTOMS: 'CUSTOMS',
    DOMESTIC_TRANSIT: 'DOMESTIC_TRANSIT',
    DELIVERED: 'DELIVERED',
  };
  return map[status] ?? null;
}
