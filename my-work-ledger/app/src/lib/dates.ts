/**
 * Calendar dates.
 *
 * A ledger entry happens on a *day*, not at an instant. "Paid on 4 November"
 * must stay 4 November on a phone that crosses a timezone, after a Capacitor
 * rebuild, and when Firestore hands back a timestamp in UTC. So every
 * user-meaningful date in this app is the string `YYYY-MM-DD`, compared
 * lexicographically, and arithmetic is done on the parts rather than on epoch
 * milliseconds.
 *
 * This is the only module allowed to construct a `Date`. A test in
 * `dates.test.ts` enforces that, because a stray `new Date('2025-11-04')` in a
 * component is a timezone bug waiting for the user to travel.
 */

declare const calendarDateBrand: unique symbol;

/** A calendar day in `YYYY-MM-DD` form. */
export type CalendarDate = string & { readonly [calendarDateBrand]: true };

/** A month in `YYYY-MM` form, used as the stored `periodKey`. */
export type PeriodKey = string & { readonly [calendarDateBrand]: 'period' };

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const PERIOD_PATTERN = /^(\d{4})-(\d{2})$/;

/** Earliest date the app accepts, to keep typos out of the ledger. */
export const MIN_DATE = '2000-01-01' as CalendarDate;
/** Latest date the app accepts. */
export const MAX_DATE = '2099-12-31' as CalendarDate;

export interface DateParts {
  readonly year: number;
  readonly month: number; // 1-12
  readonly day: number; // 1-31
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Number of days in a given month. `month` is 1-based. */
export function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    case 2:
      return isLeapYear(year) ? 29 : 28;
    default:
      throw new RangeError(`Month out of range: ${month}`);
  }
}

/** True when `value` is a real calendar date in the accepted range. */
export function isCalendarDate(value: unknown): value is CalendarDate {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  return value >= MIN_DATE && value <= MAX_DATE;
}

export function isPeriodKey(value: unknown): value is PeriodKey {
  if (typeof value !== 'string') return false;
  const match = PERIOD_PATTERN.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

/** Narrows a string to `CalendarDate`, throwing if it is not one. */
export function asCalendarDate(value: string): CalendarDate {
  if (!isCalendarDate(value)) throw new RangeError(`Not a calendar date: ${value}`);
  return value;
}

export function asPeriodKey(value: string): PeriodKey {
  if (!isPeriodKey(value)) throw new RangeError(`Not a period key: ${value}`);
  return value;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Builds a `CalendarDate` from parts, rejecting impossible days. */
export function makeDate(year: number, month: number, day: number): CalendarDate {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new RangeError('Date parts must be integers');
  }
  if (month < 1 || month > 12) throw new RangeError(`Month out of range: ${month}`);
  if (day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`Day out of range: ${year}-${month}-${day}`);
  }
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}` as CalendarDate;
}

export function splitDate(date: CalendarDate): DateParts {
  const match = DATE_PATTERN.exec(date);
  if (!match) throw new RangeError(`Not a calendar date: ${date}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/**
 * The calendar date `now` falls on, read in the device's own timezone — which
 * is the timezone the user means when they say "today".
 */
export function todayFrom(now: Date): CalendarDate {
  return makeDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Days since 1970-01-01 for a calendar date, computed without a `Date`. */
export function toDayNumber(date: CalendarDate): number {
  const { year, month, day } = splitDate(date);
  // Howard Hinnant's days_from_civil: exact integer arithmetic, no timezone.
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Inverse of `toDayNumber`. */
export function fromDayNumber(days: number): CalendarDate {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return makeDate(month <= 2 ? y + 1 : y, month, day);
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  return fromDayNumber(toDayNumber(date) + days);
}

/** Days from `from` to `to`, counting both ends. 4th to 4th is 1 day. */
export function inclusiveDays(from: CalendarDate, to: CalendarDate): number {
  return toDayNumber(to) - toDayNumber(from) + 1;
}

/** -1, 0 or 1. Calendar dates also compare correctly with `<` and `>`. */
export function compareDates(a: CalendarDate, b: CalendarDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(a: CalendarDate, b: CalendarDate): CalendarDate {
  return a <= b ? a : b;
}

export function maxDate(a: CalendarDate, b: CalendarDate): CalendarDate {
  return a >= b ? a : b;
}

export function periodKeyOf(date: CalendarDate): PeriodKey {
  return date.slice(0, 7) as PeriodKey;
}

export function periodStart(period: PeriodKey): CalendarDate {
  return `${period}-01` as CalendarDate;
}

export function periodEnd(period: PeriodKey): CalendarDate {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  return makeDate(year, month, daysInMonth(year, month));
}

export function addMonths(period: PeriodKey, months: number): PeriodKey {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const zeroBased = year * 12 + (month - 1) + months;
  return `${String(Math.floor(zeroBased / 12)).padStart(4, '0')}-${pad2((zeroBased % 12) + 1)}` as PeriodKey;
}

/**
 * A recurring day-of-month landing inside a given month. A salary date of the
 * 31st becomes the 28th in February rather than spilling into March — the same
 * clamping the reminder scheduler needs.
 */
export function clampDayToMonth(period: PeriodKey, dayOfMonth: number): CalendarDate {
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
    throw new RangeError(`Day of month out of range: ${dayOfMonth}`);
  }
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  return makeDate(year, month, Math.min(dayOfMonth, daysInMonth(year, month)));
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const WEEKDAY_NAMES = [
  'Thursday', 'Friday', 'Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday',
] as const;

/** Weekday index, 0 = Sunday, matching `Date.prototype.getDay`. */
export function weekdayOf(date: CalendarDate): number {
  // 1970-01-01 was a Thursday (day 4).
  return (((toDayNumber(date) + 4) % 7) + 7) % 7;
}

export function weekdayName(date: CalendarDate): string {
  return WEEKDAY_NAMES[(((toDayNumber(date) % 7) + 7) % 7)] ?? 'Thursday';
}

export function monthName(period: PeriodKey): string {
  return MONTH_NAMES[Number(period.slice(5, 7)) - 1] ?? period;
}

/** "4 Nov 2025" — short, unambiguous, and the same in every locale. */
export function formatDateShort(date: CalendarDate): string {
  const { year, month, day } = splitDate(date);
  return `${day} ${(MONTH_NAMES[month - 1] ?? '').slice(0, 3)} ${year}`;
}

/** "4 November 2025" */
export function formatDateLong(date: CalendarDate): string {
  const { year, month, day } = splitDate(date);
  return `${day} ${MONTH_NAMES[month - 1] ?? ''} ${year}`;
}

/** "November 2025" */
export function formatPeriod(period: PeriodKey): string {
  return `${monthName(period)} ${period.slice(0, 4)}`;
}

/** "Today", "Yesterday", or the short date. */
export function formatDateRelative(date: CalendarDate, today: CalendarDate): string {
  const difference = toDayNumber(today) - toDayNumber(date);
  if (difference === 0) return 'Today';
  if (difference === 1) return 'Yesterday';
  if (difference === -1) return 'Tomorrow';
  return formatDateShort(date);
}
