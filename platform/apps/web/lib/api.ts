'use client';

import type {
  Address,
  ErrorEnvelope,
  OrderDto,
  OrderSummaryDto,
  ProductRequestDto,
  QuoteDto,
  SandboxScenarioDto,
  SandboxSessionDto,
  StartPaymentDto,
  TokenPair,
} from '@xb/contracts';

/**
 * The API client.
 *
 * Types come from `@xb/contracts`, the same module the API validates with, so a field that
 * changes shape server-side is a compile error here rather than a runtime surprise.
 *
 * Three things this handles that a bare `fetch` wrapper does not:
 *
 *   - **Bilingual errors.** The server returns both locales; `ApiError` exposes both and the
 *     UI picks. No translation happens on the client.
 *   - **Token refresh.** A 401 triggers one refresh attempt and one retry. Concurrent 401s
 *     share a single refresh promise, so ten parallel requests don't rotate the token ten
 *     times and trip the reuse detector.
 *   - **Sandbox routing.** When a sandbox session is active, its id rides on every request,
 *     which is what makes the API swap in the simulated adapters.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const ACCESS_KEY = 'xb.accessToken';
const REFRESH_KEY = 'xb.refreshToken';
const CUSTOMER_KEY = 'xb.customer';
export const SANDBOX_KEY = 'xb.sandboxSession';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly messages: { en: string; fa: string },
    readonly status: number,
    readonly traceId: string,
    readonly issues?: ErrorEnvelope['error']['issues'],
  ) {
    super(messages.en);
    this.name = 'ApiError';
  }

  /** The message for the active locale. Persian is the default, per the product rules. */
  text(locale: 'fa' | 'en' = 'fa'): string {
    return this.messages[locale];
  }

  /** Field-level messages for inline form errors. */
  fieldErrors(locale: 'fa' | 'en' = 'fa'): Record<string, string> {
    const out: Record<string, string> = {};
    for (const issue of this.issues ?? []) out[issue.path] = issue.message[locale];
    return out;
  }
}

// ─────────────────────────── token storage ───────────────────────────

const storage = {
  get(key: string): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(key);
  },
  set(key: string, value: string): void {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
  },
  remove(key: string): void {
    if (typeof window !== 'undefined') window.localStorage.removeItem(key);
  },
};

export const auth = {
  get accessToken(): string | null {
    return storage.get(ACCESS_KEY);
  },
  get isAuthenticated(): boolean {
    return storage.get(ACCESS_KEY) !== null;
  },
  get customer(): TokenPair['customer'] | null {
    const raw = storage.get(CUSTOMER_KEY);
    return raw ? (JSON.parse(raw) as TokenPair['customer']) : null;
  },
  save(tokens: TokenPair): void {
    storage.set(ACCESS_KEY, tokens.accessToken);
    storage.set(REFRESH_KEY, tokens.refreshToken);
    storage.set(CUSTOMER_KEY, JSON.stringify(tokens.customer));
  },
  clear(): void {
    storage.remove(ACCESS_KEY);
    storage.remove(REFRESH_KEY);
    storage.remove(CUSTOMER_KEY);
  },
};

export const sandbox = {
  get sessionId(): string | null {
    return storage.get(SANDBOX_KEY);
  },
  set(id: string): void {
    storage.set(SANDBOX_KEY, id);
  },
  clear(): void {
    storage.remove(SANDBOX_KEY);
  },
  get active(): boolean {
    return storage.get(SANDBOX_KEY) !== null;
  },
};

// ─────────────────────────── request ───────────────────────────

/**
 * Shared refresh promise.
 *
 * Without this, several requests failing with 401 at once each start their own refresh. The
 * second rotation invalidates the first, the server sees a reused token, and it revokes the
 * whole family — logging the user out for doing nothing wrong.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = storage.get(REFRESH_KEY);
    if (!refreshToken) return false;

    try {
      const res = await fetch(`${API_URL}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        auth.clear();
        return false;
      }
      auth.save((await res.json()) as TokenPair);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  /** Required by the API on any mutation that moves money or calls a third party. */
  idempotencyKey?: string;
  ifMatch?: string;
  skipAuth?: boolean;
  retryOn401?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'accept-language': 'fa' };

  // Only declare a JSON content type when there is actually a body. Several endpoints are
  // POSTs with no payload (`/quotes/:id/refresh`, `/orders/:id/payments`), and a request that
  // announces `application/json` while sending nothing is malformed — servers are entitled to
  // reject it, and Fastify does.
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  const token = auth.accessToken;
  if (token && !options.skipAuth) headers['authorization'] = `Bearer ${token}`;
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
  if (options.ifMatch) headers['if-match'] = options.ifMatch;

  // Every request in a sandbox session carries its id, so the API swaps the adapter set.
  const session = sandbox.sessionId;
  if (session) headers['x-sandbox-session'] = session;

  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  if (res.status === 401 && options.retryOn401 !== false && !options.skipAuth) {
    if (await refreshTokens()) {
      return request<T>(path, { ...options, retryOn401: false });
    }
  }

  if (res.status === 204) return undefined as T;

  const payload = (await res.json().catch(() => null)) as ErrorEnvelope | T | null;

  if (!res.ok) {
    const envelope = payload as ErrorEnvelope | null;
    throw new ApiError(
      envelope?.error?.code ?? 'UNKNOWN',
      envelope?.error?.message ?? {
        en: 'Something went wrong. Please try again.',
        fa: 'مشکلی پیش آمد. لطفاً دوباره تلاش کنید.',
      },
      res.status,
      envelope?.error?.traceId ?? '',
      envelope?.error?.issues,
    );
  }

  return payload as T;
}

const newKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// ─────────────────────────── endpoints ───────────────────────────

export const api = {
  auth: {
    startOtp: (phone: string) =>
      request<{ challengeId: string; expiresAt: string; resendAfter: number }>(
        '/v1/auth/otp/start',
        { method: 'POST', body: { phone }, skipAuth: true },
      ),

    verifyOtp: async (challengeId: string, code: string) => {
      const tokens = await request<TokenPair>('/v1/auth/otp/verify', {
        method: 'POST',
        body: { challengeId, code },
        skipAuth: true,
      });
      auth.save(tokens);
      return tokens;
    },

    logout: () => auth.clear(),
  },

  catalog: {
    resolve: (url: string) =>
      request<ProductRequestDto>('/v1/product-requests', {
        method: 'POST',
        body: { url },
        idempotencyKey: newKey(),
      }),

    get: (id: string) => request<ProductRequestDto>(`/v1/product-requests/${id}`),
  },

  quotes: {
    create: (requestId: string, quantity: number) =>
      request<QuoteDto>('/v1/quotes', {
        method: 'POST',
        body: { requestId, quantity },
        idempotencyKey: newKey(),
      }),

    refresh: (id: string) => request<QuoteDto>(`/v1/quotes/${id}/refresh`, { method: 'POST' }),
  },

  addresses: {
    list: () => request<Address[]>('/v1/addresses'),

    create: (input: {
      recipientName: string;
      phone: string;
      province: string;
      city: string;
      line1: string;
      postalCode: string;
    }) =>
      request<Address>('/v1/addresses', {
        method: 'POST',
        body: { ...input, isDefault: true },
      }),
  },

  orders: {
    create: (quoteId: string, addressId: string) =>
      request<OrderDto>('/v1/orders', {
        method: 'POST',
        body: { quoteId, addressId },
        idempotencyKey: newKey(),
      }),

    list: (cursor?: string) =>
      request<{ items: OrderSummaryDto[]; nextCursor: string | null }>(
        `/v1/orders${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      ),

    get: (id: string) => request<OrderDto>(`/v1/orders/${id}`),

    startPayment: (id: string) =>
      request<StartPaymentDto>(`/v1/orders/${id}/payments`, {
        method: 'POST',
        idempotencyKey: newKey(),
      }),
  },

  sandbox: {
    scenarios: () => request<SandboxScenarioDto[]>('/v1/sandbox/scenarios', { skipAuth: true }),

    create: (scenarioId: string, seed?: number) =>
      request<SandboxSessionDto>('/v1/sandbox/sessions', {
        method: 'POST',
        body: { scenarioId, ...(seed !== undefined ? { seed } : {}) },
        skipAuth: true,
      }),

    get: (id: string) =>
      request<SandboxSessionDto>(`/v1/sandbox/sessions/${id}`, { skipAuth: true }),

    advance: (id: string, hours: number) =>
      request<SandboxSessionDto>(`/v1/sandbox/sessions/${id}/advance`, {
        method: 'POST',
        body: { hours },
        skipAuth: true,
      }),

    reset: (id: string) =>
      request<SandboxSessionDto>(`/v1/sandbox/sessions/${id}/reset`, {
        method: 'POST',
        skipAuth: true,
      }),
  },
};

// ─────────────────────────── formatting ───────────────────────────

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

export function toPersianDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)]!);
}

/**
 * Format money for display.
 *
 * IRR is shown in Toman, which is what Iranians actually quote prices in — 1 toman = 10 rial.
 * The API always works in rial; converting only at the display boundary keeps every stored
 * and transmitted figure in one unit.
 */
export function formatMoney(
  money: { amount: number; currency: string },
  locale: 'fa' | 'en' = 'fa',
): string {
  if (money.currency === 'IRR') {
    const toman = Math.round(money.amount / 10);
    const grouped = new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US').format(toman);
    return locale === 'fa' ? `${grouped} تومان` : `${grouped} Toman`;
  }

  const formatted = new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
    style: 'currency',
    currency: money.currency,
  }).format(money.amount / 100);

  return formatted;
}

export function formatRelativeTime(iso: string, locale: 'fa' | 'en' = 'fa'): string {
  const diffMs = Date.now() - Date.parse(iso);
  const minutes = Math.round(diffMs / 60_000);

  const rtf = new Intl.RelativeTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
    numeric: 'auto',
  });

  if (Math.abs(minutes) < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(-hours, 'hour');
  return rtf.format(-Math.round(hours / 24), 'day');
}

export function formatDateTime(iso: string, locale: 'fa' | 'en' = 'fa'): string {
  return new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}
