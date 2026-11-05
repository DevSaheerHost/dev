/**
 * Phone numbers, and the message you send a shop when you want paying.
 *
 * Two jobs, both small and both pure:
 *
 *  - Normalise and validate a phone number, so what is stored is a number and
 *    not an arbitrary string.
 *  - Build `tel:` and `sms:` links from it.
 *
 * The validation is a security boundary, not a convenience. A stored string
 * that ends up inside an `sms:` URL is a chance to inject a different scheme or
 * extra URL parameters — `sms:+91999?body=...&to=attacker` — so a number is
 * rebuilt from its digits rather than passed through, and the body is always
 * percent-encoded. Anything that is not a plausible phone number is refused and
 * no link is offered at all.
 */

import { formatPaise, type Paise } from './money';

/** E.164 allows 15 digits; 6 is shorter than any real dialable number. */
export const MIN_PHONE_DIGITS = 6;
export const MAX_PHONE_DIGITS = 15;
/** What the stored field may hold: `+` and up to 15 digits. */
export const MAX_PHONE_LENGTH = MAX_PHONE_DIGITS + 1;

/**
 * Strips a typed number down to a `+` and digits.
 *
 * Spaces, brackets and dashes are how people actually write a number, so they
 * are accepted on the way in and dropped rather than rejected. Everything else
 * — letters, other punctuation, a second `+` — is simply not kept, so the
 * result is always either empty or `+?[0-9]{1,}`.
 */
export function normalisePhone(input: string): string {
  const trimmed = input.trim();
  const digits = trimmed.replace(/[^0-9]/g, '').slice(0, MAX_PHONE_DIGITS);
  if (digits === '') return '';
  return trimmed.startsWith('+') ? `+${digits}` : digits;
}

export function isValidPhone(value: string): boolean {
  if (!/^\+?[0-9]+$/.test(value)) return false;
  const digits = value.replace(/^\+/, '');
  return digits.length >= MIN_PHONE_DIGITS && digits.length <= MAX_PHONE_DIGITS;
}

/** "+91 98765 43210" — grouped for reading, never for storing or dialling. */
export function formatPhone(value: string): string {
  if (!isValidPhone(value)) return value;
  const plus = value.startsWith('+');
  const digits = value.replace(/^\+/, '');
  if (digits.length === 10) return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  if (plus && digits.length > 10) {
    const country = digits.slice(0, digits.length - 10);
    const rest = digits.slice(digits.length - 10);
    return `+${country} ${rest.slice(0, 5)} ${rest.slice(5)}`;
  }
  return plus ? `+${digits}` : digits;
}

/** `tel:` for a valid number, else null — so no caller can build a bad link. */
export function telHref(phone: string): string | null {
  const clean = normalisePhone(phone);
  return isValidPhone(clean) ? `tel:${clean}` : null;
}

/**
 * `sms:` with a prefilled body, or null.
 *
 * The number is rebuilt from `normalisePhone` and the body percent-encoded, so
 * neither part can introduce another URL parameter or scheme.
 */
export function smsHref(phone: string, body: string): string | null {
  const clean = normalisePhone(phone);
  if (!isValidPhone(clean)) return null;
  // `?&body=` rather than `?body=`: iOS wants the body after `&`, Android after
  // `?`, and this form is honoured by both.
  return `sms:${clean}?&body=${encodeURIComponent(body)}`;
}

/**
 * The message asking a shop for what it owes.
 *
 * Deliberately plain and factual: the amount, the date it is as of, and who it
 * is from. No pressure and no accusation — this gets sent to someone the user
 * works for every day.
 */
export function buildBalanceMessage(args: {
  readonly shopName: string;
  readonly personName: string;
  readonly balance: Paise;
  readonly asOf: string;
  /** Part of the balance that is earned but not yet agreed, if any. */
  readonly unconfirmed?: Paise;
}): string {
  const { shopName, personName, balance, asOf } = args;
  const amount = formatPaise(Math.abs(balance) as Paise);
  const from = personName.trim() === '' ? '' : `\n\n— ${personName.trim()}`;

  if (balance === 0) {
    return `Hello ${shopName}, as of ${asOf} we are square — nothing outstanding either way.${from}`;
  }

  if (balance < 0) {
    return `Hello ${shopName}, as of ${asOf} I owe you ${amount}. I will settle it shortly.${from}`;
  }

  // Worded as "counts", not "includes": payments already received are netted
  // off the balance, so the unsettled part can legitimately be larger than the
  // figure due. "Includes X" would then be arithmetic that does not add up.
  const note =
    args.unconfirmed && args.unconfirmed > 0
      ? ` It counts ${formatPaise(args.unconfirmed)} of salary and allowance for worked days we have not settled yet.`
      : '';

  return `Hello ${shopName}, as of ${asOf} the balance due to me is ${amount}.${note} Could you let me know when it can be paid? Thank you.${from}`;
}
