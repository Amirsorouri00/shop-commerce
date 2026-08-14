'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '../../../lib/api';

/**
 * Gateway return page.
 *
 * The redirect back from a gateway is **not** proof of payment — anyone can craft this URL.
 * Settlement is confirmed by the gateway's signed webhook (or, in the sandbox, by the
 * simulated gateway calling the same settlement path server-side).
 *
 * So this page asserts nothing. It polls the order until the server says it is paid, then
 * forwards to tracking. That is the only honest thing a return page can do.
 */
export default function CheckoutReturnPage() {
  return (
    <Suspense fallback={<div className="card">در حال بررسی…</div>}>
      <ReturnInner />
    </Suspense>
  );
}

const SETTLED_STATES = [
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
];

function ReturnInner() {
  const router = useRouter();
  const params = useSearchParams();
  const ref = params.get('ref');
  const orderId = params.get('order');

  const [elapsed, setElapsed] = useState(0);
  const [state, setState] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!orderId) return;

    let cancelled = false;

    const poll = async (): Promise<void> => {
      try {
        const order = await api.orders.get(orderId);
        if (cancelled) return;
        setState(order.state);

        if (SETTLED_STATES.includes(order.state)) {
          router.replace(`/track/?id=${orderId}`);
        }
      } catch (e) {
        if (e instanceof ApiError && e.status >= 500) setFailed(true);
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), 2_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [orderId, router]);

  return (
    <div className="stack">
      <div className="card" style={{ textAlign: 'center', padding: 32 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }} aria-hidden="true">
          {failed ? '⚠' : '⏳'}
        </div>

        <h1>در حال تأیید پرداخت</h1>

        <p className="lede" style={{ marginBottom: 20 }}>
          پرداخت شما نزد درگاه ثبت شد و در حال تأیید نهایی است. این کار معمولاً چند ثانیه طول
          می‌کشد.
        </p>

        {ref && (
          <p className="muted">
            کد پیگیری پرداخت: <span className="mono">{ref}</span>
          </p>
        )}

        {state && state === 'AWAITING_PAYMENT' && elapsed > 8 && (
          <div className="alert alert-warn" style={{ marginTop: 16, textAlign: 'start' }}>
            هنوز تأییدیه‌ای از درگاه دریافت نشده است. اگر پرداخت را انجام داده‌اید، مبلغ محفوظ
            است و سفارش به‌محض تأیید ثبت می‌شود.
          </div>
        )}

        {elapsed > 25 && (
          <div className="alert alert-info" style={{ marginTop: 16, textAlign: 'start' }}>
            تأیید کمی طولانی شده است. نگران نباشید — اگر مبلغی کسر شده باشد، سفارش شما ثبت
            می‌شود. وضعیت را در بخش سفارش‌ها دنبال کنید.
          </div>
        )}

        <div className="row" style={{ marginTop: 20, gap: 10 }}>
          {orderId && (
            <Link href={`/track/?id=${orderId}`} className="btn btn-primary" style={{ flex: 1 }}>
              پیگیری سفارش
            </Link>
          )}
          <Link href="/orders" className="btn btn-ghost" style={{ flex: 1 }}>
            سفارش‌های من
          </Link>
        </div>
      </div>
    </div>
  );
}
