'use client';

import type {
  AdminOrderSearchResultDto,
  ErrorEnvelope,
  ExceptionItemDto,
  LedgerEntryDto,
  OperatorToken,
  OrderDto,
  ProcurementCopilotDto,
  ProviderHealthDto,
} from '@xb/contracts';

/**
 * Back office API client.
 *
 * Separate from the front office client on purpose: operators authenticate differently
 * (email + password, no refresh rotation), carry a role that gates every route, and send
 * `If-Match` on mutations. Sharing one client would mean one of the two audiences carrying
 * machinery it should not have.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const TOKEN_KEY = 'xb.admin.token';
const OPERATOR_KEY = 'xb.admin.operator';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly messages: { en: string; fa: string },
    readonly status: number,
    readonly traceId: string,
  ) {
    super(messages.en);
    this.name = 'ApiError';
  }

  /** The back office runs in English — operators work with internal vocabulary. */
  text(): string {
    return this.messages.en;
  }
}

export const session = {
  get token(): string | null {
    return typeof window === 'undefined' ? null : localStorage.getItem(TOKEN_KEY);
  },
  get operator(): OperatorToken['operator'] | null {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem(OPERATOR_KEY);
    return raw ? (JSON.parse(raw) as OperatorToken['operator']) : null;
  },
  save(t: OperatorToken): void {
    localStorage.setItem(TOKEN_KEY, t.accessToken);
    localStorage.setItem(OPERATOR_KEY, JSON.stringify(t.operator));
  },
  clear(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(OPERATOR_KEY);
  },
  get isAuthenticated(): boolean {
    return this.token !== null;
  },
};

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; ifMatch?: string; idempotencyKey?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'accept-language': 'en',
  };

  const token = session.token;
  if (token) headers['authorization'] = `Bearer ${token}`;
  if (options.ifMatch) headers['if-match'] = options.ifMatch;
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  if (res.status === 401) {
    session.clear();
    if (typeof window !== 'undefined') window.location.href = '/';
  }

  if (res.status === 204) return undefined as T;

  const payload = (await res.json().catch(() => null)) as ErrorEnvelope | T | null;

  if (!res.ok) {
    const envelope = payload as ErrorEnvelope | null;
    throw new ApiError(
      envelope?.error?.code ?? 'UNKNOWN',
      envelope?.error?.message ?? { en: 'Request failed', fa: 'درخواست ناموفق بود' },
      res.status,
      envelope?.error?.traceId ?? '',
    );
  }

  return payload as T;
}

const newKey = (): string => crypto.randomUUID();

export const api = {
  login: async (email: string, password: string) => {
    const token = await request<OperatorToken>('/v1/auth/operator/login', {
      method: 'POST',
      body: { email, password },
    });
    session.save(token);
    return token;
  },

  exceptions: (type?: string) =>
    request<{ items: ExceptionItemDto[]; nextCursor: string | null }>(
      `/v1/admin/exceptions${type ? `?type=${encodeURIComponent(type)}` : ''}`,
    ),

  /**
   * Order search. Filters are passed through as-is; empty values are dropped rather than sent
   * as `?q=`, which the schema would reject as too short.
   */
  searchOrders: (filters: Record<string, string | string[] | undefined>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined) continue;
      // Repeated key rather than a comma list: `state` is an array server-side.
      if (Array.isArray(value)) value.forEach((v) => v && params.append(key, v));
      else if (value !== '') params.set(key, value);
    }
    return request<AdminOrderSearchResultDto>(`/v1/admin/orders?${params.toString()}`);
  },

  copilot: (procurementId: string) =>
    request<ProcurementCopilotDto>(`/v1/admin/procurements/${procurementId}/copilot`),

  confirmProcurement: (
    procurementId: string,
    body: { externalOrderId: string; actualPaid: { amount: number; currency: string }; note?: string },
  ) =>
    request<{ ok: boolean; orderId: string; state: string }>(
      `/v1/admin/procurements/${procurementId}/confirm`,
      { method: 'POST', body, idempotencyKey: newKey() },
    ),

  transition: (orderId: string, to: string, reason: string, version: number) =>
    request<{ ok: boolean; state: string }>(`/v1/admin/orders/${orderId}/transition`, {
      method: 'POST',
      body: { to, reason },
      ifMatch: String(version),
    }),

  reprice: (
    orderId: string,
    newMaxPrice: { amount: number; currency: string },
    reason: string,
    version: number,
  ) =>
    request<{ ok: boolean; state: string }>(`/v1/admin/orders/${orderId}/reprice`, {
      method: 'POST',
      body: { newMaxPrice, reason },
      ifMatch: String(version),
    }),

  // The admin route, not `/v1/orders/:id`: the customer one scopes every read to the calling
  // customer, so an operator token sees a 404 for every order that exists.
  order: (id: string) => request<OrderDto>(`/v1/admin/orders/${id}`),

  ledger: (refId?: string) =>
    request<{ items: LedgerEntryDto[] }>(
      `/v1/admin/finance/ledger${refId ? `?refId=${refId}` : ''}`,
    ),

  balances: () =>
    request<{ account: string; balance: { amount: number; currency: string } }[]>(
      '/v1/admin/finance/balances',
    ),

  providers: () => request<ProviderHealthDto[]>('/v1/admin/providers'),
};

export function formatMoney(m: { amount: number; currency: string }): string {
  if (m.currency === 'IRR') {
    return `${new Intl.NumberFormat('en-US').format(Math.round(m.amount / 10))} T`;
  }
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: m.currency }).format(
    m.amount / 100,
  );
}

export function formatAge(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}
