/**
 * Money.
 *
 * Every amount in this application is an integer number of paise. Floating
 * point rupees are never stored, never summed and never compared: `0.1 + 0.2`
 * is not `0.3`, and a ledger that drifts by a paise per entry is worthless.
 *
 * `Paise` is a branded number so that a raw `number` cannot be passed where an
 * amount is expected — mixing rupees and paise becomes a compile error rather
 * than a hundredfold error in a balance.
 *
 * This module knows nothing about React, Firestore or the current time.
 */

declare const paiseBrand: unique symbol;

/** An integer number of paise. 100 paise = ₹1. */
export type Paise = number & { readonly [paiseBrand]: true };

/** Largest amount the app accepts: ₹10,00,00,000 (ten crore) in paise. */
export const MAX_PAISE = 100_000_000_00;

export const ZERO = 0 as Paise;

/** Wraps an integer as `Paise`, refusing anything that is not a safe integer. */
export function paise(value: number): Paise {
  if (!Number.isInteger(value)) {
    throw new RangeError(`Paise must be an integer, received ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Paise is outside the safe integer range: ${value}`);
  }
  return value as Paise;
}

/** True when `value` is an integer inside the accepted magnitude. */
export function isValidAmount(value: number): boolean {
  return Number.isInteger(value) && Math.abs(value) <= MAX_PAISE;
}

export function addPaise(a: Paise, b: Paise): Paise {
  return paise(a + b);
}

export function subPaise(a: Paise, b: Paise): Paise {
  return paise(a - b);
}

export function negatePaise(a: Paise): Paise {
  return paise(-a);
}

export function sumPaise(values: readonly Paise[]): Paise {
  let total = 0;
  for (const value of values) total += value;
  return paise(total);
}

export function absPaise(a: Paise): Paise {
  return paise(Math.abs(a));
}

export type ParseResult =
  | { readonly ok: true; readonly value: Paise }
  | { readonly ok: false; readonly error: string };

/**
 * Parses what the user typed into paise.
 *
 * Deliberately strict. More than two decimal places is rejected rather than
 * rounded: silently turning "100.456" into ₹100.46 is the kind of helpfulness
 * that loses money. Grouping separators and a leading currency symbol are
 * accepted because keyboards and habits produce them.
 */
export function parseRupeesToPaise(input: string): ParseResult {
  const cleaned = input.trim().replace(/[₹\s,]/g, '');
  if (cleaned === '') return { ok: false, error: 'Enter an amount' };

  const match = /^(-?)(\d*)(?:\.(\d+))?$/.exec(cleaned);
  if (!match) return { ok: false, error: 'Use digits only, for example 1200.50' };

  const [, sign, whole = '', fraction] = match;
  if (whole === '' && fraction === undefined) {
    return { ok: false, error: 'Enter an amount' };
  }
  if (fraction !== undefined && fraction.length > 2) {
    return { ok: false, error: 'Use at most two decimal places' };
  }

  const rupees = whole === '' ? 0 : Number(whole);
  const fractionPaise = fraction === undefined ? 0 : Number(fraction.padEnd(2, '0'));
  const magnitude = rupees * 100 + fractionPaise;

  if (!Number.isSafeInteger(magnitude)) {
    return { ok: false, error: 'That amount is too large' };
  }
  if (magnitude > MAX_PAISE) {
    return { ok: false, error: 'That amount is too large' };
  }

  return { ok: true, value: paise(sign === '-' ? -magnitude : magnitude) };
}

/** Groups an integer string the Indian way: 12345678 -> "1,23,45,678". */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  let rest = digits.slice(0, -3);
  const parts: string[] = [];
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest.length > 0) parts.unshift(rest);
  return `${parts.join(',')},${last3}`;
}

export interface FormatOptions {
  /** Include the ₹ symbol. Default true. */
  readonly symbol?: boolean;
  /** Always show the paise part. Default: only when it is non-zero. */
  readonly paise?: boolean;
  /** Prefix a `+` on positive amounts. Default false. */
  readonly signed?: boolean;
}

/**
 * Formats an amount for display. The sign is rendered as a leading `-`; the
 * caller decides whether a negative balance should instead be phrased as
 * "you owe", which is what the UI does for shop balances.
 */
export function formatPaise(value: Paise, options: FormatOptions = {}): string {
  const { symbol = true, paise: forcePaise, signed = false } = options;
  const magnitude = Math.abs(value);
  const whole = Math.trunc(magnitude / 100);
  const fraction = magnitude % 100;
  const showFraction = forcePaise ?? fraction !== 0;

  let text = groupIndian(String(whole));
  if (showFraction) text += `.${String(fraction).padStart(2, '0')}`;
  if (symbol) text = `₹${text}`;
  if (value < 0) return `-${text}`;
  if (signed && value > 0) return `+${text}`;
  return text;
}

/** The plain editable form of an amount, for putting back into an input. */
export function formatPaiseForInput(value: Paise): string {
  const magnitude = Math.abs(value);
  const whole = Math.trunc(magnitude / 100);
  const fraction = magnitude % 100;
  const body = fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, '0')}`;
  return value < 0 ? `-${body}` : body;
}

/**
 * One pro-rata share of `total`: `total x numerator / denominator`.
 *
 * Rounded once, on the magnitude, then re-signed — so the same fraction of
 * +₹100 and of -₹100 are mirror images, which `Math.round` alone does not give
 * for negative halves. Use `splitProRata` when every share of a whole is
 * needed, because a sum of independently rounded shares does not reconstruct
 * the total.
 */
export function proRataShare(total: Paise, numerator: number, denominator: number): Paise {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator)) {
    throw new RangeError('Pro-rata numerator and denominator must be integers');
  }
  if (denominator <= 0) throw new RangeError('Pro-rata denominator must be positive');
  if (numerator < 0) throw new RangeError('Pro-rata numerator must not be negative');
  if (numerator > denominator) throw new RangeError('Pro-rata numerator exceeds the denominator');

  const sign = total < 0 ? -1 : 1;
  return paise(sign * Math.round((Math.abs(total) * numerator) / denominator));
}

/**
 * Splits `total` into shares proportional to `weights`, using the
 * largest-remainder method so the shares always sum back to exactly `total`.
 * Every spare paise goes to the largest remainder, ties resolved by position.
 */
export function splitProRata(total: Paise, weights: readonly number[]): Paise[] {
  if (weights.length === 0) return [];
  for (const weight of weights) {
    if (!Number.isInteger(weight) || weight < 0) {
      throw new RangeError('Pro-rata weights must be non-negative integers');
    }
  }

  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight === 0) return weights.map(() => ZERO);

  const sign = total < 0 ? -1 : 1;
  const magnitude = Math.abs(total);

  const floors: number[] = [];
  const remainders: { index: number; remainder: number }[] = [];
  let assigned = 0;

  weights.forEach((weight, index) => {
    const exact = (magnitude * weight) / totalWeight;
    const floor = Math.floor(exact);
    floors.push(floor);
    assigned += floor;
    remainders.push({ index, remainder: exact - floor });
  });

  let spare = magnitude - assigned;
  remainders.sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const entry of remainders) {
    if (spare <= 0) break;
    // A zero-weight share must stay zero; it has no claim on the remainder.
    if (weights[entry.index] === 0) continue;
    floors[entry.index] = (floors[entry.index] ?? 0) + 1;
    spare -= 1;
  }

  return floors.map((amount) => paise(sign * amount));
}
