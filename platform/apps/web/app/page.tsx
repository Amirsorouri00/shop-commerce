'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ProductRequestDto, QuoteDto } from '@xb/contracts';
import { api, ApiError, formatMoney, toPersianDigits } from '../lib/api';
import { QuoteBreakdown } from '../components/QuoteBreakdown';
import { ProductCard } from '../components/ProductCard';

/**
 * The one flow: paste a link, see a price, order it.
 *
 * Deliberately a single screen through to the quote. Every extra step between "I found the
 * thing I want" and "here is what it costs" is a place to lose someone, and this product's
 * entire premise is that the link *is* the interface.
 */
export default function HomePage() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [quantity, setQuantity] = useState(1);

  const [resolving, setResolving] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [request, setRequest] = useState<ProductRequestDto | null>(null);
  const [quote, setQuote] = useState<QuoteDto | null>(null);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);

  async function handleResolve(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setQuote(null);
    setResolving(true);

    try {
      const result = await api.catalog.resolve(url.trim());
      setRequest(result);

      if (result.status === 'FAILED') {
        setError({
          message: 'این کالا شناسایی نشد. لطفاً پیوند را بررسی کنید یا کالای دیگری را امتحان کنید.',
        });
      }
    } catch (e) {
      if (e instanceof ApiError) {
        const fields = e.fieldErrors('fa');
        setError({ message: fields['url'] ?? e.text('fa'), field: fields['url'] ? 'url' : undefined });
      } else {
        setError({ message: 'ارتباط با سرور برقرار نشد. اتصال خود را بررسی کنید.' });
      }
    } finally {
      setResolving(false);
    }
  }

  async function handleQuote() {
    if (!request) return;
    setError(null);
    setQuoting(true);

    try {
      setQuote(await api.quotes.create(request.id, quantity));
    } catch (e) {
      setError({ message: e instanceof ApiError ? e.text('fa') : 'خطا در محاسبهٔ قیمت.' });
    } finally {
      setQuoting(false);
    }
  }

  function proceedToCheckout() {
    if (quote) router.push(`/checkout/?quote=${quote.id}`);
  }

  return (
    <div className="stack">
      <section>
        <h1>هر کالایی از آمازون، تحویل در ایران</h1>
        <p className="lede">
          پیوند کالا را بفرستید تا قیمت نهایی را به تومان — شامل حمل، گمرک و کارمزد — پیش از
          پرداخت ببینید.
        </p>
      </section>

      <form onSubmit={handleResolve} className="card">
        <label htmlFor="url">پیوند کالا</label>
        <input
          id="url"
          name="url"
          type="url"
          inputMode="url"
          dir="ltr"
          placeholder="https://www.amazon.ae/dp/..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-invalid={error?.field === 'url'}
          aria-describedby={error?.field === 'url' ? 'url-error' : undefined}
          required
        />

        {error?.field === 'url' && (
          <div className="field-error" id="url-error" role="alert">
            <span aria-hidden="true">⚠</span>
            <span>{error.message}</span>
          </div>
        )}

        <button
          type="submit"
          className="btn btn-primary btn-block"
          style={{ marginTop: 14 }}
          disabled={resolving || url.trim().length === 0}
        >
          {resolving ? (
            <>
              <span className="spinner" aria-hidden="true" /> در حال بررسی کالا…
            </>
          ) : (
            'بررسی کالا'
          )}
        </button>

        <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>
          در حال حاضر از <span className="ltr">amazon.ae</span> پشتیبانی می‌کنیم.
        </p>
      </form>

      {error && !error.field && (
        <div className="alert alert-crit" role="alert">
          {error.message}
        </div>
      )}

      {resolving && <ProductSkeleton />}

      {request?.product && !resolving && (
        <div className="card stack">
          <ProductCard product={request.product} />

          {request.status === 'NEEDS_REVIEW' && (
            <div className="alert alert-warn">
              برخی اطلاعات این کالا (مانند وزن) دقیق نیست و قیمت ممکن است پس از بررسی کارشناس
              تغییر کند.
            </div>
          )}

          {!request.product.available && (
            <div className="alert alert-crit">این کالا در حال حاضر موجود نیست.</div>
          )}

          {request.product.available && (
            <>
              <div className="divider" />

              <div className="row-between">
                <label htmlFor="qty" style={{ margin: 0 }}>
                  تعداد
                </label>
                <select
                  id="qty"
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  style={{ width: 100 }}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {toPersianDigits(n)}
                    </option>
                  ))}
                </select>
              </div>

              <button
                className="btn btn-accent btn-block"
                onClick={() => void handleQuote()}
                disabled={quoting}
              >
                {quoting ? (
                  <>
                    <span className="spinner" aria-hidden="true" /> محاسبهٔ قیمت…
                  </>
                ) : (
                  'مشاهدهٔ قیمت نهایی'
                )}
              </button>
            </>
          )}
        </div>
      )}

      {quote && (
        <div className="card stack">
          <div className="row-between">
            <h2 style={{ margin: 0 }}>قیمت نهایی</h2>
            <QuoteCountdown expiresAt={quote.expiresAt} />
          </div>

          <QuoteBreakdown quote={quote} />

          {!quote.viable && (
            <div className="alert alert-warn">
              هزینهٔ ارسال این کالا نسبت به ارزش آن زیاد است و سفارش آن به‌صرفه نیست.
            </div>
          )}

          <button
            className="btn btn-primary btn-block"
            onClick={proceedToCheckout}
            disabled={!quote.viable}
          >
            ادامه و ثبت سفارش
          </button>

          <p className="muted" style={{ margin: 0, textAlign: 'center' }}>
            پیش از پرداخت، قیمت و موجودی دوباره بررسی می‌شود.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Quote TTL countdown.
 *
 * The quote genuinely expires — the price is locked against an FX rate and a live offer that
 * both move — so showing the remaining time is honest rather than a pressure tactic.
 */
function QuoteCountdown({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000)),
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setRemaining(Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;

  return (
    <span className={`badge ${remaining < 60 ? 'badge-warn' : 'badge-neutral'}`}>
      اعتبار: {toPersianDigits(minutes)}:{toPersianDigits(String(seconds).padStart(2, '0'))}
    </span>
  );
}

function ProductSkeleton() {
  return (
    <div className="card">
      <div className="product">
        <div className="skeleton" style={{ width: 84, height: 84 }} />
        <div className="stack-sm" style={{ flex: 1 }}>
          <div className="skeleton" style={{ height: 16, width: '80%' }} />
          <div className="skeleton" style={{ height: 14, width: '45%' }} />
          <div className="skeleton" style={{ height: 20, width: '30%' }} />
        </div>
      </div>
    </div>
  );
}
