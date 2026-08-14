/**
 * Money — the only monetary representation in the system.
 *
 * Two rules make this safe, and both are enforced at runtime rather than by convention:
 *
 *   1. `amount` is an integer count of MINOR units. Never a float. Floats accumulate
 *      representation error, and a ledger that is off by 0.0000001 rial is a ledger that
 *      does not balance, which is a ledger that cannot be reconciled.
 *
 *   2. Arithmetic across currencies throws. It does not coerce, and it does not silently
 *      pick one side's currency. Converting requires an explicit FX rate, which means the
 *      caller has to have thought about which rate and from when.
 */

export const CURRENCIES = ['IRR', 'AED', 'USD', 'TRY', 'EUR', 'GBP'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Minor units per major unit. IRR has no subdivision in practice. */
const EXPONENT: Record<Currency, number> = {
  IRR: 0,
  AED: 2,
  USD: 2,
  TRY: 2,
  EUR: 2,
  GBP: 2,
};

export class CurrencyMismatchError extends Error {
  readonly code = 'CURRENCY_MISMATCH';
  constructor(
    readonly left: Currency,
    readonly right: Currency,
  ) {
    super(`Cannot combine ${left} with ${right} — convert through an explicit FX rate first`);
    this.name = 'CurrencyMismatchError';
  }
}

export class InvalidMoneyError extends Error {
  readonly code = 'INVALID_MONEY';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMoneyError';
  }
}

export interface MoneyJSON {
  readonly amount: number;
  readonly currency: Currency;
}

export class Money {
  /** Integer, in minor units. */
  readonly amount: number;
  readonly currency: Currency;

  private constructor(amount: number, currency: Currency) {
    this.amount = amount;
    this.currency = currency;
    Object.freeze(this);
  }

  /** Construct from minor units. The amount must already be an integer. */
  static of(amount: number, currency: Currency): Money {
    if (!Number.isInteger(amount)) {
      throw new InvalidMoneyError(
        `Money.of requires an integer in minor units, received ${amount}. ` +
          `Use Money.fromMajor() if you have a decimal amount.`,
      );
    }
    if (!Number.isSafeInteger(amount)) {
      throw new InvalidMoneyError(`Money amount ${amount} exceeds safe integer range`);
    }
    return new Money(amount, currency);
  }

  /**
   * Construct from a major-unit decimal (12.34 USD -> 1234 minor units).
   *
   * Scales through a string rather than multiplying, because 12.34 * 100 is 1233.9999999999998
   * in IEEE-754 and rounding that is exactly the class of bug this type exists to prevent.
   */
  static fromMajor(value: number | string, currency: Currency): Money {
    const exp = EXPONENT[currency];
    const str = typeof value === 'number' ? value.toString() : value.trim();

    if (!/^-?\d+(\.\d+)?$/.test(str)) {
      throw new InvalidMoneyError(`"${str}" is not a valid decimal amount`);
    }

    const negative = str.startsWith('-');
    const [intPart = '0', fracPart = ''] = (negative ? str.slice(1) : str).split('.');
    const paddedFrac = fracPart.padEnd(exp, '0');

    if (paddedFrac.length > exp) {
      throw new InvalidMoneyError(
        `${str} has more precision than ${currency} supports (${exp} decimal places)`,
      );
    }

    const minor = Number(intPart + paddedFrac);
    return Money.of(negative ? -minor : minor, currency);
  }

  static zero(currency: Currency): Money {
    return new Money(0, currency);
  }

  static from(json: MoneyJSON): Money {
    return Money.of(json.amount, json.currency);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.amount + other.amount, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.amount - other.amount, this.currency);
  }

  /**
   * Multiply by a plain number (a quantity, a percentage, an FX rate).
   *
   * Rounds half-up on the absolute value so that -0.5 and 0.5 round symmetrically outward.
   * Banker's rounding would be defensible too; what matters is that one rule is applied
   * everywhere, so totals computed two ways agree.
   */
  multiply(factor: number, rounding: RoundingMode = 'half-up'): Money {
    if (!Number.isFinite(factor)) {
      throw new InvalidMoneyError(`Cannot multiply money by ${factor}`);
    }
    return Money.of(round(this.amount * factor, rounding), this.currency);
  }

  /** Apply a rate to produce a different currency. The caller names the target explicitly. */
  convert(rate: number, to: Currency, rounding: RoundingMode = 'half-up'): Money {
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new InvalidMoneyError(`FX rate must be a positive finite number, received ${rate}`);
    }
    const fromExp = EXPONENT[this.currency];
    const toExp = EXPONENT[to];
    // Rate is quoted in major units, so shift between the two currencies' exponents.
    const scaled = this.amount * rate * 10 ** (toExp - fromExp);
    return Money.of(round(scaled, rounding), to);
  }

  /**
   * Split into n parts with no remainder lost.
   *
   * The last parts absorb the remainder one minor unit at a time, so the parts always sum
   * back to the original. Dividing 100 by 3 gives [34, 33, 33], never [33, 33, 33].
   */
  allocate(parts: number): Money[] {
    if (!Number.isInteger(parts) || parts < 1) {
      throw new InvalidMoneyError(`Cannot allocate money into ${parts} parts`);
    }
    const base = Math.trunc(this.amount / parts);
    let remainder = this.amount - base * parts;
    const step = remainder < 0 ? -1 : 1;
    remainder = Math.abs(remainder);

    return Array.from({ length: parts }, (_, i) =>
      Money.of(base + (i < remainder ? step : 0), this.currency),
    );
  }

  negate(): Money {
    return Money.of(-this.amount, this.currency);
  }

  abs(): Money {
    return Money.of(Math.abs(this.amount), this.currency);
  }

  equals(other: Money): boolean {
    return this.amount === other.amount && this.currency === other.currency;
  }

  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    return this.amount < other.amount ? -1 : this.amount > other.amount ? 1 : 0;
  }

  greaterThan(other: Money): boolean {
    return this.compare(other) === 1;
  }

  lessThan(other: Money): boolean {
    return this.compare(other) === -1;
  }

  greaterThanOrEqual(other: Money): boolean {
    return this.compare(other) >= 0;
  }

  get isZero(): boolean {
    return this.amount === 0;
  }

  get isNegative(): boolean {
    return this.amount < 0;
  }

  /** Major-unit decimal, for display and for serialising to external systems that expect one. */
  toMajor(): number {
    return this.amount / 10 ** EXPONENT[this.currency];
  }

  /** Localised display string. `fa` renders Persian digits and the rial/toman convention. */
  format(locale: 'en' | 'fa' = 'en'): string {
    const exp = EXPONENT[this.currency];
    const value = this.toMajor();
    return new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
      style: 'currency',
      currency: this.currency,
      minimumFractionDigits: exp,
      maximumFractionDigits: exp,
    }).format(value);
  }

  toJSON(): MoneyJSON {
    return { amount: this.amount, currency: this.currency };
  }

  toString(): string {
    return `${this.amount} ${this.currency} (minor)`;
  }
}

export type RoundingMode = 'half-up' | 'half-even' | 'floor' | 'ceil';

function round(value: number, mode: RoundingMode): number {
  switch (mode) {
    case 'floor':
      return Math.floor(value);
    case 'ceil':
      return Math.ceil(value);
    case 'half-even': {
      const floor = Math.floor(value);
      const diff = value - floor;
      if (diff !== 0.5) return Math.round(value);
      return floor % 2 === 0 ? floor : floor + 1;
    }
    case 'half-up':
    default:
      // Math.round(-0.5) is -0, which rounds toward positive. Round the magnitude instead.
      return Math.sign(value) * Math.round(Math.abs(value));
  }
}

/** Sum a list. Requires an explicit currency so an empty list still has one. */
export function sumMoney(items: readonly Money[], currency: Currency): Money {
  return items.reduce<Money>((acc, m) => acc.add(m), Money.zero(currency));
}
