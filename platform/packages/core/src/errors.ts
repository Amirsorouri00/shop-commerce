/**
 * The error taxonomy.
 *
 * Every failure the system can surface is one of these classes. That buys three things:
 *
 *   - The global exception filter maps to HTTP by class, so no handler writes a status code.
 *   - Log level is a property of the error, not a decision at the throw site. A 404 is not
 *     an error-level event just because it happened inside a catch block.
 *   - Retryability is declared, so workers decide to nack-and-retry from the error itself
 *     rather than from a string match on the message.
 *
 * Every message carries both locales. The client selects; it never translates.
 */

export interface LocalizedMessage {
  readonly en: string;
  readonly fa: string;
}

export type ErrorSeverity = 'debug' | 'info' | 'warn' | 'error';

export interface ValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly params?: Record<string, unknown>;
  readonly message: LocalizedMessage;
}

export interface AppErrorOptions {
  /** Structured context for logs. Never returned to the client. */
  readonly details?: Record<string, unknown>;
  readonly cause?: unknown;
}

export abstract class AppError extends Error {
  /** Stable, machine-readable, safe to branch on. Never changes for a given condition. */
  abstract readonly code: string;
  abstract readonly httpStatus: number;
  abstract readonly severity: ErrorSeverity;

  /** Whether a caller or a queue consumer should try again. */
  readonly retryable: boolean = false;

  /** Shown to the user. Both locales, always. */
  abstract readonly localized: LocalizedMessage;

  readonly details: Record<string, unknown> | undefined;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.details = options.details;
    Error.captureStackTrace?.(this, new.target);
  }

  /** The client-facing shape. Deliberately excludes `details` and the stack. */
  toEnvelope(traceId: string): {
    error: {
      code: string;
      message: LocalizedMessage;
      traceId: string;
      issues?: readonly ValidationIssue[];
    };
  } {
    const issues = this instanceof ValidationError ? this.issues : undefined;
    return {
      error: {
        code: this.code,
        message: this.localized,
        traceId,
        ...(issues && issues.length > 0 ? { issues } : {}),
      },
    };
  }
}

// ─────────────────────────────── 4xx ───────────────────────────────

export class ValidationError extends AppError {
  readonly code = 'VALIDATION_FAILED';
  readonly httpStatus = 422;
  readonly severity: ErrorSeverity = 'debug';
  readonly localized: LocalizedMessage = {
    en: "Some of the information you entered isn't valid.",
    fa: 'برخی از اطلاعات واردشده معتبر نیست.',
  };

  constructor(
    readonly issues: readonly ValidationIssue[],
    options?: AppErrorOptions,
  ) {
    super(`Validation failed on ${issues.length} field(s)`, options);
  }
}

export class UnauthorizedError extends AppError {
  readonly code = 'UNAUTHORIZED';
  readonly httpStatus = 401;
  readonly severity: ErrorSeverity = 'info';
  readonly localized: LocalizedMessage = {
    en: 'Please sign in to continue.',
    fa: 'برای ادامه لطفاً وارد حساب خود شوید.',
  };
}

export class InvalidCredentialsError extends AppError {
  readonly code = 'INVALID_CREDENTIALS';
  readonly httpStatus = 401;
  readonly severity: ErrorSeverity = 'info';
  readonly localized: LocalizedMessage = {
    en: 'That code is incorrect or has expired. Request a new one.',
    fa: 'کد واردشده نادرست است یا منقضی شده. لطفاً کد جدیدی درخواست کنید.',
  };
}

export class ForbiddenError extends AppError {
  readonly code = 'FORBIDDEN';
  readonly httpStatus = 403;
  readonly severity: ErrorSeverity = 'warn';
  readonly localized: LocalizedMessage = {
    en: "You don't have permission to do that.",
    fa: 'شما اجازهٔ انجام این کار را ندارید.',
  };
}

export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND';
  readonly httpStatus = 404;
  readonly severity: ErrorSeverity = 'debug';
  readonly localized: LocalizedMessage;

  constructor(resource: string, id?: string, options?: AppErrorOptions) {
    super(`${resource}${id ? ` ${id}` : ''} not found`, options);
    this.localized = {
      en: `We couldn't find that ${resource.toLowerCase()}.`,
      fa: 'مورد درخواستی یافت نشد.',
    };
  }
}

/** A domain invariant refused the operation — an illegal transition, a stale quote. */
export class ConflictError extends AppError {
  readonly code: string;
  readonly httpStatus = 409;
  readonly severity: ErrorSeverity = 'info';
  readonly localized: LocalizedMessage;

  constructor(code: string, localized: LocalizedMessage, message?: string, options?: AppErrorOptions) {
    super(message ?? code, options);
    this.code = code;
    this.localized = localized;
  }
}

/** Optimistic concurrency lost — someone else changed the resource first. */
export class PreconditionFailedError extends AppError {
  readonly code = 'VERSION_MISMATCH';
  readonly httpStatus = 412;
  readonly severity: ErrorSeverity = 'info';
  readonly localized: LocalizedMessage = {
    en: 'Someone else changed this while you were working. Reload and try again.',
    fa: 'این مورد هم‌زمان توسط شخص دیگری تغییر کرده است. صفحه را تازه کنید و دوباره تلاش کنید.',
  };
}

/** A business policy said no — viability gate, category allowlist, minimum order value. */
export class PolicyError extends AppError {
  readonly code: string;
  readonly httpStatus = 422;
  readonly severity: ErrorSeverity = 'info';
  readonly localized: LocalizedMessage;

  constructor(code: string, localized: LocalizedMessage, message?: string, options?: AppErrorOptions) {
    super(message ?? code, options);
    this.code = code;
    this.localized = localized;
  }
}

export class RateLimitError extends AppError {
  readonly code = 'RATE_LIMITED';
  readonly httpStatus = 429;
  readonly severity: ErrorSeverity = 'warn';
  override readonly retryable = true;
  readonly localized: LocalizedMessage;

  constructor(
    readonly retryAfterSeconds: number,
    options?: AppErrorOptions,
  ) {
    super(`Rate limited; retry after ${retryAfterSeconds}s`, options);
    this.localized = {
      en: `Too many attempts. Try again in ${retryAfterSeconds} seconds.`,
      fa: `تعداد تلاش‌ها بیش از حد مجاز است. لطفاً ${retryAfterSeconds} ثانیهٔ دیگر تلاش کنید.`,
    };
  }
}

// ─────────────────────────────── 5xx ───────────────────────────────

/** A third party failed. Distinguishes "their fault" from "our fault" in dashboards. */
export class UpstreamError extends AppError {
  readonly code = 'UPSTREAM_FAILED';
  readonly httpStatus = 502;
  readonly severity: ErrorSeverity = 'error';
  override readonly retryable = true;
  readonly localized: LocalizedMessage = {
    en: "One of our providers isn't responding. Please try again shortly.",
    fa: 'یکی از سرویس‌های ما پاسخ نمی‌دهد. لطفاً کمی بعد دوباره تلاش کنید.',
  };

  constructor(
    readonly provider: string,
    message: string,
    options?: AppErrorOptions,
  ) {
    super(`[${provider}] ${message}`, options);
  }
}

/** No healthy provider left for a port — every adapter in the chain is quarantined. */
export class ProviderUnavailableError extends AppError {
  readonly code = 'PROVIDER_UNAVAILABLE';
  readonly httpStatus = 503;
  readonly severity: ErrorSeverity = 'error';
  override readonly retryable = true;
  readonly localized: LocalizedMessage = {
    en: 'This service is temporarily unavailable. Please try again in a few minutes.',
    fa: 'این سرویس موقتاً در دسترس نیست. لطفاً چند دقیقهٔ دیگر تلاش کنید.',
  };

  constructor(
    readonly port: string,
    options?: AppErrorOptions,
  ) {
    super(`No healthy provider available for ${port}`, options);
  }
}

export class TimeoutError extends AppError {
  readonly code = 'TIMEOUT';
  readonly httpStatus = 504;
  readonly severity: ErrorSeverity = 'error';
  override readonly retryable = true;
  readonly localized: LocalizedMessage = {
    en: 'That took too long. Please try again.',
    fa: 'زمان پاسخ‌گویی بیش از حد طول کشید. لطفاً دوباره تلاش کنید.',
  };

  constructor(operation: string, ms: number, options?: AppErrorOptions) {
    super(`${operation} exceeded ${ms}ms`, options);
  }
}

export class CircuitOpenError extends AppError {
  readonly code = 'CIRCUIT_OPEN';
  readonly httpStatus = 503;
  readonly severity: ErrorSeverity = 'warn';
  override readonly retryable = true;
  readonly localized: LocalizedMessage = {
    en: 'This service is recovering from a problem. Please try again shortly.',
    fa: 'این سرویس در حال بازیابی است. لطفاً کمی بعد دوباره تلاش کنید.',
  };

  constructor(
    readonly provider: string,
    options?: AppErrorOptions,
  ) {
    super(`Circuit open for ${provider}`, options);
  }
}

/** Anything unclassified. Its message is deliberately vague — internals are not the user's problem. */
export class InternalError extends AppError {
  readonly code = 'INTERNAL_ERROR';
  readonly httpStatus = 500;
  readonly severity: ErrorSeverity = 'error';
  readonly localized: LocalizedMessage = {
    en: 'Something went wrong on our side. We have been notified.',
    fa: 'مشکلی در سامانه رخ داده است. تیم فنی در جریان قرار گرفت.',
  };
}

// ─────────────────────── domain-specific factories ───────────────────────
//
// Named constructors for the conditions this domain actually produces. Keeping them here
// means the wording of a customer-facing failure is reviewed in one place rather than
// improvised at each throw site.

export const DomainErrors = {
  illegalTransition: (from: string, to: string) =>
    new ConflictError(
      'ILLEGAL_TRANSITION',
      {
        en: "This order can't move to that stage from where it is now.",
        fa: 'این سفارش از وضعیت فعلی خود نمی‌تواند به این مرحله منتقل شود.',
      },
      `Illegal transition ${from} -> ${to}`,
      { details: { from, to } },
    ),

  quoteExpired: () =>
    new ConflictError('QUOTE_EXPIRED', {
      en: 'This price has expired. Get a fresh quote to continue.',
      fa: 'اعتبار این قیمت به پایان رسیده است. برای ادامه، قیمت جدیدی دریافت کنید.',
    }),

  quoteStale: () =>
    new ConflictError('QUOTE_STALE', {
      en: 'The price changed while you were checking out. Please review the new total.',
      fa: 'قیمت هنگام تکمیل خرید تغییر کرد. لطفاً مبلغ جدید را بررسی کنید.',
    }),

  notViable: () =>
    new PolicyError('QUOTE_NOT_VIABLE', {
      en: "Shipping this item costs more than we can justify — it isn't worth ordering.",
      fa: 'هزینهٔ ارسال این کالا بیش از حد مجاز است و سفارش آن به‌صرفه نیست.',
    }),

  belowMinimumOrderValue: () =>
    new PolicyError('BELOW_MINIMUM_ORDER_VALUE', {
      en: 'This order is below our minimum value. Try adding more or choosing a higher-value item.',
      fa: 'مبلغ این سفارش از حداقل مجاز کمتر است. لطفاً تعداد را افزایش دهید یا کالای گران‌تری انتخاب کنید.',
    }),

  categoryNotAllowed: (category: string) =>
    new PolicyError(
      'CATEGORY_NOT_ALLOWED',
      {
        en: "We can't ship this type of item to Iran.",
        fa: 'امکان ارسال این دسته از کالاها به ایران وجود ندارد.',
      },
      `Category "${category}" is not on the allowlist`,
      { details: { category } },
    ),

  outOfStock: () =>
    new ConflictError('OUT_OF_STOCK', {
      en: 'This item is no longer available from the seller.',
      fa: 'این کالا دیگر از سوی فروشنده موجود نیست.',
    }),

  fxTooStale: (ageSeconds: number, maxSeconds: number) =>
    new PolicyError(
      'FX_TOO_STALE',
      {
        en: "We can't price this right now. Please try again in a moment.",
        fa: 'در حال حاضر امکان قیمت‌گذاری وجود ندارد. لطفاً چند لحظه دیگر تلاش کنید.',
      },
      `FX snapshot is ${ageSeconds}s old, maximum is ${maxSeconds}s`,
      { details: { ageSeconds, maxSeconds } },
    ),

  procurementGuardBreached: (actual: number, max: number, currency: string) =>
    new ConflictError(
      'PROCUREMENT_GUARD_BREACHED',
      {
        en: 'The seller raised the price above what was authorised. We have paused this order.',
        fa: 'فروشنده قیمت را بیش از مبلغ تأییدشده افزایش داده است. این سفارش موقتاً متوقف شد.',
      },
      `Actual ${actual} ${currency} exceeds authorised maximum ${max} ${currency}`,
      { details: { actual, max, currency } },
    ),

  unsupportedMarketplace: (url: string) =>
    new PolicyError(
      'UNSUPPORTED_MARKETPLACE',
      {
        en: "We don't support this store yet. Right now we can order from Amazon UAE.",
        fa: 'این فروشگاه هنوز پشتیبانی نمی‌شود. در حال حاضر امکان سفارش از آمازون امارات وجود دارد.',
      },
      `No store adapter supports ${url}`,
      { details: { url } },
    ),

  paymentAlreadySettled: () =>
    new ConflictError('PAYMENT_ALREADY_SETTLED', {
      en: 'This order has already been paid.',
      fa: 'هزینهٔ این سفارش قبلاً پرداخت شده است.',
    }),

  idempotencyKeyConflict: () =>
    new ConflictError('IDEMPOTENCY_KEY_REUSED', {
      en: 'This request was already submitted with different details.',
      fa: 'این درخواست پیش‌تر با اطلاعات متفاوتی ثبت شده است.',
    }),
} as const;

/** Narrowing helper for the exception filter and for worker retry decisions. */
export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** Whether a failure is worth retrying. Unknown errors are not retried — they are probably bugs. */
export function isRetryable(e: unknown): boolean {
  return isAppError(e) && e.retryable;
}
