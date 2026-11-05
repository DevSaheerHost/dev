import { describe, expect, it } from 'vitest';

import { addDays, asCalendarDate, type CalendarDate } from '@/lib/dates';
import type { Reminder, ReminderType } from '@/types/models';

import {
  DEFAULT_REMINDER_TIME,
  describeSchedule,
  formatTime,
  isDueNow,
  isDueOn,
  isValidTime,
  minutesOfDay,
  nextOccurrence,
} from './schedule';

const date = asCalendarDate;

function schedule(overrides: Partial<Reminder> & { type: ReminderType }) {
  return {
    type: overrides.type,
    weekday: overrides.weekday ?? null,
    dayOfMonth: overrides.dayOfMonth ?? null,
    onDate: overrides.onDate ?? null,
    time: overrides.time ?? DEFAULT_REMINDER_TIME,
    enabled: overrides.enabled ?? true,
  };
}

/* ========================================================================== */

describe('time handling', () => {
  it('accepts a 24-hour clock and rejects nonsense', () => {
    for (const good of ['00:00', '09:05', '20:00', '23:59']) {
      expect(isValidTime(good), good).toBe(true);
    }
    for (const bad of ['24:00', '8:00', '20:60', '20', '', '2000', '7:5']) {
      expect(isValidTime(bad), bad).toBe(false);
    }
  });

  it('converts to minutes for comparing against the clock', () => {
    expect(minutesOfDay('00:00')).toBe(0);
    expect(minutesOfDay('20:00')).toBe(1200);
    expect(minutesOfDay('23:59')).toBe(1439);
  });

  it('shows a 12-hour time, because that is how people read it', () => {
    expect(formatTime('20:00')).toBe('8:00 pm');
    expect(formatTime('09:05')).toBe('9:05 am');
    expect(formatTime('00:30')).toBe('12:30 am');
    expect(formatTime('12:00')).toBe('12:00 pm');
    expect(formatTime('13:45')).toBe('1:45 pm');
  });

  it('defaults to the evening, after the shop closes', () => {
    expect(DEFAULT_REMINDER_TIME).toBe('20:00');
  });
});

/* ========================================================================== */

describe('daily', () => {
  it('is due every day', () => {
    expect(isDueOn(schedule({ type: 'daily' }), date('2025-11-04'))).toBe(true);
    expect(nextOccurrence(schedule({ type: 'daily' }), date('2025-11-04'))).toBe('2025-11-04');
  });
});

describe('weekly', () => {
  const tuesday = schedule({ type: 'weekly', weekday: 2 });

  it('is due only on its weekday', () => {
    // 2025-11-04 is a Tuesday.
    expect(isDueOn(tuesday, date('2025-11-04'))).toBe(true);
    expect(isDueOn(tuesday, date('2025-11-05'))).toBe(false);
  });

  it('finds the next one within a week', () => {
    expect(nextOccurrence(tuesday, date('2025-11-04'))).toBe('2025-11-04');
    expect(nextOccurrence(tuesday, date('2025-11-05'))).toBe('2025-11-11');
  });

  it('crosses a year boundary', () => {
    // 2025-12-30 is a Tuesday; the next Tuesday is in January.
    expect(nextOccurrence(tuesday, date('2025-12-31'))).toBe('2026-01-06');
  });

  it('is never due without a weekday', () => {
    const broken = schedule({ type: 'weekly' });
    expect(isDueOn(broken, date('2025-11-04'))).toBe(false);
    expect(nextOccurrence(broken, date('2025-11-04'))).toBeNull();
  });
});

/* ========================================================================== */

describe('monthly, and the awkward end of the month', () => {
  it('is due on its day in an ordinary month', () => {
    const fifth = schedule({ type: 'monthly', dayOfMonth: 5 });
    expect(isDueOn(fifth, date('2025-11-05'))).toBe(true);
    expect(isDueOn(fifth, date('2025-11-04'))).toBe(false);
  });

  it('fires on the last day of a month too short for it', () => {
    // "The 31st" has to mean something in February, or the reminder silently
    // skips a month and stops being trustworthy.
    const last = schedule({ type: 'monthly', dayOfMonth: 31 });
    expect(isDueOn(last, date('2025-02-28'))).toBe(true);
    expect(isDueOn(last, date('2025-02-27'))).toBe(false);
    expect(isDueOn(last, date('2025-11-30'))).toBe(true);
    expect(isDueOn(last, date('2025-12-31'))).toBe(true);
  });

  it('handles the 29th and 30th in February, leap year included', () => {
    const twentyNinth = schedule({ type: 'monthly', dayOfMonth: 29 });
    expect(isDueOn(twentyNinth, date('2025-02-28'))).toBe(true); // clamped
    expect(isDueOn(twentyNinth, date('2024-02-29'))).toBe(true); // exists
    expect(isDueOn(twentyNinth, date('2024-02-28'))).toBe(false);

    const thirtieth = schedule({ type: 'monthly', dayOfMonth: 30 });
    expect(isDueOn(thirtieth, date('2024-02-29'))).toBe(true); // clamped
    expect(isDueOn(thirtieth, date('2025-02-28'))).toBe(true); // clamped
  });

  it('finds the next occurrence this month or next', () => {
    const fifth = schedule({ type: 'monthly', dayOfMonth: 5 });
    expect(nextOccurrence(fifth, date('2025-11-01'))).toBe('2025-11-05');
    expect(nextOccurrence(fifth, date('2025-11-05'))).toBe('2025-11-05');
    expect(nextOccurrence(fifth, date('2025-11-06'))).toBe('2025-12-05');
  });

  it('clamps the next occurrence into a short month', () => {
    const last = schedule({ type: 'monthly', dayOfMonth: 31 });
    expect(nextOccurrence(last, date('2025-02-01'))).toBe('2025-02-28');
    expect(nextOccurrence(last, date('2024-02-01'))).toBe('2024-02-29');
    expect(nextOccurrence(last, date('2025-04-15'))).toBe('2025-04-30');
  });

  it('crosses a year boundary', () => {
    const fifth = schedule({ type: 'monthly', dayOfMonth: 5 });
    expect(nextOccurrence(fifth, date('2025-12-06'))).toBe('2026-01-05');
  });

  it('fires in every month of a year, never skipping one', () => {
    const last = schedule({ type: 'monthly', dayOfMonth: 31 });
    const fired: CalendarDate[] = [];
    let cursor = date('2024-01-01');
    for (let guard = 0; guard < 20; guard += 1) {
      const next = nextOccurrence(last, cursor);
      if (!next || next >= date('2025-01-01')) break;
      fired.push(next);
      cursor = addDays(next, 1);
    }
    expect(fired).toHaveLength(12);
    expect(fired[1]).toBe('2024-02-29'); // leap February
    expect(fired[3]).toBe('2024-04-30');
    expect(fired.at(-1)).toBe('2024-12-31');
  });

  it('is never due without a day', () => {
    expect(isDueOn(schedule({ type: 'monthly' }), date('2025-11-04'))).toBe(false);
    expect(nextOccurrence(schedule({ type: 'monthly' }), date('2025-11-04'))).toBeNull();
  });
});

/* ========================================================================== */

describe('one-time', () => {
  const once = schedule({ type: 'oneTime', onDate: date('2025-11-20') });

  it('is due on its day only', () => {
    expect(isDueOn(once, date('2025-11-20'))).toBe(true);
    expect(isDueOn(once, date('2025-11-19'))).toBe(false);
  });

  it('has no next occurrence once it has passed', () => {
    expect(nextOccurrence(once, date('2025-11-01'))).toBe('2025-11-20');
    expect(nextOccurrence(once, date('2025-11-20'))).toBe('2025-11-20');
    expect(nextOccurrence(once, date('2025-11-21'))).toBeNull();
  });
});

/* ========================================================================== */

describe('isDueNow', () => {
  const evening = schedule({ type: 'daily', time: '20:00' });

  it('waits until the time has come round', () => {
    expect(isDueNow(evening, date('2025-11-04'), 19 * 60 + 59)).toBe(false);
    expect(isDueNow(evening, date('2025-11-04'), 20 * 60)).toBe(true);
    expect(isDueNow(evening, date('2025-11-04'), 23 * 60)).toBe(true);
  });

  it('stays quiet when switched off', () => {
    expect(isDueNow({ ...evening, enabled: false }, date('2025-11-04'), 23 * 60)).toBe(false);
  });

  it('respects the day as well as the time', () => {
    const monday = schedule({ type: 'weekly', weekday: 1, time: '20:00' });
    expect(isDueNow(monday, date('2025-11-04'), 23 * 60)).toBe(false); // a Tuesday
    expect(isDueNow(monday, date('2025-11-03'), 23 * 60)).toBe(true);
  });
});

/* ========================================================================== */

describe('describeSchedule', () => {
  it('says plainly when a reminder fires', () => {
    expect(describeSchedule(schedule({ type: 'daily', time: '20:00' }))).toBe(
      'Every day at 8:00 pm',
    );
    expect(describeSchedule(schedule({ type: 'weekly', weekday: 5, time: '09:00' }))).toBe(
      'Every Friday at 9:00 am',
    );
    expect(describeSchedule(schedule({ type: 'monthly', dayOfMonth: 1, time: '20:00' }))).toBe(
      'The 1st of each month at 8:00 pm',
    );
    expect(describeSchedule(schedule({ type: 'monthly', dayOfMonth: 2, time: '20:00' }))).toContain(
      '2nd',
    );
    expect(describeSchedule(schedule({ type: 'monthly', dayOfMonth: 3, time: '20:00' }))).toContain(
      '3rd',
    );
    expect(describeSchedule(schedule({ type: 'monthly', dayOfMonth: 11, time: '20:00' }))).toContain(
      '11th',
    );
  });

  it('warns that a late day gets clamped', () => {
    const text = describeSchedule(schedule({ type: 'monthly', dayOfMonth: 31, time: '20:00' }));
    expect(text).toContain('last day of a shorter month');
    expect(describeSchedule(schedule({ type: 'monthly', dayOfMonth: 28, time: '20:00' }))).not.toContain(
      'shorter month',
    );
  });
});
