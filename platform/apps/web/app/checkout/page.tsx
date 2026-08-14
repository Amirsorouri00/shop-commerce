'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { QuoteDto } from '@xb/contracts';
import { api, ApiError, auth, formatMoney, toPersianDigits } from '../../lib/api';
import { QuoteBreakdown } from '../../components/QuoteBreakdown';
import { ProductCard } from '../../components/ProductCard';

/**
 * Checkout.
 *
 * Three steps in one screen: sign in, confirm the address, pay. Login happens *here* rather
 * than up front — a customer should be able to price something without an account, and
 * asking for a phone number before showing a price loses people who were only curious.
 *
 * Query-param routing (`?quote=…`) rather than a dynamic segment, because a static export
 * cannot pre-render `/checkout/[id]` for ids that do not exist yet.
 */
export default function CheckoutPage() {
  return (
    <Suspense fallback={<div className="card">در حال بارگذاری…</div>}>
      <CheckoutInner />
    </Suspense>
  );
}

type Step = 'loading' | 'login' | 'otp' | 'address' | 'paying' | 'error';

function CheckoutInner() {
  const router = useRouter();
  const params = useSearchParams();
  const quoteId = params.get('quote');

  const [quote, setQuote] = useState<QuoteDto | null>(null);
  const [step, setStep] = useState<Step>('loading');
  const [error, setError] = useState<string | null>(null);

  const [phone, setPhone] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [resendIn, setResendIn] = useState(0);

  const [address, setAddress] = useState({
    recipientName: '',
    province: '',
    city: '',
    line1: '',
    postalCode: '',
  });

  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!quoteId) {
      setError('پیش‌فاکتوری یافت نشد.');
      setStep('error');
      return;
    }

    // Revalidate before showing the total. The customer may have left this tab open, and the
    // price they are about to approve must be the one we can actually honour.
    api.quotes
      .refresh(quoteId)
      .then((fresh) => {
        setQuote(fresh);
        setStep(auth.isAuthenticated ? 'address' : 'login');
      })
      .catch((e) => {
        setError(e instanceof ApiError ? e.text('fa') : 'خطا در دریافت قیمت.');
        setStep('error');
      });
  }, [quoteId]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function sendOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.auth.startOtp(phone);
      setChallengeId(res.challengeId);
      setResendIn(res.resendAfter);
      setStep('otp');
    } catch (e) {
      setError(e instanceof ApiError ? e.text('fa') : 'ارسال کد ناموفق بود.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!challengeId) return;
    setBusy(true);
    setError(null);
    try {
      await api.auth.verifyOtp(challengeId, code);
      setStep('address');
    } catch (e) {
      setError(e instanceof ApiError ? e.text('fa') : 'کد نادرست است.');
    } finally {
      setBusy(false);
    }
  }

  async function placeOrder(e: React.FormEvent) {
    e.preventDefault();
    if (!quote) return;
    setBusy(true);
    setError(null);
    setStep('paying');

    try {
      // Persist the address first: an order references it by id, so an order can never
      // carry an address that was never validated.
      const saved = await api.addresses.create({
        recipientName: address.recipientName,
        phone: phone || '09120000000',
        province: address.province,
        city: address.city,
        line1: address.line1,
        postalCode: address.postalCode,
      });

      const order = await api.orders.create(quote.id, saved.id);
      const payment = await api.orders.startPayment(order.id);

      // Off-site to the gateway, exactly as a real IRR gateway would. Settlement comes back
      // server-side, not through this redirect.
      window.location.href = payment.redirectUrl;
    } catch (e) {
      setError(e instanceof ApiError ? e.text('fa') : 'ثبت سفارش ناموفق بود.');
      setStep('address');
      setBusy(false);
    }
  }

  if (step === 'loading') {
    return (
      <div className="card">
        <div className="skeleton" style={{ height: 20, width: '60%', marginBottom: 12 }} />
        <div className="skeleton" style={{ height: 80 }} />
      </div>
    );
  }

  if (step === 'error') {
    return (
      <div className="stack">
        <div className="alert alert-crit" role="alert">
          {error}
        </div>
        <button className="btn btn-ghost" onClick={() => router.push('/')}>
          بازگشت به صفحهٔ نخست
        </button>
      </div>
    );
  }

  return (
    <div className="stack">
      <h1>تکمیل سفارش</h1>

      {quote && (
        <div className="card stack">
          <ProductCard product={quote.productSnapshot} />
          <div className="divider" />
          <QuoteBreakdown quote={quote} />
        </div>
      )}

      {error && (
        <div className="alert alert-crit" role="alert">
          {error}
        </div>
      )}

      {step === 'login' && (
        <form className="card stack" onSubmit={sendOtp}>
          <h2>ورود</h2>
          <p className="muted" style={{ marginTop: -4 }}>
            برای ثبت سفارش، شمارهٔ موبایل خود را وارد کنید.
          </p>

          <div>
            <label htmlFor="phone">شمارهٔ موبایل</label>
            <input
              id="phone"
              name="phone"
              type="tel"
              inputMode="numeric"
              dir="ltr"
              placeholder="09121234567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </div>

          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? <span className="spinner" /> : 'ارسال کد تأیید'}
          </button>
        </form>
      )}

      {step === 'otp' && (
        <form className="card stack" onSubmit={verifyOtp}>
          <h2>کد تأیید</h2>
          <p className="muted" style={{ marginTop: -4 }}>
            کد ارسال‌شده به <span className="ltr">{phone}</span> را وارد کنید.
          </p>

          <div>
            <label htmlFor="code">کد شش‌رقمی</label>
            <input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              dir="ltr"
              style={{ letterSpacing: '0.4em', textAlign: 'center', fontSize: 20 }}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </div>

          <button className="btn btn-primary btn-block" disabled={busy || code.length < 6}>
            {busy ? <span className="spinner" /> : 'تأیید و ادامه'}
          </button>

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={resendIn > 0}
            onClick={() => void sendOtp(new Event('submit') as unknown as React.FormEvent)}
          >
            {resendIn > 0
              ? `ارسال دوباره تا ${toPersianDigits(resendIn)} ثانیه`
              : 'ارسال دوبارهٔ کد'}
          </button>
        </form>
      )}

      {(step === 'address' || step === 'paying') && (
        <form className="card stack" onSubmit={placeOrder}>
          <h2>نشانی تحویل</h2>

          <div>
            <label htmlFor="recipient">نام گیرنده</label>
            <input
              id="recipient"
              value={address.recipientName}
              onChange={(e) => setAddress({ ...address, recipientName: e.target.value })}
              required
            />
          </div>

          <div className="row" style={{ gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label htmlFor="province">استان</label>
              <input
                id="province"
                value={address.province}
                onChange={(e) => setAddress({ ...address, province: e.target.value })}
                required
              />
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="city">شهر</label>
              <input
                id="city"
                value={address.city}
                onChange={(e) => setAddress({ ...address, city: e.target.value })}
                required
              />
            </div>
          </div>

          <div>
            <label htmlFor="line1">نشانی کامل</label>
            <textarea
              id="line1"
              rows={3}
              value={address.line1}
              onChange={(e) => setAddress({ ...address, line1: e.target.value })}
              required
            />
          </div>

          <div>
            <label htmlFor="postal">کد پستی</label>
            <input
              id="postal"
              inputMode="numeric"
              dir="ltr"
              maxLength={10}
              value={address.postalCode}
              onChange={(e) => setAddress({ ...address, postalCode: e.target.value })}
              required
            />
          </div>

          <div className="divider" />

          <div className="row-between">
            <strong>مبلغ قابل پرداخت</strong>
            <strong style={{ fontSize: 18 }}>
              {quote ? formatMoney(quote.finalPrice, 'fa') : '—'}
            </strong>
          </div>

          <button className="btn btn-accent btn-block" disabled={busy}>
            {step === 'paying' ? (
              <>
                <span className="spinner" /> در حال انتقال به درگاه…
              </>
            ) : (
              'پرداخت و ثبت سفارش'
            )}
          </button>

          <p className="muted" style={{ margin: 0, textAlign: 'center' }}>
            پرداخت موفق به معنای خرید قطعی کالا نیست؛ پس از پرداخت، خرید توسط تیم ما انجام و
            نتیجه به شما اطلاع داده می‌شود.
          </p>
        </form>
      )}
    </div>
  );
}
