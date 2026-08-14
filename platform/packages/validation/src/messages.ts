import type { LocalizedMessage } from '@xb/core';
import type { ZodIssue } from 'zod';
import { toPersianDigits, isolateLtr } from './persian.ts';

/**
 * The bilingual message catalog.
 *
 * Deliberately NOT wired through Zod's `errorMap`. That hook must return a single string,
 * which would force encoding both locales into one and parsing it back out — fragile, and
 * it throws away the structured issue data.
 *
 * Instead we let Zod produce its structured issues and translate them here. The issue
 * already carries everything needed (`code`, `path`, `minimum`, `validation`, ...), so both
 * locales are generated from the same source of truth and adding a third language means
 * adding a branch here and nothing else anywhere.
 */

/** A human label for a field, in both locales. Falls back to the raw path when unregistered. */
export type FieldLabels = Readonly<Record<string, LocalizedMessage>>;

/** Persian reads numbers in Persian digits; English does not. */
const faNum = (n: number | string): string => toPersianDigits(String(n));
const enNum = (n: number | string): string => String(n);

function labelFor(path: string, labels: FieldLabels | undefined): LocalizedMessage {
  return labels?.[path] ?? { en: path, fa: path };
}

/**
 * Stable machine code for an issue — what a client branches on.
 * Finer-grained than Zod's own code so `string.email` and `string.uuid` are distinguishable.
 */
export function issueCode(issue: ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return issue.received === 'undefined' ? 'required' : 'type.invalid';
    case 'invalid_string':
      return typeof issue.validation === 'string'
        ? `string.${issue.validation}`
        : 'string.invalid';
    case 'too_small':
      return `${issue.type}.min`;
    case 'too_big':
      return `${issue.type}.max`;
    case 'invalid_enum_value':
      return 'enum.invalid';
    case 'not_multiple_of':
      return 'number.multipleOf';
    case 'not_finite':
      return 'number.finite';
    case 'unrecognized_keys':
      return 'object.unknownKeys';
    case 'invalid_date':
      return 'date.invalid';
    case 'custom':
      return typeof issue.params?.['code'] === 'string' ? issue.params['code'] : 'custom';
    default:
      return issue.code;
  }
}

/** Structured parameters echoed to the client, so it can render its own copy if it wants to. */
export function issueParams(issue: ZodIssue): Record<string, unknown> | undefined {
  switch (issue.code) {
    case 'too_small':
      return { minimum: Number(issue.minimum), inclusive: issue.inclusive, type: issue.type };
    case 'too_big':
      return { maximum: Number(issue.maximum), inclusive: issue.inclusive, type: issue.type };
    case 'invalid_type':
      return { expected: issue.expected, received: issue.received };
    case 'invalid_enum_value':
      return { options: issue.options };
    case 'not_multiple_of':
      return { multipleOf: Number(issue.multipleOf) };
    case 'unrecognized_keys':
      return { keys: issue.keys };
    case 'custom':
      return issue.params;
    default:
      return undefined;
  }
}

/**
 * Produce both locales for one issue.
 *
 * Persian copy notes: numbers are rendered in Persian digits, and any Latin fragment
 * (a field path, an enum option) is wrapped in a direction isolate so the bidi algorithm
 * does not drag its punctuation to the wrong end of the sentence.
 */
export function issueMessage(issue: ZodIssue, labels?: FieldLabels): LocalizedMessage {
  const path = issue.path.join('.');
  const label = labelFor(path, labels);

  switch (issue.code) {
    case 'invalid_type': {
      if (issue.received === 'undefined' || issue.received === 'null') {
        return {
          en: `${label.en} is required.`,
          fa: `${label.fa} الزامی است.`,
        };
      }
      return {
        en: `${label.en} must be a ${issue.expected}.`,
        fa: `مقدار ${label.fa} از نوع درستی نیست.`,
      };
    }

    case 'invalid_string': {
      const v = issue.validation;
      if (v === 'email') {
        return {
          en: `${label.en} must be a valid email address.`,
          fa: `${label.fa} باید یک نشانی ایمیل معتبر باشد.`,
        };
      }
      if (v === 'url') {
        return {
          en: `${label.en} must be a valid link.`,
          fa: `${label.fa} باید یک نشانی اینترنتی معتبر باشد.`,
        };
      }
      if (v === 'uuid') {
        return {
          en: `${label.en} must be a valid identifier.`,
          fa: `${label.fa} باید یک شناسهٔ معتبر باشد.`,
        };
      }
      if (v === 'datetime') {
        return {
          en: `${label.en} must be a valid date and time.`,
          fa: `${label.fa} باید تاریخ و زمان معتبری باشد.`,
        };
      }
      return {
        en: `${label.en} is not in the expected format.`,
        fa: `قالب ${label.fa} درست نیست.`,
      };
    }

    case 'too_small': {
      const min = Number(issue.minimum);
      if (issue.type === 'string') {
        return min === 1
          ? { en: `${label.en} can't be empty.`, fa: `${label.fa} نمی‌تواند خالی باشد.` }
          : {
              en: `${label.en} must be at least ${enNum(min)} characters.`,
              fa: `${label.fa} باید حداقل ${faNum(min)} نویسه باشد.`,
            };
      }
      if (issue.type === 'array') {
        return {
          en: `Select at least ${enNum(min)}.`,
          fa: `حداقل ${faNum(min)} مورد انتخاب کنید.`,
        };
      }
      if (issue.type === 'date') {
        return {
          en: `${label.en} is too early.`,
          fa: `${label.fa} زودتر از حد مجاز است.`,
        };
      }
      return {
        en: `${label.en} must be ${issue.inclusive ? 'at least' : 'greater than'} ${enNum(min)}.`,
        fa: `${label.fa} باید ${issue.inclusive ? 'حداقل' : 'بیشتر از'} ${faNum(min)} باشد.`,
      };
    }

    case 'too_big': {
      const max = Number(issue.maximum);
      if (issue.type === 'string') {
        return {
          en: `${label.en} must be ${enNum(max)} characters or fewer.`,
          fa: `${label.fa} باید حداکثر ${faNum(max)} نویسه باشد.`,
        };
      }
      if (issue.type === 'array') {
        return {
          en: `Select no more than ${enNum(max)}.`,
          fa: `حداکثر ${faNum(max)} مورد می‌توانید انتخاب کنید.`,
        };
      }
      if (issue.type === 'date') {
        return {
          en: `${label.en} is too late.`,
          fa: `${label.fa} دیرتر از حد مجاز است.`,
        };
      }
      return {
        en: `${label.en} must be ${issue.inclusive ? 'at most' : 'less than'} ${enNum(max)}.`,
        fa: `${label.fa} باید ${issue.inclusive ? 'حداکثر' : 'کمتر از'} ${faNum(max)} باشد.`,
      };
    }

    case 'invalid_enum_value':
      return {
        en: `${label.en} must be one of: ${issue.options.join(', ')}.`,
        fa: `${label.fa} باید یکی از این مقادیر باشد: ${isolateLtr(issue.options.join('، '))}`,
      };

    case 'not_multiple_of':
      return {
        en: `${label.en} must be a multiple of ${enNum(Number(issue.multipleOf))}.`,
        fa: `${label.fa} باید مضربی از ${faNum(Number(issue.multipleOf))} باشد.`,
      };

    case 'not_finite':
      return {
        en: `${label.en} must be a finite number.`,
        fa: `${label.fa} باید عددی معین باشد.`,
      };

    case 'unrecognized_keys':
      return {
        en: `Unexpected field(s): ${issue.keys.join(', ')}.`,
        fa: `فیلد(های) ناشناخته: ${isolateLtr(issue.keys.join('، '))}`,
      };

    case 'invalid_date':
      return {
        en: `${label.en} is not a valid date.`,
        fa: `${label.fa} تاریخ معتبری نیست.`,
      };

    case 'invalid_union':
      return {
        en: `${label.en} doesn't match any accepted format.`,
        fa: `${label.fa} با هیچ‌یک از قالب‌های مجاز مطابقت ندارد.`,
      };

    case 'custom': {
      // A refinement supplies its own bilingual copy through params.
      const supplied = issue.params?.['message'];
      if (isLocalized(supplied)) return supplied;
      return {
        en: issue.message || `${label.en} is not valid.`,
        fa: `${label.fa} معتبر نیست.`,
      };
    }

    default:
      return {
        en: issue.message || `${label.en} is not valid.`,
        fa: `${label.fa} معتبر نیست.`,
      };
  }
}

function isLocalized(v: unknown): v is LocalizedMessage {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as LocalizedMessage).en === 'string' &&
    typeof (v as LocalizedMessage).fa === 'string'
  );
}

/**
 * Domain-specific refinement messages, used by the custom validators in `schemas.ts`.
 * Kept beside the generic catalog so all customer-facing validation copy is reviewable
 * in one file.
 */
export const CUSTOM_MESSAGES = {
  iranianMobile: {
    en: 'Enter a valid Iranian mobile number, for example 09121234567.',
    fa: 'یک شمارهٔ موبایل معتبر ایران وارد کنید، برای نمونه ۰۹۱۲۱۲۳۴۵۶۷.',
  },
  nationalId: {
    en: 'Enter a valid 10-digit national ID.',
    fa: 'کد ملی معتبر ۱۰ رقمی وارد کنید.',
  },
  otpCode: {
    en: 'Enter the 6-digit code we sent you.',
    fa: 'کد ۶ رقمی ارسال‌شده را وارد کنید.',
  },
  postalCode: {
    en: 'Enter a valid 10-digit postal code.',
    fa: 'کد پستی معتبر ۱۰ رقمی وارد کنید.',
  },
  supportedMarketplace: {
    en: 'We can only order from Amazon UAE right now. Paste a link from amazon.ae.',
    fa: 'در حال حاضر فقط امکان سفارش از آمازون امارات وجود دارد. لطفاً پیوندی از amazon.ae وارد کنید.',
  },
  positiveMoney: {
    en: 'Amount must be greater than zero.',
    fa: 'مبلغ باید بزرگ‌تر از صفر باشد.',
  },
  persianOrLatinText: {
    en: 'Use Persian or Latin letters only.',
    fa: 'فقط از حروف فارسی یا لاتین استفاده کنید.',
  },
} as const satisfies Record<string, LocalizedMessage>;
