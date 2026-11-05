/**
 * Attendance, and what the shop owes you so far today.
 *
 * A monthly salary is earned day by day, not in a lump at month end. This
 * module answers "how much have I earned so far this month" and "how much food
 * money is still outstanding", both of which climb on their own as days pass.
 *
 * Nothing here is written to the database. The figures are derived from two
 * things: the income configs, and a sparse set of day records holding only the
 * exceptions — the days you did not work, and the days the food money actually
 * changed hands. A date with no record means the ordinary case: worked, nothing
 * received. That keeps a year of normal attendance at zero documents.
 *
 * Pure, as the rest of `features/ledger`: no Firestore, no React, and `today`
 * always arrives as an argument.
 */

import {
  compareDates,
  daysInMonth,
  fromDayNumber,
  maxDate,
  minDate,
  periodEnd,
  periodStart,
  toDayNumber,
  type CalendarDate,
  type PeriodKey,
} from '@/lib/dates';
import { ZERO, paise, proRataShare, type Paise } from '@/lib/money';
import type { DayRecord, IncomeConfig, Shop } from '@/types/models';

/** Day records keyed by date, which is also their document id. */
export type DayMap = ReadonlyMap<CalendarDate, DayRecord>;

export function toDayMap(records: readonly DayRecord[]): DayMap {
  return new Map(records.map((record) => [record.date, record]));
}

/* -------------------------------------------------------------------------- */
/* Spans                                                                       */
/* -------------------------------------------------------------------------- */

export interface DaySpan {
  readonly from: CalendarDate;
  readonly to: CalendarDate;
}

/**
 * The part of a month that counts for a shop, clipped to the day you joined
 * and to the day the opening balance starts from. Anything before the opening
 * date is already inside that figure, so counting it again would double it.
 */
export function shopSpanInPeriod(shop: Shop, period: PeriodKey): DaySpan | null {
  const from = maxDate(periodStart(period), maxDate(shop.joiningDate, shop.openingBalanceAsOf));
  const to = periodEnd(period);
  return compareDates(from, to) > 0 ? null : { from, to };
}

/** Narrows a span to days that have already happened. Null if none have. */
export function elapsedPart(span: DaySpan, today: CalendarDate): DaySpan | null {
  const to = minDate(span.to, today);
  return compareDates(span.from, to) > 0 ? null : { from: span.from, to };
}

/** Every date in a span, inclusive. Spans here are at most one month. */
export function datesIn(span: DaySpan): CalendarDate[] {
  const dates: CalendarDate[] = [];
  const last = toDayNumber(span.to);
  for (let day = toDayNumber(span.from); day <= last; day += 1) {
    dates.push(fromDayNumber(day));
  }
  return dates;
}

/* -------------------------------------------------------------------------- */
/* Counting days                                                               */
/* -------------------------------------------------------------------------- */

export interface DayCounts {
  /** Days in the span, before absences. */
  readonly total: number;
  /** Days marked as not worked. */
  readonly off: number;
  /** `total - off`. What salary is pro-rated on. */
  readonly worked: number;
}

export function countDays(span: DaySpan | null, days: DayMap): DayCounts {
  if (!span) return { total: 0, off: 0, worked: 0 };
  const dates = datesIn(span);
  let off = 0;
  for (const date of dates) {
    if (days.get(date)?.off === true) off += 1;
  }
  return { total: dates.length, off, worked: dates.length - off };
}

/** Worked days on which a given daily allowance was actually handed over. */
export function settledDays(span: DaySpan | null, days: DayMap, configId: string): number {
  if (!span) return 0;
  let settled = 0;
  for (const date of datesIn(span)) {
    const record = days.get(date);
    if (!record || record.off) continue;
    if (record.allowancesReceived.includes(configId)) settled += 1;
  }
  return settled;
}

/* -------------------------------------------------------------------------- */
/* Money earned                                                                */
/* -------------------------------------------------------------------------- */

/**
 * What a config is worth over a number of worked days.
 *
 * A monthly rate is pro-rated with the **calendar month** as the denominator,
 * not the worked days — so two days off in a 30-day November gives 28/30 of the
 * salary rather than a full month spread over 28 days. A full month with no
 * absences returns the exact amount with no rounding drift, because
 * `proRataShare` rounds the magnitude once.
 */
export function amountForWorkedDays(
  config: IncomeConfig,
  workedDays: number,
  period: PeriodKey,
): Paise {
  if (workedDays <= 0) return ZERO;

  const calendarDays = daysInMonth(Number(period.slice(0, 4)), Number(period.slice(5, 7)));

  switch (config.frequency) {
    case 'monthly':
      return workedDays >= calendarDays
        ? config.amount
        : proRataShare(config.amount, workedDays, calendarDays);
    case 'daily':
      return paise(config.amount * workedDays);
    case 'weekly':
      return paise(Math.round((config.amount * workedDays) / 7));
    case 'oneTime':
      return config.amount;
  }
}

export interface LivePosition {
  readonly period: PeriodKey;
  /** The shop's span in this month, clipped to joining and opening date. */
  readonly span: DaySpan | null;
  readonly counts: DayCounts;
  /** Counts for the part of the month that has already happened. */
  readonly elapsed: DayCounts;
  /** Calendar days left in the month after today, excluding today. */
  readonly daysRemaining: number;
  /** Earned so far this month across every active config. */
  readonly earnedToDate: Paise;
  /**
   * What one more worked day adds, across every active config.
   *
   * This is the figure the balance climbs by tomorrow. It is a difference of
   * two pro-rated amounts rather than `amount / days`, so it is exactly what
   * will be added — rounding included — and the daily steps always sum to the
   * month's total instead of drifting a paisa at a time.
   *
   * Zero once the month has no days left to work.
   */
  readonly nextDayValue: Paise;
  /** What the whole month will come to if the rest is worked. */
  readonly projectedMonth: Paise;
  /** Per-config breakdown, which is what the shop page lists. */
  readonly lines: readonly LiveLine[];
}

export interface LiveLine {
  readonly configId: string;
  readonly label: string;
  readonly frequency: IncomeConfig['frequency'];
  /** Earned so far, for days already worked. */
  readonly earnedToDate: Paise;
  /** For a daily allowance: the part already handed over. */
  readonly settledToDate: Paise;
  /** `earnedToDate - settledToDate`. What is still owed on this line. */
  readonly outstanding: Paise;
  /** What one more worked day adds to this line. Zero if the month is done. */
  readonly nextDayValue: Paise;
  readonly settledDayCount: number;
  /** True for a per-day entitlement that the day calendar can tick off. */
  readonly isDailySettled: boolean;
}

/**
 * Is this config settled day by day, with a tick on the calendar?
 *
 * Food money is the case this exists for: owed for every day worked, handed
 * over on some days and not others, so the shop's debt should show exactly how
 * many days are still outstanding. A monthly salary is not settled this way —
 * it is paid in one go and recorded as an ordinary entry.
 */
export function isDailySettled(config: IncomeConfig): boolean {
  return config.frequency === 'daily' && config.kind === 'allowance';
}

/** Configs that cover any part of a period and are still switched on. */
export function configsForPeriod(
  configs: readonly IncomeConfig[],
  period: PeriodKey,
): IncomeConfig[] {
  const start = periodStart(period);
  const end = periodEnd(period);
  return configs.filter(
    (config) =>
      config.active &&
      compareDates(config.effectiveFrom, end) <= 0 &&
      (config.effectiveTo === null || compareDates(config.effectiveTo, start) >= 0),
  );
}

/** A config's own span inside a period, clipped by its effective dates. */
function configSpan(config: IncomeConfig, span: DaySpan): DaySpan | null {
  const from = maxDate(span.from, config.effectiveFrom);
  const to = config.effectiveTo ? minDate(span.to, config.effectiveTo) : span.to;
  return compareDates(from, to) > 0 ? null : { from, to };
}

/**
 * The live position for one shop in one month: what has been earned so far,
 * what is still outstanding, and how much of the month is left.
 *
 * This is what makes the balance climb on its own. It is recomputed on every
 * render from stored facts, never written, so there is no daily job to miss and
 * nothing to reconcile if the app is not opened for a week.
 */
export function livePosition(args: {
  readonly shop: Shop;
  readonly configs: readonly IncomeConfig[];
  readonly days: DayMap;
  readonly period: PeriodKey;
  readonly today: CalendarDate;
}): LivePosition {
  const { shop, configs, days, period, today } = args;

  const span = shopSpanInPeriod(shop, period);
  const counts = countDays(span, days);
  const elapsedSpan = span ? elapsedPart(span, today) : null;
  const elapsed = countDays(elapsedSpan, days);

  // Days left after today. Negative for a past month, which reads as zero.
  const daysRemaining = span
    ? Math.max(0, toDayNumber(span.to) - Math.max(toDayNumber(span.from) - 1, toDayNumber(today)))
    : 0;

  const lines: LiveLine[] = [];
  let earnedToDate = 0;
  let projectedMonth = 0;
  let nextDayValue = 0;

  // A daily-wage shop accrues nothing: an unpaid day is not a receivable there,
  // so only actual payments are ever recorded.
  if (span && shop.settlementMode === 'accrual') {
    for (const config of configsForPeriod(configs, period)) {
      const full = configSpan(config, span);
      if (!full) continue;
      const elapsedForConfig = elapsedPart(full, today);

      const workedSoFar = countDays(elapsedForConfig, days).worked;
      const workedWhole = countDays(full, days).worked;

      const earned = amountForWorkedDays(config, workedSoFar, period);
      const projected = amountForWorkedDays(config, workedWhole, period);

      const dailySettled = isDailySettled(config);
      const settledCount = dailySettled ? settledDays(elapsedForConfig, days, config.id) : 0;
      const settled = dailySettled
        ? amountForWorkedDays(config, settledCount, period)
        : ZERO;

      // What tomorrow is worth: the same pro-rata applied to one more worked
      // day, minus what is already earned. Taken as a difference so the steps
      // add up to the month exactly, and only while there is a day left to
      // work — a finished month grows by nothing.
      const perDay =
        workedWhole > workedSoFar
          ? paise(amountForWorkedDays(config, workedSoFar + 1, period) - earned)
          : ZERO;

      earnedToDate += earned;
      projectedMonth += projected;
      nextDayValue += perDay;

      lines.push({
        configId: config.id,
        label: config.label,
        frequency: config.frequency,
        earnedToDate: earned,
        settledToDate: settled,
        outstanding: paise(earned - settled),
        nextDayValue: perDay,
        settledDayCount: settledCount,
        isDailySettled: dailySettled,
      });
    }
  }

  return {
    period,
    span,
    counts,
    elapsed,
    daysRemaining,
    earnedToDate: paise(earnedToDate),
    nextDayValue: paise(nextDayValue),
    projectedMonth: paise(projectedMonth),
    lines,
  };
}

/**
 * The part of the live position that is not yet in the ledger.
 *
 * Once a month's accrual has been confirmed and posted, its figures are real
 * transactions and the engine counts them. Adding the live figure on top would
 * then count the same salary twice, so the dashboard adds this only for periods
 * that have not been posted yet.
 */
export function unpostedEarnings(
  position: LivePosition,
  postedAccrualKeys: ReadonlySet<string>,
): Paise {
  let total = 0;
  for (const line of position.lines) {
    // Each half is dropped independently as it becomes a real entry, so a
    // month that is half posted is still counted correctly rather than
    // all-or-nothing. For a line that is not settled daily the second clause is
    // moot, because nothing has been handed over day by day.
    if (!postedAccrualKeys.has(earnedKeyFor(line.configId, position.period))) {
      total += line.earnedToDate;
    }
    if (
      line.isDailySettled &&
      !postedAccrualKeys.has(receivedKeyFor(line.configId, position.period))
    ) {
      total -= line.settledToDate;
    }
  }
  return paise(total);
}

/** The accrual key for what a config earned in a period. */
export function earnedKeyFor(configId: string, period: PeriodKey): string {
  return `${configId}:${period}`;
}

/**
 * The accrual key for a daily allowance actually handed over in a period.
 *
 * Distinct from the earned key so the two halves of food money — owed and
 * received — are tracked separately and neither can be posted twice.
 */
export function receivedKeyFor(configId: string, period: PeriodKey): string {
  return `${configId}:${period}:received`;
}
