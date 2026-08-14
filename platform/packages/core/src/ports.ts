import type { Money, Currency } from './money.ts';
import type { LocalizedMessage } from './errors.ts';

/**
 * Port interfaces for the gated seams outside the commerce domain.
 *
 * They live in `core` because they reference nothing but domain primitives, which keeps them
 * importable by every package — including a service later extracted out of the monolith —
 * without dragging in a driver or an SDK.
 *
 * `@xb/commerce` owns `StorePort` and `ProcurementPort` instead, because those need
 * marketplace descriptors and would make this file depend on the commerce engine.
 */

// ─────────────────────────── FX ───────────────────────────

export interface FxQuote {
  readonly from: Currency;
  readonly to: Currency;
  readonly rate: number;
  readonly observedAt: string;
  readonly source: string;
}

export interface FxPort {
  getRate(from: Currency, to: Currency): Promise<FxQuote>;
}

// ─────────────────────────── payment ───────────────────────────

export type PaymentIntentStatus = 'PENDING' | 'REDIRECTED' | 'SETTLED' | 'DECLINED' | 'EXPIRED';

export interface PaymentIntent {
  readonly providerRef: string;
  readonly provider: string;
  readonly status: PaymentIntentStatus;
  readonly redirectUrl: string | undefined;
  readonly amount: Money;
  readonly expiresAt: string;
}

export interface PaymentVerification {
  readonly settled: boolean;
  readonly providerRef: string;
  readonly amount: Money;
  readonly failureReason: string | undefined;
}

export interface PaymentPort {
  /**
   * Create a payment intent.
   *
   * `idempotencyKey` is required, not optional: a retried create without one produces a
   * second intent, and a customer with two live intents can pay twice.
   */
  createIntent(input: {
    orderId: string;
    amount: Money;
    idempotencyKey: string;
    returnUrl: string;
  }): Promise<PaymentIntent>;

  /** Confirm settlement with the provider. Never trust the redirect alone. */
  verify(providerRef: string): Promise<PaymentVerification>;

  /** Validate a webhook signature. Returning false must reject the request. */
  verifyWebhook(rawBody: string, signature: string): boolean;

  refund(input: { providerRef: string; amount: Money; idempotencyKey: string }): Promise<{
    ok: boolean;
    refundRef: string | undefined;
  }>;
}

// ─────────────────────────── carrier ───────────────────────────

export interface TrackingEvent {
  readonly status: string;
  readonly at: string;
  readonly location: LocalizedMessage | undefined;
  /** The carrier's own wording. Kept for support and audit; never shown to a customer. */
  readonly rawStatus: string;
}

export interface ShipmentLeg {
  readonly legId: string;
  readonly carrier: string;
  readonly trackingNumber: string | undefined;
  readonly origin: string;
  readonly destination: string;
  readonly events: readonly TrackingEvent[];
}

export interface CarrierPort {
  createShipment(input: {
    orderId: string;
    weightKg: number;
    origin: string;
    destination: string;
  }): Promise<{ shipmentId: string }>;

  track(shipmentId: string): Promise<readonly ShipmentLeg[]>;
}

// ─────────────────────────── customs ───────────────────────────

export interface CustomsPort {
  /** Duty as a fraction of declared value, plus how confident the estimate is. */
  estimate(input: {
    route: string;
    category: string;
    declaredValue: Money;
  }): Promise<{ dutyRate: number; confidence: number; basis: string }>;
}

// ─────────────────────────── notification ───────────────────────────

export type NotificationChannel = 'sms' | 'push' | 'in-app';

export interface SmsPort {
  send(input: { to: string; message: string; templateId?: string }): Promise<{
    ok: boolean;
    providerRef: string | undefined;
  }>;

  /**
   * A development provider's pinned verification code.
   *
   * Optional, and absent on every real provider — a gateway that could tell you the code it
   * was about to deliver would be a defect. It exists because a simulated gateway delivers
   * nowhere, so the code has to be knowable some other way, and the alternative (grepping a
   * log file for it) makes the sign-in step of every demo and browser test depend on where
   * the process happens to be writing its logs. The precedent is ordinary: Firebase test
   * phone numbers and Twilio magic numbers work the same way.
   *
   * Declared as a **method**, not a field, on purpose. Ports are reached through the failover
   * proxy, which exposes only what some provider implements as a function and returns
   * `undefined` for everything else — so `typeof port.fixedOtpCode === 'function'` is an
   * accurate capability check, and a field would silently read as undefined.
   *
   * Callers must additionally refuse to honour this outside development. A constant OTP is a
   * complete authentication bypass, so it is guarded where it is registered *and* where it is
   * consumed, rather than trusting either one alone.
   */
  fixedOtpCode?(): string | Promise<string>;
}

export interface NotificationPort {
  notify(input: {
    customerId: string;
    channel: NotificationChannel;
    message: LocalizedMessage;
    /** Deduplicates redelivered events so one state change sends one message. */
    dedupeKey: string;
  }): Promise<void>;
}

// ─────────────────────────── storage ───────────────────────────

export interface StoragePort {
  /** Presigned upload URL. The API never proxies file bytes. */
  presignUpload(input: {
    bucket: string;
    key: string;
    contentType: string;
    expiresInSeconds?: number;
  }): Promise<{ url: string; fields?: Record<string, string> }>;

  presignDownload(input: { bucket: string; key: string; expiresInSeconds?: number }): Promise<string>;
}

// ─────────────────────────── identity ───────────────────────────

export interface IdentityPort {
  readonly provider: string;
  /** Verify a credential and return the provider's stable subject id. */
  verify(credential: Record<string, unknown>): Promise<{
    subject: string;
    phone?: string;
    email?: string;
    displayName?: string;
  }>;
}

// ─────────────────────────── exception ranking ───────────────────────────

export interface RankerPort {
  /**
   * Score exceptions for the ops queue.
   *
   * Advisory only — it orders a list. It cannot move money, change state, or write anything.
   * Implementations must degrade to a deterministic ordering when the model is unavailable.
   */
  rank(
    items: readonly {
      orderId: string;
      type: string;
      marginAtRisk: Money;
      ageMinutes: number;
    }[],
  ): Promise<readonly { orderId: string; rank: number; rankedBy: 'model' | 'deterministic' }[]>;
}
