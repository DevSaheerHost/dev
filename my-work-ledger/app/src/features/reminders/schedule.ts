/**
 * When a reminder is due.
 *
 * Pure date arithmetic with `today` injected, like the rest of the ledger. The
 * awkward case is a monthly reminder on the 29th, 30th or 31st: those days do
 * not exist in every month, and a reminder that silently skips February is a
 * reminder you stop trusting. `clampDayToMonth` moves it to the last day of a
 * short month instead, so "remind me on the 31st" fires twelve times a year.
 */

import {
  addDays,
  addMonths,
  clampDayToMonth,
  compareDates,
  periodKeyOf,
  weekdayOf,
  type CalendarDate,
} from '@/lib/dates';
import type { Reminder, ReminderType } from '@/types/models';

/** `HH:MM`, 24 hour. */
export const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const DEFAULT_REMINDER_TIME = '20:00';

export function isValidTime(value: string): boolean {
  return TIME_PATTERN.test(value);
}

/** Minutes since midnight, for comparing a reminder's time against the clock. */
export function minutesOfDay(time: string): number {
  const match = TIME_PATTERN.exec(time);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** "8:00 pm" — how a time is shown, rather than the 24-hour form stored. */
export function formatTime(time: string): string {
  const match = TIME_PATTERN.exec(time);
  if (!match) return time;
  const hour = Number(match[1]);
  const minute = match[2];
  const suffix = hour < 12 ? 'am' : 'pm';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${minute} ${suffix}`;
}

type Schedule = Pick<Reminder, 'type' | 'weekday' | 'dayOfMonth' | 'onDate'>;

/** Does this reminder fall on this day? */
export function isDueOn(reminder: Schedule, date: CalendarDate): boolean {
  switch (reminder.type) {
    case 'daily':
      return true;
    case 'weekly':
      return reminder.weekday !== null && weekdayOf(date) === reminder.weekday;
    case 'monthly': {
      if (reminder.dayOfMonth === null) return false;
      // Compared against the clamped day, so the 31st fires on the 28th of
      // February rather than not at all.
      return clampDayToMonth(periodKeyOf(date), reminder.dayOfMonth) === date;
    }
    case 'oneTime':
      return reminder.onDate === date;
  }
}

/**
 * The next day this reminder falls on, at or after `from`.
 *
 * Null when it never will — a one-time reminder whose day has passed, or a
 * schedule with the field it needs left empty.
 */
export function nextOccurrence(reminder: Schedule, from: CalendarDate): CalendarDate | null {
  switch (reminder.type) {
    case 'daily':
      return from;

    case 'oneTime':
      if (!reminder.onDate) return null;
      return compareDates(reminder.onDate, from) >= 0 ? reminder.onDate : null;

    case 'weekly': {
      if (reminder.weekday === null) return null;
      // At most six days away, so stepping is clearer than modular arithmetic.
      for (let offset = 0; offset < 7; offset += 1) {
        const candidate = addDays(from, offset);
        if (weekdayOf(candidate) === reminder.weekday) return candidate;
      }
      return null;
    }

    case 'monthly': {
      if (reminder.dayOfMonth === null) return null;
      let period = periodKeyOf(from);
      // This month if the day has not passed, otherwise the next one. Two
      // iterations is always enough; the bound is belt and braces.
      for (let step = 0; step < 2; step += 1) {
        const candidate = clampDayToMonth(period, reminder.dayOfMonth);
        if (compareDates(candidate, from) >= 0) return candidate;
        period = addMonths(period, 1);
      }
      return null;
    }
  }
}

/**
 * Whether a reminder is due *now*: it falls today and its time has passed.
 *
 * `nowMinutes` is the caller's clock, so this stays testable.
 */
export function isDueNow(
  reminder: Pick<Reminder, 'type' | 'weekday' | 'dayOfMonth' | 'onDate' | 'time' | 'enabled'>,
  today: CalendarDate,
  nowMinutes: number,
): boolean {
  if (!reminder.enabled) return false;
  if (!isDueOn(reminder, today)) return false;
  return nowMinutes >= minutesOfDay(reminder.time);
}

/** A sentence describing when a reminder fires, for the list. */
export function describeSchedule(reminder: Schedule & { time: string }): string {
  const at = formatTime(reminder.time);
  switch (reminder.type) {
    case 'daily':
      return `Every day at ${at}`;
    case 'weekly': {
      const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const day = reminder.weekday === null ? 'week' : names[reminder.weekday];
      return `Every ${day} at ${at}`;
    }
    case 'monthly': {
      if (reminder.dayOfMonth === null) return `Monthly at ${at}`;
      const day = reminder.dayOfMonth;
      const suffix =
        day % 10 === 1 && day !== 11
          ? 'st'
          : day % 10 === 2 && day !== 12
            ? 'nd'
            : day % 10 === 3 && day !== 13
              ? 'rd'
              : 'th';
      const note = day > 28 ? ', or the last day of a shorter month' : '';
      return `The ${day}${suffix} of each month at ${at}${note}`;
    }
    case 'oneTime':
      return reminder.onDate ? `Once, on ${reminder.onDate} at ${at}` : 'Once';
  }
}

export const REMINDER_TYPES: readonly ReminderType[] = ['daily', 'weekly', 'monthly', 'oneTime'];
