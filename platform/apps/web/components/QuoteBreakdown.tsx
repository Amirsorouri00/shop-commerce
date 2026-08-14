'use client';

import type { QuoteDto } from '@xb/contracts';
import { formatMoney, toPersianDigits } from '../lib/api';

/**
 * The full itemised price.
 *
 * Shown in full, always, before payment. The transparency *is* the product — the alternative
 * is a customer who does not know what they are paying for and who disputes the total when
 * it arrives.
 */
export function QuoteBreakdown({ quote }: { quote: QuoteDto }) {
  const lines: { label: string; value: QuoteDto['finalPrice']; hint?: string }[] = [
    { label: 'قیمت کالا', value: quote.breakdown.product },
    { label: 'حمل بین‌المللی', value: quote.breakdown.freight, hint: 'بر اساس وزن قابل‌محاسبه' },
    { label: 'انبارداری و بسته‌بندی', value: quote.breakdown.handling },
    { label: 'حقوق گمرکی (برآورد)', value: quote.breakdown.customs },
    { label: 'بیمهٔ محموله', value: quote.breakdown.insurance },
    { label: 'ارسال داخل ایران', value: quote.breakdown.lastMile },
    { label: 'کارمزد خدمات', value: quote.breakdown.serviceFee },
  ];

  return (
    <div>
      <div className="breakdown">
        {lines.map((line) => (
          <div className="breakdown-row" key={line.label}>
            <span className="breakdown-label">
              {line.label}
              {line.hint && (
                <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                  {line.hint}
                </span>
              )}
            </span>
            <span className="breakdown-value">{formatMoney(line.value, 'fa')}</span>
          </div>
        ))}
      </div>

      <div className="breakdown-row breakdown-total">
        <span>مبلغ نهایی</span>
        <span className="nums">{formatMoney(quote.finalPrice, 'fa')}</span>
      </div>

      <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
        نرخ ارز محاسبه‌شده: هر واحد{' '}
        <span className="nums">{toPersianDigits(Math.round(quote.fxRate).toLocaleString('fa-IR'))}</span>{' '}
        ریال · تعداد: {toPersianDigits(quote.quantity)}
      </p>
    </div>
  );
}
