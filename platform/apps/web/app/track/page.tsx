'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { OrderDto } from '@xb/contracts';
import { api, ApiError, formatMoney, sandbox } from '../../lib/api';
import { OrderTimeline } from '../../components/OrderTimeline';
import { ProductCard } from '../../components/ProductCard';
import { STATE_BADGES } from '../../lib/order-display';

/**
 * Order tracking.
 *
 * Polls rather than holding a socket. A tracking page is left open for days on a phone that
 * sleeps and changes network; a polling client reconnects by simply making its next request,
 * whereas a socket needs reconnection logic that is easy to get subtly wrong. The WebSocket
 * channel exists on the API for the ops console, where sessions are short and attended.
 */
export default function TrackPage() {
  return (
    <Suspense fallback={<div className="card">در حال بارگذاری…</div>}>
      <TrackInner />
    </Suspense>
  );
}

function TrackInner() {
  const params = useSearchParams();
  const orderId = params.get('id');

  const [order, setOrder] = useState<OrderDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (!orderId) return;
      if (!silent) setRefreshing(true);
      try {
        setOrder(await api.orders.get(orderId));
        setError(null);
      } catch (e) {
        setError(e instanceof ApiError ? e.text('fa') : 'خطا در دریافت وضعیت سفارش.');
      } finally {
        setRefreshing(false);
      }
    },
    [orderId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while the order is still moving. A delivered order does not change again, so
  // polling one forever is pure waste on someone's mobile data.
  useEffect(() => {
    if (!order) return;
    const settled = ['DELIVERED', 'REFUNDED', 'CANCELLED'].includes(order.state);
    if (settled) return;

    const timer = setInterval(() => void load(true), 15_000);
    return () => clearInterval(timer);
  }, [order, load]);

  if (!orderId) {
    return <div className="alert alert-crit">شناسهٔ سفارش مشخص نیست.</div>;
  }

  if (!order && !error) {
    return (
      <div className="stack">
        <div className="card">
          <div className="skeleton" style={{ height: 84, marginBottom: 14 }} />
          <div className="skeleton" style={{ height: 200 }} />
        </div>
      </div>
    );
  }

  if (error && !order) {
    return (
      <div className="stack">
        <div className="alert alert-crit">{error}</div>
        <Link href="/orders" className="btn btn-ghost">
          بازگشت به سفارش‌ها
        </Link>
      </div>
    );
  }

  if (!order) return null;

  const badge = STATE_BADGES[order.state] ?? { tone: 'badge-neutral' as const, label: order.state };

  return (
    <div className="stack">
      <div className="row-between">
        <h1 style={{ margin: 0 }}>پیگیری سفارش</h1>
        <span className="mono muted">{order.publicRef}</span>
      </div>

      {/* Exception banner. Placed above the timeline because if something is wrong, that is
          the thing the customer opened this page to find out. */}
      {order.alert && (
        <div className={`alert ${order.alert.actionable ? 'alert-warn' : 'alert-info'}`} role="status">
          <strong style={{ display: 'block', marginBottom: 4 }}>
            {badge.label}
          </strong>
          {order.alert.message.fa}
        </div>
      )}

      <div className="card">
        <ProductCard product={order.quote.productSnapshot} />

        <div className="divider" />

        <div className="row-between">
          <span className="muted">مبلغ پرداخت‌شده</span>
          <strong>{formatMoney(order.quote.finalPrice, 'fa')}</strong>
        </div>
      </div>

      <div className="card">
        <div className="row-between" style={{ marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>وضعیت ارسال</h2>
          <span className={`badge ${badge.tone}`}>{badge.label}</span>
        </div>

        <OrderTimeline steps={order.timeline} />

        <div className="divider" />

        <div className="row-between">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => void load()}
            disabled={refreshing}
          >
            {refreshing ? <span className="spinner" /> : '↻'} به‌روزرسانی
          </button>

          {sandbox.active && (
            <span className="muted" style={{ fontSize: 12 }}>
              برای دیدن مراحل بعدی، زمان را از پنل نمایشی جلو ببرید.
            </span>
          )}
        </div>
      </div>

      <Link href="/orders" className="btn btn-ghost">
        بازگشت به سفارش‌ها
      </Link>
    </div>
  );
}
