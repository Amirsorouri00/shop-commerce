import type { OrderState } from '@xb/contracts';

/**
 * How each internal state is labelled and toned for a customer.
 *
 * The internal state names never reach the screen. `PROCUREMENT_PENDING` means nothing to a
 * customer; "در حال خرید" does. Keeping the mapping here rather than inline means the same
 * state reads identically on the list, the tracking page and any notification.
 */
export const STATE_BADGES: Readonly<
  Partial<Record<OrderState, { tone: 'badge-ok' | 'badge-warn' | 'badge-crit' | 'badge-neutral'; label: string }>>
> = {
  AWAITING_PAYMENT: { tone: 'badge-warn', label: 'در انتظار پرداخت' },
  PAID: { tone: 'badge-ok', label: 'پرداخت شد' },
  PROCUREMENT_PENDING: { tone: 'badge-ok', label: 'در حال خرید' },
  PURCHASED: { tone: 'badge-ok', label: 'خریداری شد' },
  SELLER_PROCESSING: { tone: 'badge-ok', label: 'آمادهٔ ارسال' },
  LOCAL_TRANSIT: { tone: 'badge-ok', label: 'در مسیر انبار' },
  WAREHOUSE_RECEIVED: { tone: 'badge-ok', label: 'در انبار' },
  INTERNATIONAL_TRANSIT: { tone: 'badge-ok', label: 'در مسیر ایران' },
  CUSTOMS: { tone: 'badge-warn', label: 'در گمرک' },
  DOMESTIC_TRANSIT: { tone: 'badge-ok', label: 'در حال تحویل' },
  DELIVERED: { tone: 'badge-ok', label: 'تحویل شد' },

  PRICE_CHANGED: { tone: 'badge-crit', label: 'تغییر قیمت' },
  OUT_OF_STOCK: { tone: 'badge-crit', label: 'ناموجود' },
  PAYMENT_FAILED: { tone: 'badge-crit', label: 'پرداخت ناموفق' },
  PROCUREMENT_FAILED: { tone: 'badge-crit', label: 'خرید ناموفق' },
  CUSTOMER_ACTION_REQUIRED: { tone: 'badge-warn', label: 'نیازمند اقدام شما' },
  SHIPMENT_EXCEPTION: { tone: 'badge-warn', label: 'تأخیر در ارسال' },
  CUSTOMS_EXCEPTION: { tone: 'badge-crit', label: 'توقف در گمرک' },
  REFUND_PENDING: { tone: 'badge-warn', label: 'در حال بازپرداخت' },
  REFUNDED: { tone: 'badge-neutral', label: 'بازپرداخت شد' },
  CANCELLED: { tone: 'badge-neutral', label: 'لغو شد' },
};
