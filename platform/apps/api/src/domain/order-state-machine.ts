import { DomainErrors } from '@xb/core';
import type { OrderState, TimelineStep, LocalizedMessage } from '@xb/contracts';

/**
 * The order state machine.
 *
 * Framework-free on purpose: this is the most important logic in the system and it should be
 * testable without booting an HTTP server, a database, or a DI container.
 *
 * The transition table is the authority. A transition not listed here does not happen —
 * including one an operator asks for through the admin console, which is subject to exactly
 * the same table as the automated path.
 */

export const TRANSITIONS: Readonly<Record<OrderState, readonly OrderState[]>> = {
  DRAFT: ['QUOTING', 'CANCELLED'],
  QUOTING: ['QUOTED', 'OUT_OF_STOCK'],
  QUOTED: ['AWAITING_PAYMENT', 'PRICE_CHANGED', 'CANCELLED'],
  AWAITING_PAYMENT: ['PAID', 'PAYMENT_FAILED', 'CANCELLED'],
  // PAID goes only to PROCUREMENT_PENDING. Holding the customer's money says nothing about
  // whether the foreign purchase will succeed, so PAID -> PURCHASED is not a legal edge.
  PAID: ['PROCUREMENT_PENDING'],
  PROCUREMENT_PENDING: ['PURCHASED', 'PRICE_CHANGED', 'OUT_OF_STOCK', 'PROCUREMENT_FAILED'],
  PURCHASED: ['SELLER_PROCESSING', 'PROCUREMENT_FAILED'],
  SELLER_PROCESSING: ['LOCAL_TRANSIT', 'SHIPMENT_EXCEPTION'],
  LOCAL_TRANSIT: ['WAREHOUSE_RECEIVED', 'SHIPMENT_EXCEPTION'],
  WAREHOUSE_RECEIVED: ['INTERNATIONAL_TRANSIT', 'SHIPMENT_EXCEPTION'],
  INTERNATIONAL_TRANSIT: ['CUSTOMS', 'SHIPMENT_EXCEPTION'],
  CUSTOMS: ['DOMESTIC_TRANSIT', 'CUSTOMS_EXCEPTION'],
  DOMESTIC_TRANSIT: ['DELIVERED', 'SHIPMENT_EXCEPTION', 'CUSTOMER_ACTION_REQUIRED'],
  DELIVERED: [],

  PRICE_CHANGED: ['PROCUREMENT_PENDING', 'REFUND_PENDING', 'CANCELLED'],
  OUT_OF_STOCK: ['REFUND_PENDING', 'CANCELLED'],
  PAYMENT_FAILED: ['AWAITING_PAYMENT', 'CANCELLED'],
  PROCUREMENT_FAILED: ['PROCUREMENT_PENDING', 'REFUND_PENDING'],
  CUSTOMER_ACTION_REQUIRED: ['DOMESTIC_TRANSIT', 'REFUND_PENDING', 'CANCELLED'],
  SHIPMENT_EXCEPTION: [
    'LOCAL_TRANSIT',
    'WAREHOUSE_RECEIVED',
    'INTERNATIONAL_TRANSIT',
    'DOMESTIC_TRANSIT',
    'REFUND_PENDING',
  ],
  CUSTOMS_EXCEPTION: ['DOMESTIC_TRANSIT', 'CUSTOMER_ACTION_REQUIRED', 'REFUND_PENDING'],
  REFUND_PENDING: ['REFUNDED'],
  REFUNDED: [],
  CANCELLED: [],
};

export const EXCEPTION_STATES: readonly OrderState[] = [
  'PRICE_CHANGED',
  'OUT_OF_STOCK',
  'PAYMENT_FAILED',
  'PROCUREMENT_FAILED',
  'CUSTOMER_ACTION_REQUIRED',
  'SHIPMENT_EXCEPTION',
  'CUSTOMS_EXCEPTION',
];

export const TERMINAL_STATES: readonly OrderState[] = ['DELIVERED', 'REFUNDED', 'CANCELLED'];

export function canTransition(from: OrderState, to: OrderState): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

/** Throws rather than returning false — an illegal transition is never a recoverable branch. */
export function assertTransition(from: OrderState, to: OrderState): void {
  if (!canTransition(from, to)) throw DomainErrors.illegalTransition(from, to);
}

export function isException(state: OrderState): boolean {
  return EXCEPTION_STATES.includes(state);
}

export function isTerminal(state: OrderState): boolean {
  return TERMINAL_STATES.includes(state);
}

// ─────────────────────── carrier status normalisation ───────────────────────

/**
 * Map a carrier's own vocabulary onto our lifecycle.
 *
 * Carriers each invent their own status strings and change them without notice. Normalising
 * at the boundary means one unknown status from one forwarder cannot leak into a customer's
 * tracking page — it maps to null and is logged for a human to add.
 */
const CARRIER_STATUS_MAP: Readonly<Record<string, OrderState>> = {
  DISPATCHED_BY_SELLER: 'SELLER_PROCESSING',
  SHIPPED: 'SELLER_PROCESSING',
  PICKED_UP: 'LOCAL_TRANSIT',
  LOCAL_TRANSIT: 'LOCAL_TRANSIT',
  IN_TRANSIT_ORIGIN: 'LOCAL_TRANSIT',
  WAREHOUSE_RECEIVED: 'WAREHOUSE_RECEIVED',
  RECEIVED_AT_FACILITY: 'WAREHOUSE_RECEIVED',
  INTERNATIONAL_TRANSIT: 'INTERNATIONAL_TRANSIT',
  DEPARTED_ORIGIN_COUNTRY: 'INTERNATIONAL_TRANSIT',
  CUSTOMS: 'CUSTOMS',
  CUSTOMS_CLEARANCE: 'CUSTOMS',
  CUSTOMS_HOLD: 'CUSTOMS_EXCEPTION',
  CUSTOMS_EXCEPTION: 'CUSTOMS_EXCEPTION',
  DOMESTIC_TRANSIT: 'DOMESTIC_TRANSIT',
  OUT_FOR_DELIVERY: 'DOMESTIC_TRANSIT',
  DELIVERED: 'DELIVERED',
  DELIVERY_FAILED: 'CUSTOMER_ACTION_REQUIRED',
  SHIPMENT_EXCEPTION: 'SHIPMENT_EXCEPTION',
};

export function normalizeCarrierStatus(raw: string): OrderState | null {
  return CARRIER_STATUS_MAP[raw.toUpperCase().replace(/[\s-]+/g, '_')] ?? null;
}

// ─────────────────────── customer-facing projection ───────────────────────

/**
 * Project twenty-four internal states onto the eight steps a customer sees.
 *
 * Exceptions deliberately do not become steps. A customer whose parcel is held at customs
 * should see the journey they already understand, with a banner explaining the hold — not a
 * new mystery stage appearing in their timeline.
 */
const STEP_ORDER = [
  'CONFIRMED',
  'PURCHASED',
  'DISPATCHED',
  'AT_WAREHOUSE',
  'INTERNATIONAL',
  'ARRIVED_IRAN',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
] as const;

type StepKey = (typeof STEP_ORDER)[number];

const STEP_LABELS: Readonly<Record<StepKey, LocalizedMessage>> = {
  CONFIRMED: { en: 'Order confirmed', fa: 'سفارش ثبت شد' },
  PURCHASED: { en: 'Purchased for you', fa: 'خرید انجام شد' },
  DISPATCHED: { en: 'Dispatched by seller', fa: 'ارسال از سوی فروشنده' },
  AT_WAREHOUSE: { en: 'At our foreign warehouse', fa: 'در انبار ما در خارج از کشور' },
  INTERNATIONAL: { en: 'On its way to Iran', fa: 'در مسیر ایران' },
  ARRIVED_IRAN: { en: 'Arrived in Iran', fa: 'رسید به ایران' },
  OUT_FOR_DELIVERY: { en: 'Out for delivery', fa: 'در حال تحویل' },
  DELIVERED: { en: 'Delivered', fa: 'تحویل داده شد' },
};

/** How far along each internal state places the customer. */
const STATE_TO_STEP_INDEX: Readonly<Partial<Record<OrderState, number>>> = {
  AWAITING_PAYMENT: -1,
  PAID: 0,
  PROCUREMENT_PENDING: 0,
  PURCHASED: 1,
  SELLER_PROCESSING: 2,
  LOCAL_TRANSIT: 2,
  WAREHOUSE_RECEIVED: 3,
  INTERNATIONAL_TRANSIT: 4,
  CUSTOMS: 5,
  CUSTOMS_EXCEPTION: 5,
  DOMESTIC_TRANSIT: 6,
  DELIVERED: 7,
};

export interface TimelineInput {
  readonly state: OrderState;
  /** When each internal state was entered, from the append-only order_event table. */
  readonly stateTimestamps: Readonly<Partial<Record<OrderState, string>>>;
}

export function buildCustomerTimeline(input: TimelineInput): TimelineStep[] {
  const currentIndex = STATE_TO_STEP_INDEX[input.state] ?? -1;

  return STEP_ORDER.map((key, index) => {
    const occurredAt = firstTimestampForStep(index, input.stateTimestamps);

    let status: TimelineStep['status'];
    if (index < currentIndex) status = 'DONE';
    else if (index === currentIndex) status = 'CURRENT';
    else status = 'PENDING';

    return {
      key,
      label: STEP_LABELS[key],
      status,
      occurredAt: occurredAt ?? null,
    };
  });
}

function firstTimestampForStep(
  stepIndex: number,
  timestamps: Readonly<Partial<Record<OrderState, string>>>,
): string | undefined {
  for (const [state, index] of Object.entries(STATE_TO_STEP_INDEX) as [OrderState, number][]) {
    if (index === stepIndex && timestamps[state]) return timestamps[state];
  }
  return undefined;
}

// ─────────────────────── customer-facing alerts ───────────────────────

/**
 * What to tell the customer when an order is in an exception state.
 *
 * `actionable` decides whether the UI shows a call to action or simply reassures. Telling
 * someone their parcel is held and giving them no next step is worse than saying nothing.
 */
export interface OrderAlert {
  readonly code: string;
  readonly message: LocalizedMessage;
  readonly actionable: boolean;
}

const ALERTS: Readonly<Partial<Record<OrderState, OrderAlert>>> = {
  PRICE_CHANGED: {
    code: 'PRICE_CHANGED',
    message: {
      en: "The seller raised the price above what you approved. We've paused your order and will contact you with the options.",
      fa: 'فروشنده قیمت را بیش از مبلغ تأییدشدهٔ شما افزایش داده است. سفارش شما متوقف شد و گزینه‌ها را به شما اطلاع می‌دهیم.',
    },
    actionable: true,
  },
  OUT_OF_STOCK: {
    code: 'OUT_OF_STOCK',
    message: {
      en: 'This item sold out before we could buy it. Your refund is being processed.',
      fa: 'این کالا پیش از خرید ما ناموجود شد. بازپرداخت شما در حال انجام است.',
    },
    actionable: false,
  },
  PAYMENT_FAILED: {
    code: 'PAYMENT_FAILED',
    message: {
      en: "Your payment didn't go through. You can try again — nothing has been charged.",
      fa: 'پرداخت شما انجام نشد. می‌توانید دوباره تلاش کنید؛ مبلغی از حساب شما کسر نشده است.',
    },
    actionable: true,
  },
  PROCUREMENT_FAILED: {
    code: 'PROCUREMENT_FAILED',
    message: {
      en: "We couldn't complete the purchase. Our team is on it and will update you shortly.",
      fa: 'خرید این سفارش تکمیل نشد. تیم ما در حال بررسی است و به‌زودی به شما اطلاع می‌دهد.',
    },
    actionable: false,
  },
  CUSTOMS_EXCEPTION: {
    code: 'CUSTOMS_EXCEPTION',
    message: {
      en: 'Your parcel is held at customs. We may need a document from you — we will be in touch.',
      fa: 'مرسولهٔ شما در گمرک متوقف شده است. ممکن است به مدرکی از شما نیاز باشد؛ با شما تماس می‌گیریم.',
    },
    actionable: true,
  },
  SHIPMENT_EXCEPTION: {
    code: 'SHIPMENT_EXCEPTION',
    message: {
      en: "Your parcel hasn't moved for longer than expected. We're chasing the carrier.",
      fa: 'مرسولهٔ شما بیش از حد انتظار بدون حرکت مانده است. در حال پیگیری با شرکت حمل هستیم.',
    },
    actionable: false,
  },
  CUSTOMER_ACTION_REQUIRED: {
    code: 'CUSTOMER_ACTION_REQUIRED',
    message: {
      en: 'We need something from you to finish delivery. Please check your messages.',
      fa: 'برای تکمیل تحویل به اطلاعاتی از شما نیاز داریم. لطفاً پیام‌های خود را بررسی کنید.',
    },
    actionable: true,
  },
  REFUND_PENDING: {
    code: 'REFUND_PENDING',
    message: {
      en: 'Your refund is being processed and will arrive within a few business days.',
      fa: 'بازپرداخت شما در حال انجام است و ظرف چند روز کاری واریز می‌شود.',
    },
    actionable: false,
  },
};

export function alertFor(state: OrderState): OrderAlert | null {
  return ALERTS[state] ?? null;
}
