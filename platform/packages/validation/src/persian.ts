/**
 * Persian text normalisation.
 *
 * Persian input arrives in more forms than it looks. Three things break naive validation:
 *
 *   1. Digits. A user typing on a Persian keyboard produces ۱۲۳ (U+06F1..), an Arabic
 *      keyboard produces ١٢٣ (U+0661..), and both mean 123. Number parsing must see 123.
 *
 *   2. Yeh and kaf. Arabic ي/ك and Persian ی/ک are different codepoints that render almost
 *      identically. Without folding, "علی" typed two ways are two different strings, so
 *      uniqueness checks and search silently fail.
 *
 *   3. Zero-width characters. ZWNJ (U+200C) is meaningful in Persian — it makes می‌رود one
 *      word — so it must survive into display. But it must be ignored when comparing, or
 *      "می‌رود" and "میرود" are unequal to the database and equal to the reader.
 *
 * The rule: normalise for *comparison and parsing*, preserve the original for *display*.
 */

const PERSIAN_ZERO = 0x06f0; // ۰
const ARABIC_ZERO = 0x0660; // ٠

/** Convert Persian and Arabic-Indic digits to ASCII. Leaves everything else alone. */
export function normalizeDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const cp = ch.codePointAt(0)!;
    if (cp >= PERSIAN_ZERO && cp <= PERSIAN_ZERO + 9) {
      out += String(cp - PERSIAN_ZERO);
    } else if (cp >= ARABIC_ZERO && cp <= ARABIC_ZERO + 9) {
      out += String(cp - ARABIC_ZERO);
    } else if (ch === '٫') {
      out += '.'; // Arabic decimal separator
    } else if (ch === '٬') {
      continue; // Arabic thousands separator — drop it
    } else {
      out += ch;
    }
  }
  return out;
}

/** Render ASCII digits as Persian, for display only. */
export function toPersianDigits(input: string): string {
  return input.replace(/\d/g, (d) => String.fromCodePoint(PERSIAN_ZERO + Number(d)));
}

/** Fold Arabic letterforms to their Persian equivalents. */
export function normalizeLetters(input: string): string {
  return input
    .replace(/ي/g, 'ی') // ي -> ی
    .replace(/ى/g, 'ی') // ى -> ی
    .replace(/ك/g, 'ک') // ك -> ک
    .replace(/ة/g, 'ه') // ة -> ه
    .replace(/ؤ/g, 'و') // ؤ -> و
    .replace(/[أإآ]/g, 'ا'); // أ إ آ -> ا
}

/** Strip diacritics (harakat) — decorative in Persian and never significant for identity. */
export function stripDiacritics(input: string): string {
  // U+064B..U+0652 harakat, U+0653..U+0655 maddah and hamza marks, U+0670 superscript alef.
  return input.replace(/[\u064B-\u0655\u0670]/g, "");
}

/**
 * Remove zero-width characters.
 *
 * Written with escapes rather than literal characters on purpose: these codepoints are
 * invisible in a source file, so a literal character class is impossible to review and
 * trivial to corrupt with an editor that trims or reflows whitespace.
 *
 * ZWSP U+200B · ZWNJ U+200C · ZWJ U+200D · LRM U+200E · RLM U+200F · BOM U+FEFF
 */
export function stripZeroWidth(input: string, keepZwnj = true): string {
  const pattern = keepZwnj
    ? /[\u200B\u200D-\u200F\uFEFF]/g // everything except ZWNJ, which carries meaning
    : /[\u200B-\u200F\uFEFF]/g;      // including ZWNJ, for comparison keys
  return input.replace(pattern, "");
}

/**
 * Normalise for storage and display: digits and letters folded, invisible junk removed,
 * ZWNJ preserved because it carries meaning, whitespace collapsed.
 */
export function normalizeForDisplay(input: string): string {
  return stripZeroWidth(normalizeLetters(stripDiacritics(input)))
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Normalise for comparison: everything above, plus ZWNJ removed and case folded.
 * Use this for uniqueness keys and search — never for what you show back to the user.
 */
export function normalizeForComparison(input: string): string {
  return stripZeroWidth(normalizeForDisplay(normalizeDigits(input)), false).toLowerCase();
}

// ─────────────────────────── phone numbers ───────────────────────────

/**
 * Iranian mobile numbers, in every form a user actually types.
 *
 * Accepts: 09121234567 · 9121234567 · +989121234567 · 00989121234567 · ۰۹۱۲۱۲۳۴۵۶۷
 * and the same with spaces or dashes anywhere. Returns E.164, or null if it isn't one.
 */
export function normalizeIranianMobile(input: string): string | null {
  const digitsOnly = normalizeDigits(input).replace(/[\s\-()._]/g, '');

  let national: string | null = null;

  if (/^\+98\d{10}$/.test(digitsOnly)) national = digitsOnly.slice(3);
  else if (/^0098\d{10}$/.test(digitsOnly)) national = digitsOnly.slice(4);
  else if (/^98\d{10}$/.test(digitsOnly)) national = digitsOnly.slice(2);
  else if (/^0\d{10}$/.test(digitsOnly)) national = digitsOnly.slice(1);
  else if (/^\d{10}$/.test(digitsOnly)) national = digitsOnly;

  // Every Iranian mobile prefix is 9xx.
  if (national === null || !/^9\d{9}$/.test(national)) return null;

  return `+98${national}`;
}

export function isIranianMobile(input: string): boolean {
  return normalizeIranianMobile(input) !== null;
}

/** Format E.164 back to the local form Iranians read: 0912 123 4567. */
export function formatIranianMobile(e164: string, locale: 'en' | 'fa' = 'fa'): string {
  const m = /^\+98(\d{3})(\d{3})(\d{4})$/.exec(e164);
  if (!m) return e164;
  const local = `0${m[1]} ${m[2]} ${m[3]}`;
  return locale === 'fa' ? toPersianDigits(local) : local;
}

// ─────────────────────────── national id ───────────────────────────

/**
 * Iranian national ID (کد ملی) checksum. Needed when a shipment clears customs, which
 * requires the recipient's national ID — a wrong one means the parcel is held.
 */
export function isValidNationalId(input: string): boolean {
  const digits = normalizeDigits(input).replace(/\D/g, '');
  if (!/^\d{10}$/.test(digits)) return false;
  // All-same-digit strings pass the checksum arithmetically but are never issued.
  if (/^(\d)\1{9}$/.test(digits)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(digits[i]) * (10 - i);
  const remainder = sum % 11;
  const check = Number(digits[9]);

  return remainder < 2 ? check === remainder : check === 11 - remainder;
}

// ─────────────────────────── RTL-safe interpolation ───────────────────────────

const LRI = '\u2066'; // U+2066 left-to-right isolate
const PDI = '\u2069'; // U+2069 pop directional isolate

/**
 * Wrap an LTR fragment (a number, a code, a URL) for embedding in Persian text.
 *
 * Without isolation, "کد ABC-123 نامعتبر است" renders with the code's punctuation
 * migrating to the wrong end. The isolate tells the bidi algorithm to treat the fragment
 * as a single opaque LTR unit.
 */
export function isolateLtr(fragment: string | number): string {
  return `${LRI}${fragment}${PDI}`;
}
