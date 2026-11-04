import { describe, expect, it } from 'vitest';

import { asCalendarDate, type CalendarDate, type PeriodKey } from '@/lib/dates';
import { paise, type Paise } from '@/lib/money';
import type { DayRecord, IncomeConfig, Shop } from '@/types/models';

import {
  amountForWorkedDays,
  configsForPeriod,
  countDays,
  datesIn,
  elapsedPart,
  isDailySettled,
  livePosition,
  settledDays,
  shopSpanInPeriod,
  toDayMap,
  unpostedEarnings,
} from './attendance';

const date = asCalendarDate;
const period = (value: string) => value as PeriodKey;
const rs = (rupees: number): Paise => paise(Math.round(rupees * 100));

function shopFixture(overrides: Partial<Shop> = {}): Shop {
  return {
    id: 'shop_1',
    name: 'Blue Mart',
    description: '',
    joiningDate: date('2025-01-01'),
    salaryPayDay: 5,
    settlementMode: 'accrual',
    openingBalance: paise(0),
    openingBalanceAsOf: date('2025-01-01'),
    sealedThroughDate: null,
    status: 'active',
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

function salaryConfig(overrides: Partial<IncomeConfig> = {}): IncomeConfig {
  return {
    id: 'inc_salary',
    kind: 'salary',
    label: 'Monthly salary',
    amount: rs(10000),
    frequency: 'monthly',
    effectiveFrom: date('2025-01-01'),
    effectiveTo: null,
    active: true,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

function foodConfig(overrides: Partial<IncomeConfig> = {}): IncomeConfig {
  return salaryConfig({
    id: 'inc_food',
    kind: 'allowance',
    label: 'Food money',
    amount: rs(100),
    frequency: 'daily',
    ...overrides,
  });
}

/** Day records: `off:` dates not worked, `got:` dates the food money arrived. */
function dayMap(spec: { off?: string[]; got?: Record<string, string[]> } = {}) {
  const records = new Map<CalendarDate, DayRecord>();
  const touch = (value: string): DayRecord => {
    const key = date(value);
    const existing = records.get(key);
    if (existing) return existing;
    const fresh: DayRecord = {
      date: key,
      off: false,
      allowancesReceived: [],
      note: '',
      updatedAt: null,
    };
    records.set(key, fresh);
    return fresh;
  };
  for (const value of spec.off ?? []) {
    records.set(date(value), { ...touch(value), off: true });
  }
  for (const [value, configIds] of Object.entries(spec.got ?? {})) {
    records.set(date(value), { ...touch(value), allowancesReceived: configIds });
  }
  return records as ReadonlyMap<CalendarDate, DayRecord>;
}

/* ========================================================================== */
/* Spans                                                                       */
/* ========================================================================== */

describe('shopSpanInPeriod', () => {
  it('covers a whole month for a shop joined long ago', () => {
    expect(shopSpanInPeriod(shopFixture(), period('2025-11'))).toEqual({
      from: '2025-11-01',
      to: '2025-11-30',
    });
  });

  it('starts from the joining date in the month you joined', () => {
    const shop = shopFixture({
      joiningDate: date('2025-11-21'),
      openingBalanceAsOf: date('2025-11-21'),
    });
    expect(shopSpanInPeriod(shop, period('2025-11'))).toEqual({
      from: '2025-11-21',
      to: '2025-11-30',
    });
  });

  it('never starts before the opening balance date, which would double-count', () => {
    const shop = shopFixture({
      joiningDate: date('2024-06-01'),
      openingBalanceAsOf: date('2025-11-16'),
    });
    expect(shopSpanInPeriod(shop, period('2025-11'))?.from).toBe('2025-11-16');
  });

  it('returns null for a month entirely before the shop existed', () => {
    const shop = shopFixture({
      joiningDate: date('2025-11-01'),
      openingBalanceAsOf: date('2025-11-01'),
    });
    expect(shopSpanInPeriod(shop, period('2025-10'))).toBeNull();
  });
});

describe('elapsedPart', () => {
  const span = { from: date('2025-11-01'), to: date('2025-11-30') };

  it('stops at today', () => {
    expect(elapsedPart(span, date('2025-11-12'))).toEqual({
      from: '2025-11-01',
      to: '2025-11-12',
    });
  });

  it('returns the whole span once the month is over', () => {
    expect(elapsedPart(span, date('2025-12-05'))).toEqual(span);
  });

  it('returns null before the span has started', () => {
    expect(elapsedPart(span, date('2025-10-31'))).toBeNull();
  });

  it('includes today itself on the first day', () => {
    expect(elapsedPart(span, date('2025-11-01'))).toEqual({
      from: '2025-11-01',
      to: '2025-11-01',
    });
  });
});

describe('datesIn', () => {
  it('lists every day inclusive of both ends', () => {
    const dates = datesIn({ from: date('2025-11-28'), to: date('2025-12-01') });
    expect(dates).toEqual(['2025-11-28', '2025-11-29', '2025-11-30', '2025-12-01']);
  });

  it('handles a single day', () => {
    expect(datesIn({ from: date('2025-11-04'), to: date('2025-11-04') })).toEqual(['2025-11-04']);
  });
});

/* ========================================================================== */
/* Counting                                                                    */
/* ========================================================================== */

describe('countDays', () => {
  const span = { from: date('2025-11-01'), to: date('2025-11-30') };

  it('counts every day as worked when nothing is recorded', () => {
    expect(countDays(span, dayMap())).toEqual({ total: 30, off: 0, worked: 30 });
  });

  it('subtracts the days marked off', () => {
    expect(countDays(span, dayMap({ off: ['2025-11-09', '2025-11-23'] }))).toEqual({
      total: 30,
      off: 2,
      worked: 28,
    });
  });

  it('ignores off days outside the span', () => {
    const days = dayMap({ off: ['2025-10-31', '2025-12-01'] });
    expect(countDays(span, days)).toEqual({ total: 30, off: 0, worked: 30 });
  });

  it('does not treat a food-money record as a day off', () => {
    const days = dayMap({ got: { '2025-11-04': ['inc_food'] } });
    expect(countDays(span, days).worked).toBe(30);
  });

  it('handles a null span', () => {
    expect(countDays(null, dayMap())).toEqual({ total: 0, off: 0, worked: 0 });
  });
});

describe('settledDays', () => {
  const span = { from: date('2025-11-01'), to: date('2025-11-30') };

  it('counts only the days the allowance was actually received', () => {
    const days = dayMap({
      got: { '2025-11-01': ['inc_food'], '2025-11-02': ['inc_food'], '2025-11-05': ['inc_food'] },
    });
    expect(settledDays(span, days, 'inc_food')).toBe(3);
  });

  it('keeps separate allowances separate', () => {
    const days = dayMap({
      got: { '2025-11-01': ['inc_food'], '2025-11-02': ['inc_travel'] },
    });
    expect(settledDays(span, days, 'inc_food')).toBe(1);
    expect(settledDays(span, days, 'inc_travel')).toBe(1);
  });

  it('does not count a day that was both ticked and marked off', () => {
    // You cannot be given food money for a day you did not come in; if both are
    // recorded the day off wins, because that is the stronger statement.
    const days = new Map([
      [
        date('2025-11-04'),
        {
          date: date('2025-11-04'),
          off: true,
          allowancesReceived: ['inc_food'],
          note: '',
          updatedAt: null,
        } satisfies DayRecord,
      ],
    ]);
    expect(settledDays(span, days, 'inc_food')).toBe(0);
  });
});

/* ========================================================================== */
/* Money                                                                       */
/* ========================================================================== */

describe('amountForWorkedDays', () => {
  it('pays a full monthly salary when every day was worked', () => {
    // Exactly the amount, with no rounding drift from daily slices.
    expect(amountForWorkedDays(salaryConfig(), 30, period('2025-11'))).toBe(rs(10000));
  });

  it('pro-rates on the calendar month, not on the worked days', () => {
    // Two days off in November: 28/30 of the salary, not a full month spread
    // over 28 days.
    expect(amountForWorkedDays(salaryConfig(), 28, period('2025-11'))).toBe(933333);
  });

  it('uses the real length of a short month', () => {
    expect(amountForWorkedDays(salaryConfig(), 28, period('2025-02'))).toBe(rs(10000));
    expect(amountForWorkedDays(salaryConfig(), 14, period('2025-02'))).toBe(rs(5000));
  });

  it('handles a leap February', () => {
    expect(amountForWorkedDays(salaryConfig(), 29, period('2024-02'))).toBe(rs(10000));
    expect(amountForWorkedDays(salaryConfig(), 28, period('2024-02'))).toBe(965517);
  });

  it('multiplies a daily rate by the days worked', () => {
    expect(amountForWorkedDays(foodConfig(), 26, period('2025-11'))).toBe(rs(2600));
  });

  it('scales a weekly rate', () => {
    const weekly = salaryConfig({ frequency: 'weekly', amount: rs(700) });
    expect(amountForWorkedDays(weekly, 28, period('2025-11'))).toBe(rs(2800));
  });

  it('is zero for no worked days', () => {
    expect(amountForWorkedDays(salaryConfig(), 0, period('2025-11'))).toBe(0);
    expect(amountForWorkedDays(foodConfig(), -1, period('2025-11'))).toBe(0);
  });
});

describe('isDailySettled', () => {
  it('is true only for a daily allowance, which is what the calendar ticks', () => {
    expect(isDailySettled(foodConfig())).toBe(true);
    expect(isDailySettled(salaryConfig())).toBe(false);
    expect(isDailySettled(salaryConfig({ kind: 'allowance', frequency: 'monthly' }))).toBe(false);
    expect(isDailySettled(salaryConfig({ kind: 'salary', frequency: 'daily' }))).toBe(false);
  });
});

describe('configsForPeriod', () => {
  it('keeps configs that touch the month and drops the rest', () => {
    const configs = [
      salaryConfig({ id: 'a' }),
      salaryConfig({ id: 'b', effectiveFrom: date('2025-12-01') }),
      salaryConfig({ id: 'c', effectiveTo: date('2025-10-31') }),
      salaryConfig({ id: 'd', effectiveTo: date('2025-11-01') }),
      salaryConfig({ id: 'e', active: false }),
    ];
    expect(configsForPeriod(configs, period('2025-11')).map((config) => config.id)).toEqual([
      'a',
      'd',
    ]);
  });
});

/* ========================================================================== */
/* The live position — what the shop page shows                                */
/* ========================================================================== */

describe('livePosition', () => {
  const base = {
    shop: shopFixture(),
    configs: [salaryConfig()],
    days: dayMap(),
    period: period('2025-11'),
  };

  it('climbs day by day through the month', () => {
    // 10,000 / 30 days. The figure the user watches go up.
    const onDay1 = livePosition({ ...base, today: date('2025-11-01') });
    const onDay10 = livePosition({ ...base, today: date('2025-11-10') });
    const onDay30 = livePosition({ ...base, today: date('2025-11-30') });

    expect(onDay1.earnedToDate).toBe(33333); // 1/30
    expect(onDay10.earnedToDate).toBe(rs(10000 / 3)); // 10/30
    expect(onDay30.earnedToDate).toBe(rs(10000)); // the whole month, exactly
    expect(onDay1.earnedToDate).toBeLessThan(onDay10.earnedToDate);
  });

  it('reports the days worked, off and remaining', () => {
    const position = livePosition({
      ...base,
      days: dayMap({ off: ['2025-11-03', '2025-11-17'] }),
      today: date('2025-11-12'),
    });
    expect(position.counts).toEqual({ total: 30, off: 2, worked: 28 });
    expect(position.elapsed).toEqual({ total: 12, off: 1, worked: 11 });
    expect(position.daysRemaining).toBe(18);
  });

  it('drops the earned figure when a day is marked off', () => {
    const today = date('2025-11-10');
    const present = livePosition({ ...base, today });
    const absent = livePosition({ ...base, days: dayMap({ off: ['2025-11-05'] }), today });
    expect(absent.earnedToDate).toBeLessThan(present.earnedToDate);
    expect(absent.elapsed.worked).toBe(9);
    expect(absent.earnedToDate).toBe(rs(3000)); // 9/30 of 10,000
  });

  it('projects what the whole month will come to', () => {
    const position = livePosition({
      ...base,
      days: dayMap({ off: ['2025-11-03', '2025-11-25'] }),
      today: date('2025-11-10'),
    });
    // 28 of 30 days will be worked, including one absence still in the future.
    expect(position.projectedMonth).toBe(933333);
  });

  it('shows food money owed and settled separately', () => {
    const position = livePosition({
      shop: shopFixture(),
      configs: [foodConfig()],
      days: dayMap({
        got: {
          '2025-11-01': ['inc_food'],
          '2025-11-02': ['inc_food'],
          '2025-11-03': ['inc_food'],
        },
      }),
      period: period('2025-11'),
      today: date('2025-11-05'),
    });

    const line = position.lines[0];
    expect(line).toMatchObject({
      configId: 'inc_food',
      isDailySettled: true,
      settledDayCount: 3,
    });
    expect(line?.earnedToDate).toBe(rs(500)); // 5 days at 100
    expect(line?.settledToDate).toBe(rs(300)); // 3 of them handed over
    expect(line?.outstanding).toBe(rs(200)); // 2 days still owed
  });

  it('does not treat an unpaid salary as settled', () => {
    // Only a daily allowance is ticked off on the calendar; salary is paid in
    // one go and recorded as an ordinary entry.
    const line = livePosition({ ...base, today: date('2025-11-10') }).lines[0];
    expect(line?.isDailySettled).toBe(false);
    expect(line?.settledToDate).toBe(0);
    expect(line?.outstanding).toBe(line?.earnedToDate);
  });

  it('adds up several income lines', () => {
    const position = livePosition({
      shop: shopFixture(),
      configs: [salaryConfig(), foodConfig()],
      days: dayMap(),
      period: period('2025-11'),
      today: date('2025-11-10'),
    });
    expect(position.lines).toHaveLength(2);
    // 10/30 of 10,000 = 3,333.33, plus 10 days of food at 100 = 1,000.
    expect(position.earnedToDate).toBe(333333 + rs(1000));
  });

  it('accrues nothing at a daily-wage shop', () => {
    const position = livePosition({
      ...base,
      shop: shopFixture({ settlementMode: 'cashOnly' }),
      today: date('2025-11-10'),
    });
    expect(position.earnedToDate).toBe(0);
    expect(position.lines).toEqual([]);
    // The day counts still work, because worked days are worth knowing anyway.
    expect(position.counts.worked).toBe(30);
  });

  it('counts only from the day you joined, mid-month', () => {
    const shop = shopFixture({
      joiningDate: date('2025-11-21'),
      openingBalanceAsOf: date('2025-11-21'),
    });
    const position = livePosition({
      ...base,
      shop,
      configs: [salaryConfig({ effectiveFrom: date('2025-11-21') })],
      today: date('2025-11-30'),
    });
    expect(position.counts).toEqual({ total: 10, off: 0, worked: 10 });
    expect(position.earnedToDate).toBe(rs(10000 / 3)); // 10/30
  });

  it('is empty for a month before the shop existed', () => {
    const shop = shopFixture({
      joiningDate: date('2025-11-01'),
      openingBalanceAsOf: date('2025-11-01'),
    });
    const position = livePosition({
      ...base,
      shop,
      period: period('2025-10'),
      today: date('2025-11-10'),
    });
    expect(position.span).toBeNull();
    expect(position.earnedToDate).toBe(0);
    expect(position.daysRemaining).toBe(0);
  });

  it('earns nothing before the month starts', () => {
    const position = livePosition({ ...base, today: date('2025-10-15') });
    expect(position.earnedToDate).toBe(0);
    expect(position.elapsed.worked).toBe(0);
    expect(position.daysRemaining).toBe(30);
  });

  it('is fully earned for a month long past', () => {
    const position = livePosition({ ...base, today: date('2026-03-01') });
    expect(position.earnedToDate).toBe(rs(10000));
    expect(position.daysRemaining).toBe(0);
  });

  it('splits a mid-month raise across two configs', () => {
    const position = livePosition({
      ...base,
      configs: [
        salaryConfig({ id: 'old', amount: rs(10000), effectiveTo: date('2025-11-10') }),
        salaryConfig({ id: 'new', amount: rs(12000), effectiveFrom: date('2025-11-11') }),
      ],
      today: date('2025-11-30'),
    });
    // 10/30 of 10,000 plus 20/30 of 12,000.
    expect(position.lines.map((line) => line.earnedToDate)).toEqual([rs(10000 / 3), rs(8000)]);
    expect(position.earnedToDate).toBe(333333 + rs(8000));
  });
});

/* ========================================================================== */
/* Not double-counting a posted month                                          */
/* ========================================================================== */

describe('unpostedEarnings', () => {
  const position = livePosition({
    shop: shopFixture(),
    configs: [salaryConfig(), foodConfig()],
    days: dayMap(),
    period: period('2025-11'),
    today: date('2025-11-10'),
  });

  it('counts everything while nothing has been posted', () => {
    expect(unpostedEarnings(position, new Set())).toBe(position.earnedToDate);
  });

  it('stops counting a line once its accrual is a real entry', () => {
    // Otherwise the posted salary would be counted twice: once as a stored
    // transaction and again as a live estimate.
    const posted = new Set(['inc_salary:2025-11']);
    expect(unpostedEarnings(position, posted)).toBe(rs(1000)); // food money only
  });

  it('is zero once every line is posted', () => {
    const posted = new Set(['inc_salary:2025-11', 'inc_food:2025-11']);
    expect(unpostedEarnings(position, posted)).toBe(0);
  });
});

describe('toDayMap', () => {
  it('keys records by their date', () => {
    const records: DayRecord[] = [
      {
        date: date('2025-11-04'),
        off: true,
        allowancesReceived: [],
        note: 'sick',
        updatedAt: null,
      },
    ];
    expect(toDayMap(records).get(date('2025-11-04'))?.note).toBe('sick');
  });
});
