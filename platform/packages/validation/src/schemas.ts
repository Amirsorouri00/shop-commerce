import { z } from 'zod';
import { CURRENCIES } from '@xb/core';
import { CUSTOM_MESSAGES } from './messages.ts';
import {
  normalizeDigits,
  normalizeForDisplay,
  normalizeIranianMobile,
  isValidNationalId,
} from './persian.ts';

/**
 * Reusable validated primitives.
 *
 * Each of these *normalises before it validates*, so a Persian-keyboard user and an
 * English-keyboard user reach the same stored value. The transform runs first; the check
 * runs on the normalised form. That ordering is the whole point — validating raw input and
 * normalising afterwards would reject numbers that are perfectly valid once folded.
 *
 * Refinements attach their bilingual copy via `params.message`, which the translator in
 * `messages.ts` picks up.
 */

const withMessage = (key: keyof typeof CUSTOM_MESSAGES, code: string) => ({
  params: { code, message: CUSTOM_MESSAGES[key] },
});

/** Iranian mobile number. Accepts every common local form; stores E.164. */
export const iranianMobile = z
  .string()
  .trim()
  .transform((v) => normalizeIranianMobile(v))
  .refine((v): v is string => v !== null, withMessage('iranianMobile', 'phone.invalid'));

/** Iranian national ID, checksum-verified. Required for customs clearance. */
export const nationalId = z
  .string()
  .trim()
  .transform((v) => normalizeDigits(v).replace(/\D/g, ''))
  .refine(isValidNationalId, withMessage('nationalId', 'nationalId.invalid'));

/** Six-digit OTP. Persian digits accepted. */
export const otpCode = z
  .string()
  .trim()
  .transform((v) => normalizeDigits(v).replace(/\D/g, ''))
  .refine((v) => /^\d{6}$/.test(v), withMessage('otpCode', 'otp.invalid'));

/** Iranian postal code — ten digits, and the fifth digit is never 5 or 2 by allocation rule. */
export const postalCode = z
  .string()
  .trim()
  .transform((v) => normalizeDigits(v).replace(/\D/g, ''))
  .refine((v) => /^\d{10}$/.test(v), withMessage('postalCode', 'postalCode.invalid'));

/** Free text that will be displayed back: folded and whitespace-collapsed, ZWNJ preserved. */
export const displayText = (max: number) =>
  z
    .string()
    .transform(normalizeForDisplay)
    .pipe(z.string().min(1).max(max));

/** Optional display text — empty string becomes undefined rather than a blank record. */
export const optionalDisplayText = (max: number) =>
  z
    .string()
    .transform((v) => {
      const n = normalizeForDisplay(v);
      return n.length === 0 ? undefined : n;
    })
    .pipe(z.string().max(max).optional());

/** A marketplace URL we can actually resolve. */
const SUPPORTED_HOSTS = ['amazon.ae', 'www.amazon.ae'] as const;

export const marketplaceUrl = z
  .string()
  .trim()
  .url()
  .refine((v) => {
    try {
      const host = new URL(v).hostname.toLowerCase();
      return (SUPPORTED_HOSTS as readonly string[]).includes(host);
    } catch {
      return false;
    }
  }, withMessage('supportedMarketplace', 'url.unsupportedMarketplace'));

/** Money on the wire. Integer minor units plus an explicit currency — never a float. */
export const moneySchema = z.object({
  amount: z.number().int(),
  currency: z.enum(CURRENCIES),
});

export const positiveMoneySchema = moneySchema.refine(
  (m) => m.amount > 0,
  withMessage('positiveMoney', 'money.notPositive'),
);

/** An integer that may arrive as a Persian-digit string from a form field. */
export const flexibleInt = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === 'number' ? v : Number(normalizeDigits(v.trim()))))
  .pipe(z.number().int());

export const uuidSchema = z.string().uuid();

/** Cursor pagination. Offsets are not offered — see the API conventions. */
export const paginationSchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const localeSchema = z.enum(['fa', 'en']).default('fa');

/**
 * Field labels used by the translator to build readable messages.
 * Registered centrally so the same field reads the same way on every endpoint.
 */
export const FIELD_LABELS = {
  phone: { en: 'Phone number', fa: 'شمارهٔ موبایل' },
  code: { en: 'Verification code', fa: 'کد تأیید' },
  url: { en: 'Product link', fa: 'پیوند کالا' },
  quantity: { en: 'Quantity', fa: 'تعداد' },
  variant: { en: 'Variant', fa: 'گونهٔ کالا' },
  quoteId: { en: 'Quote', fa: 'پیش‌فاکتور' },
  addressId: { en: 'Delivery address', fa: 'نشانی تحویل' },
  requestId: { en: 'Request', fa: 'درخواست' },
  note: { en: 'Note', fa: 'یادداشت' },
  reason: { en: 'Reason', fa: 'دلیل' },
  nationalId: { en: 'National ID', fa: 'کد ملی' },
  postalCode: { en: 'Postal code', fa: 'کد پستی' },
  displayName: { en: 'Name', fa: 'نام' },
  line1: { en: 'Address', fa: 'نشانی' },
  city: { en: 'City', fa: 'شهر' },
  province: { en: 'Province', fa: 'استان' },
  recipientName: { en: 'Recipient name', fa: 'نام گیرنده' },
  newMaxPrice: { en: 'Maximum price', fa: 'حداکثر قیمت' },
  to: { en: 'Target state', fa: 'وضعیت مقصد' },
  limit: { en: 'Page size', fa: 'تعداد در هر صفحه' },
  cursor: { en: 'Page cursor', fa: 'نشانگر صفحه' },
} as const;
