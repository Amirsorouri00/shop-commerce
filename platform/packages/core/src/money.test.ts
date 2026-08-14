import { describe, it, expect } from 'vitest';
import { Money, sumMoney, CurrencyMismatchError, InvalidMoneyError } from './money.ts';

describe('Money construction', () => {
  it('takes integer minor units', () => {
    expect(Money.of(1234, 'USD').amount).toBe(1234);
  });

  it('rejects a non-integer, because that is how float money bugs start', () => {
    expect(() => Money.of(12.34, 'USD')).toThrow(InvalidMoneyError);
  });

  it('scales major units through a string, avoiding IEEE-754 error', () => {
    // 12.34 * 100 === 1233.9999999999998 in floating point.
    expect(Money.fromMajor(12.34, 'USD').amount).toBe(1234);
    expect(Money.fromMajor('0.07', 'USD').amount).toBe(7);
    expect(Money.fromMajor('1.10', 'USD').amount).toBe(110);
  });

  it('treats IRR as having no minor unit', () => {
    expect(Money.fromMajor(50000, 'IRR').amount).toBe(50000);
  });

  it('rejects more precision than the currency has', () => {
    expect(() => Money.fromMajor('1.234', 'USD')).toThrow(InvalidMoneyError);
    expect(() => Money.fromMajor('1.5', 'IRR')).toThrow(InvalidMoneyError);
  });

  it('handles negatives', () => {
    expect(Money.fromMajor('-12.34', 'USD').amount).toBe(-1234);
  });
});

describe('Money arithmetic', () => {
  it('adds and subtracts within one currency', () => {
    const a = Money.of(1000, 'USD');
    const b = Money.of(250, 'USD');
    expect(a.add(b).amount).toBe(1250);
    expect(a.subtract(b).amount).toBe(750);
  });

  it('refuses to mix currencies instead of silently coercing', () => {
    const usd = Money.of(100, 'USD');
    const aed = Money.of(100, 'AED');
    expect(() => usd.add(aed)).toThrow(CurrencyMismatchError);
    expect(() => usd.subtract(aed)).toThrow(CurrencyMismatchError);
    expect(() => usd.compare(aed)).toThrow(CurrencyMismatchError);
  });

  it('rounds multiplication symmetrically around zero', () => {
    expect(Money.of(5, 'USD').multiply(0.5).amount).toBe(3); // 2.5 -> 3
    expect(Money.of(-5, 'USD').multiply(0.5).amount).toBe(-3); // -2.5 -> -3
  });

  it('is immutable', () => {
    const a = Money.of(100, 'USD');
    a.add(Money.of(50, 'USD'));
    expect(a.amount).toBe(100);
  });
});

describe('Money.convert', () => {
  it('shifts between currency exponents', () => {
    // 100.00 AED at 15000 IRR per AED = 1,500,000 IRR (IRR has no minor unit)
    const aed = Money.fromMajor('100.00', 'AED');
    expect(aed.convert(15000, 'IRR').amount).toBe(1_500_000);
  });

  it('converts IRR back to a 2-decimal currency', () => {
    const irr = Money.of(1_500_000, 'IRR');
    expect(irr.convert(1 / 15000, 'AED').amount).toBe(10_000); // 100.00 AED
  });

  it('rejects a non-positive rate', () => {
    expect(() => Money.of(100, 'AED').convert(0, 'IRR')).toThrow(InvalidMoneyError);
    expect(() => Money.of(100, 'AED').convert(-1, 'IRR')).toThrow(InvalidMoneyError);
  });
});

describe('Money.allocate', () => {
  it('never loses a minor unit to rounding', () => {
    const parts = Money.of(100, 'USD').allocate(3);
    expect(parts.map((p) => p.amount)).toEqual([34, 33, 33]);
    expect(sumMoney(parts, 'USD').amount).toBe(100);
  });

  it('splits evenly when it divides', () => {
    expect(Money.of(99, 'USD').allocate(3).map((p) => p.amount)).toEqual([33, 33, 33]);
  });

  it('handles negative amounts without losing a unit', () => {
    const parts = Money.of(-100, 'USD').allocate(3);
    expect(parts.map((p) => p.amount)).toEqual([-34, -33, -33]);
    expect(sumMoney(parts, 'USD').amount).toBe(-100);
  });
});

describe('Money comparison and display', () => {
  it('compares', () => {
    expect(Money.of(100, 'USD').greaterThan(Money.of(50, 'USD'))).toBe(true);
    expect(Money.of(100, 'USD').equals(Money.of(100, 'USD'))).toBe(true);
    expect(Money.of(100, 'USD').equals(Money.of(100, 'AED'))).toBe(false);
  });

  it('round-trips through JSON', () => {
    const m = Money.of(1234, 'AED');
    expect(Money.from(JSON.parse(JSON.stringify(m))).equals(m)).toBe(true);
  });

  it('exposes major units for display', () => {
    expect(Money.of(1234, 'USD').toMajor()).toBe(12.34);
    expect(Money.of(50000, 'IRR').toMajor()).toBe(50000);
  });
});

describe('sumMoney', () => {
  it('needs an explicit currency so an empty list still has one', () => {
    expect(sumMoney([], 'IRR').amount).toBe(0);
    expect(sumMoney([], 'IRR').currency).toBe('IRR');
  });

  it('sums a list', () => {
    const items = [Money.of(100, 'USD'), Money.of(250, 'USD'), Money.of(1, 'USD')];
    expect(sumMoney(items, 'USD').amount).toBe(351);
  });
});
