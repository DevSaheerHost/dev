import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  addDays,
  addMonths,
  asCalendarDate,
  clampDayToMonth,
  compareDates,
  dateOfMs,
  daysInMonth,
  formatClockTime,
  formatDateRelative,
  formatDateShort,
  formatDaysAgo,
  formatPeriod,
  fromDayNumber,
  inclusiveDays,
  isCalendarDate,
  isPeriodKey,
  makeDate,
  maxDate,
  minDate,
  periodEnd,
  periodKeyOf,
  periodStart,
  splitDate,
  toDayNumber,
  todayFrom,
  weekdayName,
  weekdayOf,
  type CalendarDate,
  type PeriodKey,
} from './dates';

const date = asCalendarDate;
const period = (value: string) => value as PeriodKey;
/** The app rejects dates before 2000; the epoch anchors still need testing. */
const raw = (value: string) => value as unknown as CalendarDate;

describe('daysInMonth', () => {
  it('knows the lengths of every month', () => {
    expect(daysInMonth(2025, 1)).toBe(31);
    expect(daysInMonth(2025, 4)).toBe(30);
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(() => daysInMonth(2025, 13)).toThrow(RangeError);
  });
});

describe('validation', () => {
  it('accepts real dates and rejects impossible ones', () => {
    expect(isCalendarDate('2025-11-04')).toBe(true);
    expect(isCalendarDate('2024-02-29')).toBe(true);
    expect(isCalendarDate('2025-02-29')).toBe(false);
    expect(isCalendarDate('2025-13-01')).toBe(false);
    expect(isCalendarDate('2025-11-31')).toBe(false);
    expect(isCalendarDate('2025-11-4')).toBe(false);
    expect(isCalendarDate('04-11-2025')).toBe(false);
    expect(isCalendarDate('1999-12-31')).toBe(false);
    expect(isCalendarDate(20251104)).toBe(false);
    expect(isCalendarDate(null)).toBe(false);
  });

  it('accepts period keys', () => {
    expect(isPeriodKey('2025-11')).toBe(true);
    expect(isPeriodKey('2025-00')).toBe(false);
    expect(isPeriodKey('2025-11-04')).toBe(false);
  });

  it('refuses to build an impossible date', () => {
    expect(makeDate(2025, 11, 4)).toBe('2025-11-04');
    expect(() => makeDate(2025, 2, 29)).toThrow(RangeError);
    expect(() => makeDate(2025, 0, 1)).toThrow(RangeError);
    expect(() => asCalendarDate('nope')).toThrow(RangeError);
  });
});

describe('day numbers', () => {
  it('round-trips every day across a decade, including leap days', () => {
    let cursor = date('2020-01-01');
    const end = date('2030-01-01');
    let steps = 0;
    while (cursor < end) {
      expect(fromDayNumber(toDayNumber(cursor))).toBe(cursor);
      cursor = addDays(cursor, 1);
      steps += 1;
    }
    expect(steps).toBe(3653); // 10 years with 2020, 2024 and 2028 as leap years
  });

  it('is anchored to the Unix epoch', () => {
    expect(toDayNumber(raw('1970-01-01'))).toBe(0);
    expect(toDayNumber(date('2025-11-04'))).toBe(20396);
  });

  it('crosses month and year boundaries', () => {
    expect(addDays(date('2025-01-31'), 1)).toBe('2025-02-01');
    expect(addDays(date('2025-12-31'), 1)).toBe('2026-01-01');
    expect(addDays(date('2024-02-28'), 1)).toBe('2024-02-29');
    expect(addDays(date('2025-02-28'), 1)).toBe('2025-03-01');
    expect(addDays(date('2025-03-01'), -1)).toBe('2025-02-28');
  });
});

describe('spans', () => {
  it('counts both ends of a span', () => {
    expect(inclusiveDays(date('2025-11-04'), date('2025-11-04'))).toBe(1);
    expect(inclusiveDays(date('2025-11-01'), date('2025-11-30'))).toBe(30);
    expect(inclusiveDays(date('2025-02-01'), date('2025-02-28'))).toBe(28);
    expect(inclusiveDays(date('2024-02-01'), date('2024-02-29'))).toBe(29);
  });

  it('compares and picks extremes', () => {
    expect(compareDates(date('2025-01-01'), date('2025-01-02'))).toBe(-1);
    expect(compareDates(date('2025-01-02'), date('2025-01-01'))).toBe(1);
    expect(compareDates(date('2025-01-01'), date('2025-01-01'))).toBe(0);
    expect(minDate(date('2025-01-02'), date('2025-01-01'))).toBe('2025-01-01');
    expect(maxDate(date('2025-01-02'), date('2025-01-01'))).toBe('2025-01-02');
  });
});

describe('periods', () => {
  it('derives the period key and its bounds', () => {
    expect(periodKeyOf(date('2025-11-04'))).toBe('2025-11');
    expect(periodStart(period('2025-11'))).toBe('2025-11-01');
    expect(periodEnd(period('2025-11'))).toBe('2025-11-30');
    expect(periodEnd(period('2025-02'))).toBe('2025-02-28');
    expect(periodEnd(period('2024-02'))).toBe('2024-02-29');
  });

  it('steps months across year boundaries', () => {
    expect(addMonths(period('2025-11'), 1)).toBe('2025-12');
    expect(addMonths(period('2025-12'), 1)).toBe('2026-01');
    expect(addMonths(period('2025-01'), -1)).toBe('2024-12');
    expect(addMonths(period('2025-06'), 12)).toBe('2026-06');
    expect(addMonths(period('2025-06'), -18)).toBe('2023-12');
  });

  it('clamps a recurring day to short months', () => {
    expect(clampDayToMonth(period('2025-11'), 5)).toBe('2025-11-05');
    expect(clampDayToMonth(period('2025-11'), 31)).toBe('2025-11-30');
    expect(clampDayToMonth(period('2025-02'), 31)).toBe('2025-02-28');
    expect(clampDayToMonth(period('2024-02'), 30)).toBe('2024-02-29');
    expect(() => clampDayToMonth(period('2025-02'), 32)).toThrow(RangeError);
    expect(() => clampDayToMonth(period('2025-02'), 0)).toThrow(RangeError);
  });
});

describe('weekdays', () => {
  it('matches the platform weekday numbering', () => {
    // 2025-11-04 was a Tuesday.
    expect(weekdayOf(date('2025-11-04'))).toBe(2);
    expect(weekdayName(date('2025-11-04'))).toBe('Tuesday');
    expect(weekdayOf(raw('1970-01-01'))).toBe(4);
    expect(weekdayName(raw('1970-01-01'))).toBe('Thursday');
    expect(weekdayName(date('2025-11-09'))).toBe('Sunday');
  });
});

describe('formatting', () => {
  it('writes dates the same way in every locale', () => {
    expect(formatDateShort(date('2025-11-04'))).toBe('4 Nov 2025');
    expect(formatPeriod(period('2025-11'))).toBe('November 2025');
  });

  it('names the days around today', () => {
    const today = date('2025-11-04');
    expect(formatDateRelative(today, today)).toBe('Today');
    expect(formatDateRelative(date('2025-11-03'), today)).toBe('Yesterday');
    expect(formatDateRelative(date('2025-11-05'), today)).toBe('Tomorrow');
    expect(formatDateRelative(date('2025-10-30'), today)).toBe('30 Oct 2025');
  });

  it('splits a date back into its parts', () => {
    expect(splitDate(date('2025-11-04'))).toEqual({ year: 2025, month: 11, day: 4 });
  });
});

describe('formatDaysAgo', () => {
  const today = date('2025-11-04');

  it('says it in words for the days people care about', () => {
    expect(formatDaysAgo(today, today)).toBe('today');
    expect(formatDaysAgo(date('2025-11-03'), today)).toBe('yesterday');
    expect(formatDaysAgo(date('2025-11-01'), today)).toBe('3 days ago');
  });

  it('switches to months and then years rather than counting to 400', () => {
    expect(formatDaysAgo(date('2025-10-01'), today)).toBe('a month ago');
    expect(formatDaysAgo(date('2025-05-04'), today)).toBe('6 months ago');
    expect(formatDaysAgo(date('2024-11-04'), today)).toBe('a year ago');
    expect(formatDaysAgo(date('2023-11-04'), today)).toBe('2 years ago');
  });

  it('reads a future date forwards, which a backdated ledger can produce', () => {
    expect(formatDaysAgo(date('2025-11-05'), today)).toBe('tomorrow');
    expect(formatDaysAgo(date('2025-11-08'), today)).toBe('in 4 days');
  });
});

describe('dateOfMs and formatClockTime', () => {
  it('reads the local calendar day a timestamp falls on', () => {
    const at = new Date(2025, 10, 4, 23, 59, 0).getTime();
    expect(dateOfMs(at)).toBe('2025-11-04');
  });

  it('formats the time with a lowercase am or pm, like the rest of the app', () => {
    expect(formatClockTime(new Date(2025, 10, 4, 18, 41, 0).getTime())).toBe('6:41 pm');
    expect(formatClockTime(new Date(2025, 10, 4, 9, 5, 0).getTime())).toBe('9:05 am');
  });

  it('calls midnight and noon twelve rather than zero', () => {
    expect(formatClockTime(new Date(2025, 10, 4, 0, 0, 0).getTime())).toBe('12:00 am');
    expect(formatClockTime(new Date(2025, 10, 4, 12, 0, 0).getTime())).toBe('12:00 pm');
  });

  it('refuses a timestamp it cannot use rather than inventing a time', () => {
    expect(dateOfMs(0)).toBeNull();
    expect(dateOfMs(Number.NaN)).toBeNull();
    expect(formatClockTime(0)).toBeNull();
    expect(formatClockTime(Number.NaN)).toBeNull();
  });
});

describe('todayFrom', () => {
  it('reads the local calendar day, not the UTC one', () => {
    // 1 Jan 2026 00:30 local time is still 31 Dec 2025 in UTC. The ledger must
    // say 1 January, because that is the day the user is living in.
    const localNewYear = new Date(2026, 0, 1, 0, 30, 0);
    expect(todayFrom(localNewYear)).toBe('2026-01-01');
    expect(todayFrom(new Date(2025, 10, 4, 23, 59, 59))).toBe('2025-11-04');
  });
});

/**
 * A guard rather than a unit test: a `new Date(...)` anywhere else in the app
 * reintroduces exactly the timezone bug this module exists to prevent. The
 * clock enters the app through `todayFrom(new Date())` at the edges only.
 */
describe('date construction is confined to this module', () => {
  const allowed = new Set(['src/lib/dates.ts', 'src/lib/dates.test.ts', 'src/lib/clock.ts']);

  function walk(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, found);
      else if (/\.tsx?$/.test(entry)) found.push(full);
    }
    return found;
  }

  it('finds no raw Date construction outside dates.ts and clock.ts', () => {
    const offenders: string[] = [];
    for (const file of walk('src')) {
      const relative = file.replace(/\\/g, '/');
      if (allowed.has(relative)) continue;
      const source = readFileSync(file, 'utf8');
      if (/new Date\s*\(|Date\.now\s*\(/.test(source)) offenders.push(relative);
    }
    expect(offenders).toEqual([]);
  });
});
