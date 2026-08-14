/**
 * Sandbox scenarios.
 *
 * A demo that only shows the happy path is worse than no demo: it teaches everyone —
 * including the team building it — that the exception paths are hypothetical. The exception
 * paths are where this business actually lives, so they get first-class scenarios.
 *
 * Each scenario is a declarative description of how the gated adapters should behave at each
 * stage. Nothing here is random unless a scenario asks for it, and even then the randomness
 * is seeded per session, so a demo replays identically every time.
 */

export type ScenarioId =
  | 'HAPPY_PATH'
  | 'SLOW_RESOLUTION'
  | 'RESOLUTION_NEEDS_REVIEW'
  | 'UNSUPPORTED_PRODUCT'
  | 'PRICE_DRIFT_WITHIN_TOLERANCE'
  | 'PRICE_CHANGED_BREACH'
  | 'OUT_OF_STOCK_AT_PROCUREMENT'
  | 'PAYMENT_DECLINED'
  | 'PAYMENT_GATEWAY_TIMEOUT'
  | 'CUSTOMS_HOLD'
  | 'SHIPMENT_STALLED'
  | 'FX_PROVIDER_DOWN';

export type PaymentBehaviour =
  | 'settle'
  | 'decline'
  | 'timeout-then-settle'
  | 'timeout-permanent';

export interface ScenarioDefinition {
  readonly id: ScenarioId;
  readonly title: { readonly en: string; readonly fa: string };
  readonly description: { readonly en: string; readonly fa: string };
  /** Which part of the journey this scenario is meant to exercise. */
  readonly stage: 'resolution' | 'quote' | 'checkout' | 'procurement' | 'fulfilment';

  // ── resolution ──
  /** Artificial delay before resolution answers, in virtual ms. */
  readonly resolveDelayMs: number;
  /** Which tier answers, so the demo can show the escalation ladder working. */
  readonly resolveTier: 'api' | 'structured' | 'vision' | 'manual';
  readonly resolveOutcome: 'RESOLVED' | 'NEEDS_REVIEW' | 'FAILED';
  readonly productAvailable: boolean;

  // ── quote / fx ──
  readonly fxAvailable: boolean;

  // ── checkout ──
  readonly payment: PaymentBehaviour;

  // ── procurement ──
  /**
   * Multiplier applied to the resolved price when procurement re-checks the live offer.
   * 1.0 = unchanged. 1.15 = the seller raised the price 15% since the quote.
   */
  readonly procurementPriceMultiplier: number;
  readonly availableAtProcurement: boolean;

  // ── fulfilment ──
  /** Legs that will be emitted as the clock advances, in order. */
  readonly shipmentLegs: readonly ShipmentLegScript[];
  /** A leg index after which tracking stops updating, to demo stall detection. */
  readonly stallAfterLegIndex: number | undefined;
}

export interface ShipmentLegScript {
  readonly status: string;
  /** Virtual hours after purchase when this leg occurs. */
  readonly atHoursAfterPurchase: number;
  readonly location: { readonly en: string; readonly fa: string };
  /** Marks a leg that should raise an exception rather than advance the order. */
  readonly raisesException?: 'CUSTOMS_EXCEPTION' | 'SHIPMENT_EXCEPTION';
}

const STANDARD_LEGS: readonly ShipmentLegScript[] = [
  {
    status: 'DISPATCHED_BY_SELLER',
    atHoursAfterPurchase: 6,
    location: { en: 'Dubai, UAE', fa: 'دبی، امارات' },
  },
  {
    status: 'LOCAL_TRANSIT',
    atHoursAfterPurchase: 18,
    location: { en: 'Dubai, UAE', fa: 'دبی، امارات' },
  },
  {
    status: 'WAREHOUSE_RECEIVED',
    atHoursAfterPurchase: 30,
    location: { en: 'Consolidation warehouse, Dubai', fa: 'انبار تجمیع، دبی' },
  },
  {
    status: 'INTERNATIONAL_TRANSIT',
    atHoursAfterPurchase: 54,
    location: { en: 'In transit to Iran', fa: 'در مسیر ایران' },
  },
  {
    status: 'CUSTOMS',
    atHoursAfterPurchase: 78,
    location: { en: 'Tehran customs', fa: 'گمرک تهران' },
  },
  {
    status: 'DOMESTIC_TRANSIT',
    atHoursAfterPurchase: 102,
    location: { en: 'Tehran', fa: 'تهران' },
  },
  {
    status: 'DELIVERED',
    atHoursAfterPurchase: 120,
    location: { en: 'Delivered', fa: 'تحویل شد' },
  },
];

/** Defaults every scenario starts from, so a scenario only declares what it changes. */
const BASE: Omit<ScenarioDefinition, 'id' | 'title' | 'description' | 'stage'> = {
  resolveDelayMs: 400,
  resolveTier: 'api',
  resolveOutcome: 'RESOLVED',
  productAvailable: true,
  fxAvailable: true,
  payment: 'settle',
  procurementPriceMultiplier: 1,
  availableAtProcurement: true,
  shipmentLegs: STANDARD_LEGS,
  stallAfterLegIndex: undefined,
};

export const SCENARIOS: Readonly<Record<ScenarioId, ScenarioDefinition>> = {
  HAPPY_PATH: {
    ...BASE,
    id: 'HAPPY_PATH',
    stage: 'fulfilment',
    title: { en: 'Happy path', fa: 'مسیر بدون خطا' },
    description: {
      en: 'Resolves from the API, pays first time, purchases within tolerance, delivers in five days.',
      fa: 'کالا از طریق API شناسایی می‌شود، پرداخت موفق است و سفارش ظرف پنج روز تحویل می‌شود.',
    },
  },

  SLOW_RESOLUTION: {
    ...BASE,
    id: 'SLOW_RESOLUTION',
    stage: 'resolution',
    title: { en: 'Vision fallback', fa: 'بازگشت به مدل تصویری' },
    description: {
      en: 'The product API has no data, so resolution escalates to the vision model. Slower, and weight confidence is lower.',
      fa: 'داده‌ای از API در دسترس نیست و شناسایی به مدل تصویری ارتقا می‌یابد. کندتر است و اطمینان وزن کمتر خواهد بود.',
    },
    resolveDelayMs: 3_500,
    resolveTier: 'vision',
  },

  RESOLUTION_NEEDS_REVIEW: {
    ...BASE,
    id: 'RESOLUTION_NEEDS_REVIEW',
    stage: 'resolution',
    title: { en: 'Needs operator review', fa: 'نیازمند بررسی اپراتور' },
    description: {
      en: 'Every automated tier leaves the shipping weight below the confidence floor, so the request lands in the operator queue.',
      fa: 'هیچ‌یک از لایه‌های خودکار وزن قابل اتکایی به دست نمی‌آورد و درخواست به صف اپراتور منتقل می‌شود.',
    },
    resolveTier: 'vision',
    resolveOutcome: 'NEEDS_REVIEW',
  },

  UNSUPPORTED_PRODUCT: {
    ...BASE,
    id: 'UNSUPPORTED_PRODUCT',
    stage: 'resolution',
    title: { en: 'Product unavailable', fa: 'کالا موجود نیست' },
    description: {
      en: 'The listing exists but the seller has it out of stock, so no quote is offered.',
      fa: 'کالا در فروشگاه موجود نیست، بنابراین پیش‌فاکتوری صادر نمی‌شود.',
    },
    productAvailable: false,
    resolveOutcome: 'RESOLVED',
  },

  PRICE_DRIFT_WITHIN_TOLERANCE: {
    ...BASE,
    id: 'PRICE_DRIFT_WITHIN_TOLERANCE',
    stage: 'procurement',
    title: { en: 'Small price rise, absorbed', fa: 'افزایش جزئی قیمت' },
    description: {
      en: 'The seller raises the price 1.5% before purchase. That is inside the authorised ceiling, so the order proceeds untouched.',
      fa: 'فروشنده پیش از خرید قیمت را ۱٫۵٪ افزایش می‌دهد. این مقدار درون سقف مجاز است و سفارش بدون تغییر ادامه می‌یابد.',
    },
    procurementPriceMultiplier: 1.015,
  },

  PRICE_CHANGED_BREACH: {
    ...BASE,
    id: 'PRICE_CHANGED_BREACH',
    stage: 'procurement',
    title: { en: 'Price rise breaches the guard', fa: 'عبور قیمت از سقف مجاز' },
    description: {
      en: 'The seller raises the price 18%. The guard stops the purchase and the order branches to PRICE_CHANGED for an operator decision.',
      fa: 'فروشنده قیمت را ۱۸٪ افزایش می‌دهد. سازوکار محافظ خرید را متوقف می‌کند و سفارش برای تصمیم اپراتور به وضعیت «تغییر قیمت» می‌رود.',
    },
    procurementPriceMultiplier: 1.18,
  },

  OUT_OF_STOCK_AT_PROCUREMENT: {
    ...BASE,
    id: 'OUT_OF_STOCK_AT_PROCUREMENT',
    stage: 'procurement',
    title: { en: 'Sold out after payment', fa: 'اتمام موجودی پس از پرداخت' },
    description: {
      en: 'The customer has paid, and the item sells out before we buy it. The order moves to refund.',
      fa: 'مشتری پرداخت کرده و کالا پیش از خرید ما تمام می‌شود. سفارش به مسیر بازپرداخت می‌رود.',
    },
    availableAtProcurement: false,
  },

  PAYMENT_DECLINED: {
    ...BASE,
    id: 'PAYMENT_DECLINED',
    stage: 'checkout',
    title: { en: 'Payment declined', fa: 'پرداخت ناموفق' },
    description: {
      en: 'The gateway declines the charge. The order stays awaiting payment and the customer can retry on the same gateway.',
      fa: 'درگاه پرداخت تراکنش را رد می‌کند. سفارش در انتظار پرداخت می‌ماند و مشتری می‌تواند دوباره تلاش کند.',
    },
    payment: 'decline',
  },

  PAYMENT_GATEWAY_TIMEOUT: {
    ...BASE,
    id: 'PAYMENT_GATEWAY_TIMEOUT',
    stage: 'checkout',
    title: { en: 'Gateway times out, then settles', fa: 'وقفهٔ درگاه و تسویهٔ بعدی' },
    description: {
      en: 'The gateway times out but settles later by webhook — the case that makes idempotency and reconciliation necessary rather than optional.',
      fa: 'درگاه ابتدا پاسخ نمی‌دهد اما بعداً از طریق وب‌هوک تسویه می‌کند؛ همان حالتی که «کلید یکتا» و مغایرت‌گیری را ضروری می‌کند.',
    },
    payment: 'timeout-then-settle',
  },

  CUSTOMS_HOLD: {
    ...BASE,
    id: 'CUSTOMS_HOLD',
    stage: 'fulfilment',
    title: { en: 'Held at customs', fa: 'توقف در گمرک' },
    description: {
      en: 'The parcel is held at Tehran customs pending documents. Raises a customs exception in the ops queue.',
      fa: 'مرسوله برای ارائهٔ مدارک در گمرک تهران متوقف می‌شود و استثنای گمرکی در صف عملیات ثبت می‌گردد.',
    },
    shipmentLegs: STANDARD_LEGS.map((leg, i) =>
      i === 4 ? { ...leg, raisesException: 'CUSTOMS_EXCEPTION' as const } : leg,
    ),
  },

  SHIPMENT_STALLED: {
    ...BASE,
    id: 'SHIPMENT_STALLED',
    stage: 'fulfilment',
    title: { en: 'Tracking goes quiet', fa: 'توقف به‌روزرسانی رهگیری' },
    description: {
      en: 'Tracking stops updating mid-transit. After the SLA elapses the stall detector raises a shipment exception.',
      fa: 'به‌روزرسانی رهگیری در میانهٔ مسیر متوقف می‌شود و پس از پایان مهلت، استثنای حمل ثبت می‌گردد.',
    },
    stallAfterLegIndex: 3,
  },

  FX_PROVIDER_DOWN: {
    ...BASE,
    id: 'FX_PROVIDER_DOWN',
    stage: 'quote',
    title: { en: 'FX providers unavailable', fa: 'قطع سرویس نرخ ارز' },
    description: {
      en: 'Every FX source fails and the cached snapshot is past its maximum age, so the system refuses to quote rather than guess a rate.',
      fa: 'همهٔ منابع نرخ ارز از کار می‌افتند و نرخ ذخیره‌شده کهنه است؛ سامانه به‌جای حدس زدن نرخ، از صدور قیمت خودداری می‌کند.',
    },
    fxAvailable: false,
  },
};

export function getScenario(id: ScenarioId): ScenarioDefinition {
  return SCENARIOS[id];
}

export function listScenarios(): ScenarioDefinition[] {
  return Object.values(SCENARIOS);
}
