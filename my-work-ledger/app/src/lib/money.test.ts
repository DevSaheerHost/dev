import { describe, expect, it } from 'vitest';

import {
  MAX_PAISE,
  ZERO,
  absPaise,
  addPaise,
  formatPaise,
  formatPaiseForInput,
  isValidAmount,
  negatePaise,
  paise,
  parseRupeesToPaise,
  proRataShare,
  splitProRata,
  subPaise,
  sumPaise,
} from './money';

describe('paise', () => {
  it('accepts integers and rejects fractions', () => {
    expect(paise(1)).toBe(1);
    expect(paise(-250)).toBe(-250);
    expect(() => paise(1.5)).toThrow(RangeError);
    expect(() => paise(Number.NaN)).toThrow(RangeError);
    expect(() => paise(2 ** 53)).toThrow(RangeError);
  });

  it('bounds amounts at ten crore', () => {
    expect(isValidAmount(MAX_PAISE)).toBe(true);
    expect(isValidAmount(MAX_PAISE + 1)).toBe(false);
    expect(isValidAmount(1.5)).toBe(false);
  });
});

describe('arithmetic', () => {
  it('adds, subtracts, negates and sums without drift', () => {
    expect(addPaise(paise(10), paise(20))).toBe(30);
    expect(subPaise(paise(10), paise(20))).toBe(-10);
    expect(negatePaise(paise(10))).toBe(-10);
    expect(absPaise(paise(-10))).toBe(10);
    expect(sumPaise([])).toBe(0);
    expect(sumPaise([paise(10), paise(-3), paise(1)])).toBe(8);
  });

  it('is exact where floating-point rupees would not be', () => {
    // 0.1 + 0.2 in rupees is the classic failure; in paise it is 10 + 20.
    const total = sumPaise(Array.from({ length: 10 }, () => paise(10)));
    expect(total).toBe(100);
    expect(formatPaise(total)).toBe('₹1');
  });
});

describe('parseRupeesToPaise', () => {
  it('parses plain rupees', () => {
    expect(parseRupeesToPaise('1200')).toEqual({ ok: true, value: 120000 });
    expect(parseRupeesToPaise('0')).toEqual({ ok: true, value: 0 });
  });

  it('parses paise exactly, without float multiplication', () => {
    expect(parseRupeesToPaise('1200.50')).toEqual({ ok: true, value: 120050 });
    expect(parseRupeesToPaise('1200.5')).toEqual({ ok: true, value: 120050 });
    expect(parseRupeesToPaise('0.07')).toEqual({ ok: true, value: 7 });
    expect(parseRupeesToPaise('.5')).toEqual({ ok: true, value: 50 });
    // 8.17 * 100 is 816.9999999999999 in binary floating point.
    expect(parseRupeesToPaise('8.17')).toEqual({ ok: true, value: 817 });
  });

  it('tolerates grouping, spaces and the rupee symbol', () => {
    expect(parseRupeesToPaise(' ₹ 18,000.00 ')).toEqual({ ok: true, value: 1800000 });
  });

  it('keeps a negative sign for signed adjustments', () => {
    expect(parseRupeesToPaise('-450')).toEqual({ ok: true, value: -45000 });
  });

  it('rejects rather than rounds a third decimal place', () => {
    const result = parseRupeesToPaise('100.456');
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ error: 'Use at most two decimal places' });
  });

  it('rejects junk, emptiness and oversized amounts', () => {
    expect(parseRupeesToPaise('').ok).toBe(false);
    expect(parseRupeesToPaise('   ').ok).toBe(false);
    expect(parseRupeesToPaise('abc').ok).toBe(false);
    expect(parseRupeesToPaise('1e5').ok).toBe(false);
    expect(parseRupeesToPaise('1.2.3').ok).toBe(false);
    expect(parseRupeesToPaise('-').ok).toBe(false);
    expect(parseRupeesToPaise('99999999999').ok).toBe(false);
  });
});

describe('formatPaise', () => {
  it('groups the Indian way', () => {
    expect(formatPaise(paise(100))).toBe('₹1');
    expect(formatPaise(paise(100000))).toBe('₹1,000');
    expect(formatPaise(paise(1800000))).toBe('₹18,000');
    expect(formatPaise(paise(100000000))).toBe('₹10,00,000');
    expect(formatPaise(paise(1234567890))).toBe('₹1,23,45,678.90');
  });

  it('shows paise only when they exist, unless asked', () => {
    expect(formatPaise(paise(120050))).toBe('₹1,200.50');
    expect(formatPaise(paise(120000))).toBe('₹1,200');
    expect(formatPaise(paise(120000), { paise: true })).toBe('₹1,200.00');
  });

  it('renders signs and the symbol on request', () => {
    expect(formatPaise(paise(-45000))).toBe('-₹450');
    expect(formatPaise(paise(45000), { signed: true })).toBe('+₹450');
    expect(formatPaise(paise(45000), { symbol: false })).toBe('450');
    expect(formatPaise(ZERO, { signed: true })).toBe('₹0');
  });

  it('round-trips through the input form', () => {
    for (const value of [0, 7, 50, 817, 120050, -45000, 1234567890]) {
      const text = formatPaiseForInput(paise(value));
      expect(parseRupeesToPaise(text)).toEqual({ ok: true, value });
    }
  });
});

describe('proRataShare', () => {
  it('takes a single share of a whole', () => {
    // 18,000 for 10 of November's 30 days.
    expect(proRataShare(paise(1800000), 10, 30)).toBe(600000);
    // 18,000 for 14 of February's 28 days.
    expect(proRataShare(paise(1800000), 14, 28)).toBe(900000);
  });

  it('rounds the magnitude, so signs mirror', () => {
    const positive = proRataShare(paise(100), 1, 3);
    const negative = proRataShare(paise(-100), 1, 3);
    expect(positive).toBe(33);
    expect(negative).toBe(-33);
  });

  it('refuses nonsense ratios', () => {
    expect(() => proRataShare(paise(100), 1, 0)).toThrow(RangeError);
    expect(() => proRataShare(paise(100), -1, 3)).toThrow(RangeError);
    expect(() => proRataShare(paise(100), 4, 3)).toThrow(RangeError);
    expect(() => proRataShare(paise(100), 1.5, 3)).toThrow(RangeError);
  });
});

describe('splitProRata', () => {
  it('always sums back to the total', () => {
    const cases: { total: number; weights: number[] }[] = [
      { total: 1800000, weights: [10, 20] },
      { total: 1800000, weights: [1, 1, 1] },
      { total: 100, weights: [1, 1, 1] },
      { total: 1, weights: [1, 1] },
      { total: 999991, weights: [7, 11, 13, 17] },
      { total: -1800000, weights: [9, 21] },
      { total: 0, weights: [3, 4] },
    ];
    for (const { total, weights } of cases) {
      const parts = splitProRata(paise(total), weights);
      expect(parts).toHaveLength(weights.length);
      expect(sumPaise(parts)).toBe(total);
    }
  });

  it('splits a month across two salary rates without losing a paise', () => {
    // 18,000/month for 1-10 Nov, then a raise; 30 days, split 10/20.
    const [first, second] = splitProRata(paise(1800000), [10, 20]);
    expect(first).toBe(600000);
    expect(second).toBe(1200000);
  });

  it('gives the spare paise to the largest remainder', () => {
    expect(splitProRata(paise(100), [1, 1, 1])).toEqual([34, 33, 33]);
    expect(splitProRata(paise(10), [1, 2])).toEqual([3, 7]);
  });

  it('leaves zero-weight shares at zero', () => {
    const parts = splitProRata(paise(100), [0, 1, 0]);
    expect(parts).toEqual([0, 100, 0]);
  });

  it('handles degenerate inputs', () => {
    expect(splitProRata(paise(100), [])).toEqual([]);
    expect(splitProRata(paise(100), [0, 0])).toEqual([0, 0]);
    expect(() => splitProRata(paise(100), [-1])).toThrow(RangeError);
  });
});
