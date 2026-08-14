'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { AdminOrderRowDto, AdminOrderSearchResultDto, OrderState } from '@xb/contracts';
import { api, ApiError, formatMoney, session } from '../../lib/api';
import { LoginForm } from '../../components/LoginForm';

/**
 * Order search.
 *
 * The deliberate counterpart to the exception queue, not a replacement for it. The queue
 * answers "what needs me now" and is still the front door; this answers "where is the order
 * this person is asking me about", which is the other half of an operator's day and which
 * manage-by-exception, on its own, leaves no way to do.
 *
 * Filters are held in the URL rather than in component state so a search can be pasted into a
 * ticket or a chat and reopened exactly as the sender saw it — the thing support actually
 * does with a screen like this.
 */

const STATES: OrderState[] = [
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
];

/** States that mean money is committed but the thing has not arrived. */
const IN_FLIGHT: OrderState[] = [
  'PAID',
  'PROCUREMENT_PENDING',
  'PURCHASED',
  'SELLER_PROCESSING',
  'LOCAL_TRANSIT',
  'WAREHOUSE_RECEIVED',
  'INTERNATIONAL_TRANSIT',
  'CUSTOMS',
  'DOMESTIC_TRANSIT',
];

const UNPAID: OrderState[] = ['DRAFT', 'QUOTING', 'QUOTED', 'AWAITING_PAYMENT'];

interface Filters {
  q: string;
  state: string[];
  minTotal: string;
  maxTotal: string;
  createdFrom: string;
  createdTo: string;
  sandbox: 'exclude' | 'only' | 'include';
  sort: 'newest' | 'oldest' | 'total_desc' | 'total_asc' | 'updated';
  offset: number;
}

const EMPTY: Filters = {
  q: '',
  state: [],
  minTotal: '',
  maxTotal: '',
  createdFrom: '',
  createdTo: '',
  sandbox: 'exclude',
  sort: 'newest',
  offset: 0,
};

const LIMIT = 25;

export default function OrdersPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [result, setResult] = useState<AdminOrderSearchResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => setAuthed(session.isAuthenticated), []);

  // Read the URL once on mount so a shared link restores the same search.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setFilters((f) => ({
      ...f,
      q: p.get('q') ?? '',
      state: p.getAll('state'),
      minTotal: p.get('minTotal') ?? '',
      maxTotal: p.get('maxTotal') ?? '',
      createdFrom: p.get('createdFrom') ?? '',
      createdTo: p.get('createdTo') ?? '',
      sandbox: (p.get('sandbox') as Filters['sandbox']) || 'exclude',
      sort: (p.get('sort') as Filters['sort']) || 'newest',
    }));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = {
        q: filters.q.trim(),
        state: filters.state,
        minTotal: filters.minTotal,
        maxTotal: filters.maxTotal,
        createdFrom: filters.createdFrom ? `${filters.createdFrom}T00:00:00.000Z` : '',
        createdTo: filters.createdTo ? `${filters.createdTo}T23:59:59.999Z` : '',
        sandbox: filters.sandbox,
        sort: filters.sort,
        limit: String(LIMIT),
        offset: String(filters.offset),
      };
      setResult(await api.searchOrders(query));
      setError(null);

      const url = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (k === 'limit' || k === 'offset' || !v) continue;
        if (Array.isArray(v)) v.forEach((x) => url.append(k, x));
        else url.set(k, v);
      }
      window.history.replaceState(null, '', url.toString() ? `?${url}` : window.location.pathname);
    } catch (e) {
      setError(e instanceof ApiError ? e.text() : 'Search failed.');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    if (authed) void load();
  }, [authed, load]);

  if (authed === null) return null;
  if (!authed) return <LoginForm onSuccess={() => setAuthed(true)} />;

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    // Any filter change resets paging: staying on page 4 of a different result set shows an
    // empty screen and reads as "no matches".
    setFilters((f) => ({ ...f, [key]: value, offset: key === 'offset' ? (value as number) : 0 }));

  const toggleState = (s: string) =>
    set('state', filters.state.includes(s) ? filters.state.filter((x) => x !== s) : [...filters.state, s]);

  const total = result?.total ?? 0;
  const page = Math.floor(filters.offset / LIMIT) + 1;
  const pages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div>
      <h1>Orders</h1>
      <p className="sub">
        Every order, healthy ones included. The <Link href="/">queue</Link> stays the place to
        work from — this is for finding a specific order or answering a question about a set of
        them.
      </p>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-body stack">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void load();
            }}
          >
            <label htmlFor="q">Search</label>
            <div className="row">
              <input
                id="q"
                value={filters.q}
                onChange={(e) => set('q', e.target.value)}
                placeholder="XB-HQKVC288, order id, phone, or customer name"
                style={{ flex: 1 }}
              />
              <button className="btn btn-primary" type="submit" disabled={loading}>
                {loading ? <span className="spinner" /> : 'Search'}
              </button>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => setFilters(EMPTY)}
                disabled={loading}
              >
                Reset
              </button>
            </div>
          </form>

          <div>
            <label>State</label>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              <button
                type="button"
                className={`chip ${filters.state.length === 0 ? 'ok' : 'neutral'}`}
                onClick={() => set('state', [])}
                style={{ cursor: 'pointer', border: 0 }}
              >
                Any
              </button>
              <button
                type="button"
                className="chip neutral"
                onClick={() => set('state', UNPAID)}
                style={{ cursor: 'pointer' }}
              >
                Unpaid
              </button>
              <button
                type="button"
                className="chip neutral"
                onClick={() => set('state', IN_FLIGHT)}
                style={{ cursor: 'pointer' }}
              >
                In flight
              </button>
              <button
                type="button"
                className="chip neutral"
                onClick={() => set('state', ['DELIVERED'])}
                style={{ cursor: 'pointer' }}
              >
                Delivered
              </button>
            </div>
            <div className="row" style={{ flexWrap: 'wrap', gap: 5 }}>
              {STATES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`chip ${filters.state.includes(s) ? 'ok' : 'neutral'}`}
                  onClick={() => toggleState(s)}
                  style={{ cursor: 'pointer' }}
                >
                  {s.replaceAll('_', ' ').toLowerCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="grid-2">
            <div>
              <label htmlFor="minTotal">Total from (IRR)</label>
              <input
                id="minTotal"
                inputMode="numeric"
                value={filters.minTotal}
                onChange={(e) => set('minTotal', e.target.value.replace(/\D/g, ''))}
                placeholder="0"
              />
            </div>
            <div>
              <label htmlFor="maxTotal">Total to (IRR)</label>
              <input
                id="maxTotal"
                inputMode="numeric"
                value={filters.maxTotal}
                onChange={(e) => set('maxTotal', e.target.value.replace(/\D/g, ''))}
                placeholder="no limit"
              />
            </div>
            <div>
              <label htmlFor="createdFrom">Created from</label>
              <input
                id="createdFrom"
                type="date"
                value={filters.createdFrom}
                onChange={(e) => set('createdFrom', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="createdTo">Created to</label>
              <input
                id="createdTo"
                type="date"
                value={filters.createdTo}
                onChange={(e) => set('createdTo', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="sandbox">Demo orders</label>
              <select
                id="sandbox"
                value={filters.sandbox}
                onChange={(e) => set('sandbox', e.target.value as Filters['sandbox'])}
              >
                <option value="exclude">Hide sandbox orders</option>
                <option value="include">Include sandbox orders</option>
                <option value="only">Only sandbox orders</option>
              </select>
            </div>
            <div>
              <label htmlFor="sort">Sort</label>
              <select
                id="sort"
                value={filters.sort}
                onChange={(e) => set('sort', e.target.value as Filters['sort'])}
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="total_desc">Highest value</option>
                <option value="total_asc">Lowest value</option>
                <option value="updated">Recently updated</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {error && <div className="alert alert-crit">{error}</div>}

      <div className="card">
        <div className="card-head">
          <strong>
            {total} {total === 1 ? 'order' : 'orders'}
          </strong>
          <span className="queue-age">
            page {page} of {pages}
          </span>
        </div>

        {result && result.items.length === 0 ? (
          <div className="empty">
            <div className="empty-big">∅</div>
            No order matches these filters.
            {filters.sandbox === 'exclude' && (
              <div style={{ marginTop: 8, fontSize: 12.5 }}>
                Sandbox orders are hidden — a demo order will not appear until you include them.
              </div>
            )}
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Reference</th>
                  <th style={{ textAlign: 'left' }}>Product</th>
                  <th style={{ textAlign: 'left' }}>Customer</th>
                  <th style={{ textAlign: 'left' }}>State</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th style={{ textAlign: 'left' }}>Created</th>
                </tr>
              </thead>
              <tbody>
                {(result?.items ?? []).map((o) => (
                  <OrderRow key={o.id} order={o} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="card-head" style={{ borderTop: '1px solid var(--line-soft)', borderBottom: 0 }}>
          <button
            className="btn btn-ghost"
            disabled={filters.offset === 0 || loading}
            onClick={() => set('offset', Math.max(0, filters.offset - LIMIT))}
          >
            Previous
          </button>
          <button
            className="btn btn-ghost"
            disabled={filters.offset + LIMIT >= total || loading}
            onClick={() => set('offset', filters.offset + LIMIT)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function OrderRow({ order }: { order: AdminOrderRowDto }) {
  return (
    <tr>
      <td>
        <Link href={`/order/?id=${order.id}`} className="mono">
          {order.publicRef}
        </Link>
        {order.isSandbox && (
          <span className="chip neutral" style={{ marginLeft: 6 }}>
            demo
          </span>
        )}
      </td>
      <td>
        <div style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {order.productTitle}
        </div>
        <div className="queue-age">
          {order.marketplace} · ×{order.quantity}
        </div>
      </td>
      <td>
        <div className="mono">{order.customer.phone}</div>
        {order.customer.displayName && <div className="queue-age">{order.customer.displayName}</div>}
      </td>
      <td>
        <span className={`chip ${order.exceptionType ? 'crit' : 'neutral'}`}>
          {order.state.replaceAll('_', ' ').toLowerCase()}
        </span>
        {order.exceptionType && (
          <div className="queue-age" style={{ marginTop: 3 }}>
            {order.exceptionType.replaceAll('_', ' ').toLowerCase()}
          </div>
        )}
      </td>
      <td className="nums" style={{ textAlign: 'right', fontWeight: 650 }}>
        {formatMoney(order.total)}
      </td>
      <td className="queue-age">{new Date(order.createdAt).toLocaleString()}</td>
    </tr>
  );
}
