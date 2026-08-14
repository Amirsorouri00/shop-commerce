import { z } from 'zod';
import {
  iranianMobile,
  otpCode,
  marketplaceUrl,
  nationalId,
  postalCode,
  displayText,
  moneySchema,
  paginationSchema,
} from '@xb/validation';

/**
 * The API contract.
 *
 * This module is the single source of truth. The API validates requests with these schemas,
 * the handler's parameter types are inferred from them, both frontends import the inferred
 * response types, and the OpenAPI document is generated from them.
 *
 * Because all four derive from one definition, a change to a field is a compile error in
 * every place that consumed it rather than a runtime surprise in one of them.
 */

// ─────────────────────────── shared ───────────────────────────

export const localizedMessageSchema = z.object({ en: z.string(), fa: z.string() });

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: localizedMessageSchema,
    traceId: z.string(),
    issues: z
      .array(
        z.object({
          path: z.string(),
          code: z.string(),
          params: z.record(z.unknown()).optional(),
          message: localizedMessageSchema,
        }),
      )
      .optional(),
  }),
});

export const pageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

export { moneySchema, paginationSchema };

// ─────────────────────────── auth ───────────────────────────

export const otpStartRequest = z.object({ phone: iranianMobile });
export const otpStartResponse = z.object({
  challengeId: z.string().uuid(),
  expiresAt: z.string(),
  resendAfter: z.number().int(),
});

export const otpVerifyRequest = z.object({
  challengeId: z.string().uuid(),
  code: otpCode,
});

export const customerSchema = z.object({
  id: z.string().uuid(),
  phone: z.string(),
  displayName: z.string().nullable(),
  locale: z.enum(['fa', 'en']),
});

export const tokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int(),
  customer: customerSchema,
});

export const refreshRequest = z.object({ refreshToken: z.string().min(10) });

export const operatorLoginRequest = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const operatorSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  displayName: z.string(),
  role: z.enum(['ops', 'finance', 'admin']),
});

export const operatorTokenSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
  operator: operatorSchema,
});

// ─────────────────────────── addresses ───────────────────────────

export const createAddressRequest = z.object({
  recipientName: displayText(120),
  nationalId: nationalId.optional(),
  phone: iranianMobile,
  province: displayText(60),
  city: displayText(60),
  line1: displayText(300),
  postalCode,
  isDefault: z.boolean().default(false),
});

export const addressSchema = z.object({
  id: z.string().uuid(),
  recipientName: z.string(),
  phone: z.string(),
  province: z.string(),
  city: z.string(),
  line1: z.string(),
  postalCode: z.string(),
  isDefault: z.boolean(),
});

// ─────────────────────────── catalog ───────────────────────────

export const createProductRequestBody = z.object({ url: marketplaceUrl });

export const fieldConfidenceSchema = z.object({
  tier: z.enum(['api', 'structured', 'vision', 'manual']),
  strategy: z.string(),
  confidence: z.number(),
});

export const resolvedProductSchema = z.object({
  marketplace: z.string(),
  externalProductId: z.string(),
  canonicalUrl: z.string(),
  title: z.string(),
  seller: z.string(),
  brand: z.string().nullable(),
  variant: z.string().nullable(),
  imageUrl: z.string().nullable(),
  price: moneySchema,
  available: z.boolean(),
  weightKg: z.number(),
  category: z.string(),
  route: z.string(),
  /** Per-field provenance — the UI shows a warning when a field came from an estimate. */
  provenance: z.record(fieldConfidenceSchema).optional(),
});

export const productRequestSchema = z.object({
  id: z.string().uuid(),
  url: z.string(),
  status: z.enum(['PENDING', 'RESOLVED', 'NEEDS_REVIEW', 'FAILED']),
  product: resolvedProductSchema.nullable(),
  failureReason: z.string().nullable(),
  /** Present when resolution needed review, so the UI can explain what is uncertain. */
  missingFields: z.array(z.string()).default([]),
});

// ─────────────────────────── quotes ───────────────────────────

export const createQuoteRequest = z.object({
  requestId: z.string().uuid(),
  quantity: z.number().int().min(1).max(10).default(1),
  variant: z.string().max(120).optional(),
});

export const quoteBreakdownSchema = z.object({
  product: moneySchema,
  freight: moneySchema,
  handling: moneySchema,
  lastMile: moneySchema,
  customs: moneySchema,
  insurance: moneySchema,
  serviceFee: moneySchema,
});

export const quoteSchema = z.object({
  id: z.string().uuid(),
  productSnapshot: resolvedProductSchema,
  quantity: z.number().int(),
  fxRate: z.number(),
  breakdown: quoteBreakdownSchema,
  finalPrice: moneySchema,
  maxProcurementPrice: moneySchema,
  overheadRatio: z.number(),
  riskFactor: z.number(),
  viable: z.boolean(),
  createdAt: z.string(),
  expiresAt: z.string(),
});

// ─────────────────────────── orders ───────────────────────────

export const orderStateSchema = z.enum([
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

/** The eight customer-facing steps. Internal states never reach the customer. */
export const timelineStepSchema = z.object({
  key: z.enum([
    'CONFIRMED',
    'PURCHASED',
    'DISPATCHED',
    'AT_WAREHOUSE',
    'INTERNATIONAL',
    'ARRIVED_IRAN',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
  ]),
  label: localizedMessageSchema,
  status: z.enum(['DONE', 'CURRENT', 'PENDING']),
  occurredAt: z.string().nullable(),
});

export const createOrderRequest = z.object({
  quoteId: z.string().uuid(),
  addressId: z.string().uuid(),
  note: z.string().max(500).optional(),
});

export const orderSummarySchema = z.object({
  id: z.string().uuid(),
  publicRef: z.string(),
  state: orderStateSchema,
  title: z.string(),
  imageUrl: z.string().nullable(),
  finalPrice: moneySchema,
  createdAt: z.string(),
});

export const orderSchema = z.object({
  id: z.string().uuid(),
  publicRef: z.string(),
  state: orderStateSchema,
  version: z.number().int(),
  quote: quoteSchema,
  timeline: z.array(timelineStepSchema),
  alert: z
    .object({
      code: z.string(),
      message: localizedMessageSchema,
      actionable: z.boolean(),
    })
    .nullable(),
  createdAt: z.string(),
});

export const startPaymentResponse = z.object({
  paymentId: z.string().uuid(),
  provider: z.string(),
  redirectUrl: z.string(),
  expiresAt: z.string(),
});

// ─────────────────────────── admin ───────────────────────────

export const exceptionItemSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  publicRef: z.string(),
  type: z.string(),
  state: orderStateSchema,
  marginAtRisk: moneySchema,
  ageMinutes: z.number().int(),
  rank: z.number(),
  rankedBy: z.enum(['model', 'deterministic']),
  assignee: z.string().nullable(),
  summary: localizedMessageSchema,
});

/**
 * Operator order search.
 *
 * The exception queue answers "what needs me now" and deliberately hides healthy orders. This
 * answers the other question an operator has — "where is the order this person is asking me
 * about" — which is a lookup, not a work queue, and needs different tools: free text, state,
 * money band, date range.
 *
 * Every field is optional. No filter means the most recent orders, which is the useful
 * default for someone who just wants to see what is happening.
 */
export const adminOrderSearchQuery = z.object({
  /** Public reference (`XB-…`), order id, customer phone, or customer name. */
  q: z.string().trim().min(1).max(120).optional(),
  /** Repeatable. Several states at once is the common case — "anything still unpaid". */
  state: z.array(orderStateSchema).optional(),
  customerId: z.string().uuid().optional(),
  /** Inclusive bounds on the order total, in minor units of its own currency. */
  minTotal: z.coerce.number().int().nonnegative().optional(),
  maxTotal: z.coerce.number().int().nonnegative().optional(),
  /** Inclusive ISO date-times on order creation. */
  createdFrom: z.string().datetime().optional(),
  createdTo: z.string().datetime().optional(),
  /**
   * Sandbox orders are real rows produced by demo sessions. An operator looking for a
   * customer's order almost never wants them, so they are excluded unless asked for.
   */
  sandbox: z.enum(['exclude', 'only', 'include']).default('exclude'),
  sort: z.enum(['newest', 'oldest', 'total_desc', 'total_asc', 'updated']).default('newest'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export const adminOrderRowSchema = z.object({
  id: z.string().uuid(),
  publicRef: z.string(),
  state: orderStateSchema,
  total: moneySchema,
  productTitle: z.string(),
  quantity: z.number().int(),
  marketplace: z.string(),
  customer: z.object({
    id: z.string().uuid(),
    phone: z.string(),
    displayName: z.string().nullable(),
  }),
  isSandbox: z.boolean(),
  /** Present only when the order currently has an unresolved exception. */
  exceptionType: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const adminOrderSearchResultSchema = z.object({
  items: z.array(adminOrderRowSchema),
  /** Total matching rows, not the page size — an operator needs to know if 3 or 300 matched. */
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

export const procurementCopilotSchema = z.object({
  procurementId: z.string().uuid(),
  orderId: z.string().uuid(),
  publicRef: z.string(),
  marketplace: z.string(),
  productTitle: z.string(),
  productUrl: z.string(),
  quantity: z.number().int(),
  expectedPrice: moneySchema,
  currentPrice: moneySchema,
  maxAuthorised: moneySchema,
  withinGuard: z.boolean(),
  marginIfProceed: moneySchema,
  recommendation: z.object({
    action: z.enum(['PROCEED', 'HOLD', 'REFUND', 'CONTACT_CUSTOMER']),
    rationale: localizedMessageSchema,
  }),
});

export const confirmProcurementRequest = z.object({
  externalOrderId: z.string().min(1).max(120),
  actualPaid: moneySchema,
  note: z.string().max(500).optional(),
});

export const transitionOrderRequest = z.object({
  to: orderStateSchema,
  reason: z.string().min(3).max(500),
});

export const repriceOrderRequest = z.object({
  newMaxPrice: moneySchema,
  reason: z.string().min(3).max(500),
});

export const providerHealthSchema = z.object({
  port: z.string(),
  provider: z.string(),
  state: z.enum(['HEALTHY', 'DEGRADED', 'QUARANTINED', 'PROBING']),
  priority: z.number().int(),
  lastError: z.string().nullable(),
});

export const ledgerEntrySchema = z.object({
  seq: z.string(),
  txnId: z.string().uuid(),
  account: z.string(),
  debit: z.number(),
  credit: z.number(),
  currency: z.string(),
  refType: z.string(),
  refId: z.string(),
  postedAt: z.string(),
});

// ─────────────────────────── sandbox ───────────────────────────

export const sandboxScenarioSchema = z.object({
  id: z.string(),
  stage: z.enum(['resolution', 'quote', 'checkout', 'procurement', 'fulfilment']),
  title: localizedMessageSchema,
  description: localizedMessageSchema,
});

export const createSandboxSessionRequest = z.object({
  scenarioId: z.string(),
  seed: z.number().int().optional(),
});

export const sandboxLogEntrySchema = z.object({
  at: z.string(),
  stage: z.string(),
  message: localizedMessageSchema,
  detail: z.record(z.unknown()).optional(),
});

export const sandboxSessionSchema = z.object({
  id: z.string(),
  scenarioId: z.string(),
  seed: z.number().int(),
  virtualOffsetMs: z.number(),
  virtualNow: z.string(),
  hoursSincePurchase: z.number().nullable(),
  log: z.array(sandboxLogEntrySchema),
  counters: z.record(z.number()),
});

export const advanceSandboxRequest = z.object({
  /** Hours to fast-forward. The demo control offers +6h, +24h, +72h. */
  hours: z.number().min(0).max(24 * 30),
});

// ─────────────────────────── inferred types ───────────────────────────

export type LocalizedMessage = z.infer<typeof localizedMessageSchema>;
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
export type MoneyDto = z.infer<typeof moneySchema>;
export type Customer = z.infer<typeof customerSchema>;
export type TokenPair = z.infer<typeof tokenPairSchema>;
export type Operator = z.infer<typeof operatorSchema>;
export type OperatorToken = z.infer<typeof operatorTokenSchema>;
export type Address = z.infer<typeof addressSchema>;
export type ResolvedProductDto = z.infer<typeof resolvedProductSchema>;
export type ProductRequestDto = z.infer<typeof productRequestSchema>;
export type QuoteDto = z.infer<typeof quoteSchema>;
export type QuoteBreakdownDto = z.infer<typeof quoteBreakdownSchema>;
export type OrderState = z.infer<typeof orderStateSchema>;
export type TimelineStep = z.infer<typeof timelineStepSchema>;
export type OrderDto = z.infer<typeof orderSchema>;
export type OrderSummaryDto = z.infer<typeof orderSummarySchema>;
export type StartPaymentDto = z.infer<typeof startPaymentResponse>;
export type ExceptionItemDto = z.infer<typeof exceptionItemSchema>;
export type AdminOrderSearchQuery = z.infer<typeof adminOrderSearchQuery>;
export type AdminOrderRowDto = z.infer<typeof adminOrderRowSchema>;
export type AdminOrderSearchResultDto = z.infer<typeof adminOrderSearchResultSchema>;
export type ProcurementCopilotDto = z.infer<typeof procurementCopilotSchema>;
export type ProviderHealthDto = z.infer<typeof providerHealthSchema>;
export type LedgerEntryDto = z.infer<typeof ledgerEntrySchema>;
export type SandboxScenarioDto = z.infer<typeof sandboxScenarioSchema>;
export type SandboxSessionDto = z.infer<typeof sandboxSessionSchema>;
export type SandboxLogEntryDto = z.infer<typeof sandboxLogEntrySchema>;
