import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ValidationError } from '@xb/core';
import { parseOrThrow, parseSafe, translateIssues } from './parse.ts';
import { iranianMobile, otpCode, marketplaceUrl, nationalId, flexibleInt } from './schemas.ts';

describe('bilingual issues', () => {
  const schema = z.object({
    quantity: z.number().int().min(1).max(10),
    note: z.string().max(5),
  });

  it('returns both locales for every issue', () => {
    const r = parseSafe(schema, { quantity: 99, note: 'far too long' });
    expect(r.ok).toBe(false);
    if (r.ok) return;

    const quantity = r.issues.find((i) => i.path === 'quantity')!;
    expect(quantity.code).toBe('number.max');
    expect(quantity.params).toMatchObject({ maximum: 10 });
    expect(quantity.message.en).toBe('Quantity must be at most 10.');
    // Persian copy uses Persian digits, and the registered field label.
    expect(quantity.message.fa).toContain('تعداد');
    expect(quantity.message.fa).toContain('۱۰');
  });

  it('reports a missing field as required, not as a type error', () => {
    const r = parseSafe(schema, { note: 'ok' });
    if (r.ok) throw new Error('expected failure');
    const issue = r.issues.find((i) => i.path === 'quantity')!;
    expect(issue.code).toBe('required');
    expect(issue.message.en).toBe('Quantity is required.');
    expect(issue.message.fa).toBe('تعداد الزامی است.');
  });

  it('keeps only the first issue per field', () => {
    const r = parseSafe(z.object({ quantity: z.number().int().min(5).max(1) }), { quantity: 3 });
    if (r.ok) throw new Error('expected failure');
    expect(r.issues.filter((i) => i.path === 'quantity')).toHaveLength(1);
  });

  it('throws a ValidationError carrying the issues', () => {
    try {
      parseOrThrow(schema, { quantity: 0, note: '' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      const err = e as ValidationError;
      expect(err.httpStatus).toBe(422);
      expect(err.code).toBe('VALIDATION_FAILED');
      expect(err.issues.length).toBeGreaterThan(0);
      const envelope = err.toEnvelope('trace-1');
      expect(envelope.error.traceId).toBe('trace-1');
      expect(envelope.error.message.fa).toBeTruthy();
      expect(envelope.error.issues).toBeDefined();
    }
  });

  it('omits internal details from the client envelope', () => {
    const err = new ValidationError([], { details: { secret: 'do-not-leak' } });
    expect(JSON.stringify(err.toEnvelope('t'))).not.toContain('do-not-leak');
  });
});

describe('normalise-then-validate', () => {
  it('accepts a mobile number in every common form', () => {
    for (const input of [
      '09121234567',
      '0912 123 4567',
      '0912-123-4567',
      '+989121234567',
      '00989121234567',
      '9121234567',
      '۰۹۱۲۱۲۳۴۵۶۷',
    ]) {
      expect(parseOrThrow(iranianMobile, input)).toBe('+989121234567');
    }
  });

  it('rejects a landline with bilingual copy', () => {
    const r = parseSafe(z.object({ phone: iranianMobile }), { phone: '02112345678' });
    if (r.ok) throw new Error('expected failure');
    expect(r.issues[0]!.code).toBe('phone.invalid');
    expect(r.issues[0]!.message.en).toContain('Iranian mobile number');
    expect(r.issues[0]!.message.fa).toContain('موبایل');
  });

  it('accepts Persian digits in an OTP', () => {
    expect(parseOrThrow(otpCode, '۱۲۳۴۵۶')).toBe('123456');
    expect(parseOrThrow(otpCode, '123456')).toBe('123456');
  });

  it('validates the national ID checksum', () => {
    expect(parseOrThrow(nationalId, '0499370899')).toBe('0499370899');
    expect(parseSafe(nationalId, '0499370898').ok).toBe(false);
  });

  it('coerces a Persian-digit string to an integer', () => {
    expect(parseOrThrow(flexibleInt, '۴۲')).toBe(42);
    expect(parseOrThrow(flexibleInt, 42)).toBe(42);
  });
});

describe('marketplace URL gate', () => {
  it('accepts a supported host', () => {
    const url = 'https://www.amazon.ae/dp/B0CHWRXH8B';
    expect(parseOrThrow(marketplaceUrl, url)).toBe(url);
  });

  it('rejects an unsupported marketplace with actionable copy', () => {
    const r = parseSafe(z.object({ url: marketplaceUrl }), { url: 'https://ebay.com/itm/1' });
    if (r.ok) throw new Error('expected failure');
    expect(r.issues[0]!.code).toBe('url.unsupportedMarketplace');
    expect(r.issues[0]!.message.en).toContain('amazon.ae');
    expect(r.issues[0]!.message.fa).toContain('آمازون');
  });

  it('rejects a host that merely contains the supported one', () => {
    expect(parseSafe(marketplaceUrl, 'https://amazon.ae.evil.com/dp/X').ok).toBe(false);
  });
});

describe('translateIssues', () => {
  it('falls back to the raw path when a field has no registered label', () => {
    const r = z.object({ someUnregisteredField: z.string() }).safeParse({});
    if (r.success) throw new Error('expected failure');
    const issues = translateIssues(r.error.issues);
    expect(issues[0]!.message.en).toBe('someUnregisteredField is required.');
  });
});
