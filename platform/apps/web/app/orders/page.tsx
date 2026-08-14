'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { OrderSummaryDto } from '@xb/contracts';
import { api, ApiError, auth, formatMoney, formatRelativeTime } from '../../lib/api';
import { STATE_BADGES } from '../../lib/order-display';

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.isAuthenticated) {
      setError('برای مشاهدهٔ سفارش‌ها وارد حساب خود شوید.');
      setOrders([]);
      return;
    }

    api.orders
      .list()
      .then((page) => setOrders(page.items))
      .catch((e) => {
        setError(e instanceof ApiError ? e.text('fa') : 'خطا در دریافت سفارش‌ها.');
        setOrders([]);
      });
  }, []);

  if (orders === null) {
    return (
      <div className="stack">
        <h1>سفارش‌های من</h1>
        {[1, 2, 3].map((i) => (
          <div className="card" key={i}>
            <div className="skeleton" style={{ height: 60 }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="stack">
      <h1>سفارش‌های من</h1>

      {error && <div className="alert alert-info">{error}</div>}

      {orders.length === 0 && !error && (
        <div className="empty">
          <p>هنوز سفارشی ثبت نکرده‌اید.</p>
          <Link href="/" className="btn btn-primary">
            ثبت اولین سفارش
          </Link>
        </div>
      )}

      {orders.map((order) => {
        const badge = STATE_BADGES[order.state] ?? {
          tone: 'badge-neutral' as const,
          label: order.state,
        };

        return (
          <Link
            key={order.id}
            href={`/track/?id=${order.id}`}
            className="card"
            style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
          >
            <div className="product">
              {order.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="product-img" src={order.imageUrl} alt="" loading="lazy" />
              ) : (
                <div className="product-img" aria-hidden="true" />
              )}

              <div>
                <h3 className="product-title">{order.title}</h3>

                <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
                  <span className={`badge ${badge.tone}`}>{badge.label}</span>
                  <span className="muted mono">{order.publicRef}</span>
                </div>

                <div className="row-between">
                  <span className="muted">{formatRelativeTime(order.createdAt, 'fa')}</span>
                  <strong>{formatMoney(order.finalPrice, 'fa')}</strong>
                </div>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
