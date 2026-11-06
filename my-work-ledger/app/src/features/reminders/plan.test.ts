import { describe, expect, it } from 'vitest';

import { asCalendarDate } from '@/lib/dates';
import type { Reminder, ReminderKind, ReminderType } from '@/types/models';

import {
  MAX_PLANNED,
  PLAN_HORIZON_DAYS,
  planFingerprint,
  planId,
  planNotifications,
  type PlanShop,
} from './plan';

const date = asCalendarDate;

function shop(overrides: Partial<PlanShop> = {}): PlanShop {
  return {
    id: 'shop_blue',
    name: 'Blue Mart',
    status: 'active',
    settlementMode: 'accrual',
    salaryPayDay: 5,
    hasDailyAllowance: true,
    ...overrides,
  };
}

let sequence = 0;

function reminder(overrides: Partial<Reminder> & { kind: ReminderKind }): Reminder {
  sequence += 1;
  return {
    id: `rem_${sequence}`,
    shopId: null,
    type: 'daily' as ReminderType,
    title: 'Reminder',
    body: '',
    weekday: null,
    dayOfMonth: null,
    onDate: null,
    time: '20:00',
    enabled: true,
    lastFiredAt: null,
    ...overrides,
  };
}

/** Mid-month, mid-afternoon, so nothing is accidentally in the past. */
const now = { date: date('2025-11-12'), time: '15:00' };

describe('planId', () => {
  it('is stable for a key, so rescheduling lands on the same alarm', () => {
    expect(planId('dailyTick|2025-11-12')).toBe(planId('dailyTick|2025-11-12'));
  });

  it('differs between keys', () => {
    expect(planId('dailyTick|2025-11-12')).not.toBe(planId('dailyTick|2025-11-13'));
  });

  it('is always a positive 31-bit integer, which is what Android takes', () => {
    for (const key of ['a', 'dailyTick|2025-11-12', 'custom|rem_9|2026-02-28', '']) {
      const id = planId(key);
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThanOrEqual(0);
      expect(id).toBeLessThan(2 ** 31);
    }
  });
});

describe('planNotifications', () => {
  it('sets a food-money reminder for every day of the horizon', () => {
    const plan = planNotifications({ reminders: [], shops: [shop()], now });
    const daily = plan.filter((entry) => entry.key.startsWith('dailyTick|'));
    expect(daily.length).toBe(PLAN_HORIZON_DAYS + 1);
    expect(daily[0]?.title).toContain('food money');
    expect(daily[0]?.body).toContain('Blue Mart');
  });

  it('never sets one for a moment that has already passed', () => {
    // An alarm for a past moment fires the instant it is registered, which
    // would pop every one of today's reminders each time the app is opened.
    const evening = planNotifications({
      reminders: [],
      shops: [shop()],
      now: { date: date('2025-11-12'), time: '21:30' },
    });
    expect(evening.some((entry) => entry.date === '2025-11-12')).toBe(false);
    expect(evening.some((entry) => entry.date === '2025-11-13')).toBe(true);
  });

  it('sets nothing daily for a shop with no daily allowance', () => {
    const plan = planNotifications({
      reminders: [],
      shops: [shop({ hasDailyAllowance: false })],
      now,
    });
    expect(plan.some((entry) => entry.key.startsWith('dailyTick|'))).toBe(false);
  });

  it('ignores an archived shop entirely', () => {
    const plan = planNotifications({ reminders: [], shops: [shop({ status: 'archived' })], now });
    expect(plan).toEqual([]);
  });

  it('ignores a daily-wage shop, where nothing accrues to chase', () => {
    const plan = planNotifications({
      reminders: [],
      shops: [shop({ settlementMode: 'cashOnly' })],
      now,
    });
    expect(plan).toEqual([]);
  });

  it('gives a week of warning before salary day', () => {
    const plan = planNotifications({
      reminders: [],
      shops: [shop({ salaryPayDay: 25 })],
      now,
    });
    const salary = plan.filter((entry) => entry.key.startsWith('salaryDueSoon|'));
    expect(salary.map((entry) => entry.date)).toEqual(['2025-11-18']);
    expect(salary[0]?.title).toBe('Salary from Blue Mart in a week');
  });

  it('warns once, not every day of the week before', () => {
    const plan = planNotifications({
      reminders: [],
      shops: [shop({ salaryPayDay: 25 })],
      now,
    });
    expect(plan.filter((entry) => entry.key.startsWith('salaryDueSoon|')).length).toBe(1);
  });

  it('clamps a 31st pay day into a short month', () => {
    const plan = planNotifications({
      reminders: [],
      shops: [shop({ salaryPayDay: 31 })],
      now: { date: date('2026-02-01'), time: '06:00' },
    });
    const salary = plan.filter((entry) => entry.key.startsWith('salaryDueSoon|'));
    // February 2026 ends on the 28th, so the notice is seven days before that.
    expect(salary.map((entry) => entry.date)).toContain('2026-02-21');
  });

  it('combines the two month-turn reminders when both are on at the same time', () => {
    const plan = planNotifications({
      reminders: [],
      shops: [shop()],
      now: { date: date('2025-11-28'), time: '09:00' },
    });
    const turned = plan.filter((entry) => entry.key.startsWith('monthTurned|'));
    expect(turned.map((entry) => entry.date)).toEqual(['2025-12-01']);
    expect(turned[0]?.title).toBe('November is over at Blue Mart');
    expect(plan.some((entry) => entry.key.startsWith('monthEnded|'))).toBe(false);
    expect(plan.some((entry) => entry.key.startsWith('settleReady|'))).toBe(false);
  });

  it('splits them again when they are given different times', () => {
    const plan = planNotifications({
      reminders: [
        reminder({ kind: 'monthEnded', time: '09:00' }),
        reminder({ kind: 'settleReady', time: '19:00' }),
      ],
      shops: [shop()],
      now: { date: date('2025-11-28'), time: '09:00' },
    });
    expect(plan.filter((entry) => entry.key.startsWith('monthEnded|')).length).toBe(1);
    expect(plan.filter((entry) => entry.key.startsWith('settleReady|')).length).toBe(1);
    expect(plan.some((entry) => entry.key.startsWith('monthTurned|'))).toBe(false);
  });

  it('drops a kind that is switched off', () => {
    const plan = planNotifications({
      reminders: [reminder({ kind: 'dailyTick', enabled: false })],
      shops: [shop()],
      now,
    });
    expect(plan.some((entry) => entry.key.startsWith('dailyTick|'))).toBe(false);
  });

  it('uses the time the reminder is set to', () => {
    const plan = planNotifications({
      reminders: [reminder({ kind: 'dailyTick', time: '07:30' })],
      shops: [shop()],
      now,
    });
    expect(plan.find((entry) => entry.key.startsWith('dailyTick|'))?.time).toBe('07:30');
  });

  it('names two shops, and counts the rest', () => {
    const three = [
      shop({ id: 'a', name: 'Blue Mart' }),
      shop({ id: 'b', name: 'Corner Store' }),
      shop({ id: 'c', name: 'Night Stall' }),
    ];
    const body = planNotifications({ reminders: [], shops: three, now }).find((entry) =>
      entry.key.startsWith('dailyTick|'),
    )?.body;
    expect(body).toContain('Blue Mart and 2 others');

    const two = planNotifications({ reminders: [], shops: three.slice(0, 2), now }).find((entry) =>
      entry.key.startsWith('dailyTick|'),
    )?.body;
    expect(two).toContain('Blue Mart and Corner Store');
  });

  it('plans a custom reminder on the days it is due', () => {
    const plan = planNotifications({
      reminders: [
        reminder({
          kind: 'custom',
          type: 'weekly',
          weekday: 1,
          title: 'Pay the room rent',
          body: 'Before the landlord asks',
          time: '18:00',
        }),
      ],
      shops: [],
      now,
    });
    expect(plan.map((entry) => entry.date)).toEqual(['2025-11-17', '2025-11-24', '2025-12-01']);
    expect(plan[0]?.title).toBe('Pay the room rent');
    expect(plan[0]?.body).toBe('Before the landlord asks');
  });

  it('gives a custom reminder with no note something to say', () => {
    const plan = planNotifications({
      reminders: [reminder({ kind: 'custom', type: 'oneTime', onDate: date('2025-11-20') })],
      shops: [],
      now,
    });
    expect(plan[0]?.body.length).toBeGreaterThan(0);
  });

  it('quotes no amount anywhere, because the wording is fixed when it is set', () => {
    const plan = planNotifications({
      reminders: [],
      shops: [shop({ salaryPayDay: 25 })],
      now,
    });
    for (const entry of plan) {
      expect(`${entry.title} ${entry.body}`).not.toContain('₹');
    }
  });

  it('is sorted soonest first and capped', () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      shop({ id: `shop_${index}`, name: `Shop ${index}`, salaryPayDay: ((index * 2) % 28) + 1 }),
    );
    const plan = planNotifications({ reminders: [], shops: many, now });
    expect(plan.length).toBeLessThanOrEqual(MAX_PLANNED);
    const stamps = plan.map((entry) => `${entry.date}T${entry.time}`);
    expect([...stamps].sort()).toEqual(stamps);
  });

  it('plans nothing at all with no shops and no custom reminders', () => {
    expect(planNotifications({ reminders: [], shops: [], now })).toEqual([]);
  });

  it('gives the same plan the same fingerprint, so it is not rescheduled for nothing', () => {
    const once = planNotifications({ reminders: [], shops: [shop()], now });
    const twice = planNotifications({ reminders: [], shops: [shop()], now });
    expect(planFingerprint(once)).toBe(planFingerprint(twice));
    expect(planFingerprint(once)).not.toBe(
      planFingerprint(planNotifications({ reminders: [], shops: [shop()], now: { ...now, date: date('2025-11-13') } })),
    );
  });

  it('gives every planned alarm a distinct id', () => {
    const plan = planNotifications({
      reminders: [reminder({ kind: 'custom', type: 'daily', title: 'Count the till' })],
      shops: [shop(), shop({ id: 'b', name: 'Corner Store', salaryPayDay: 20 })],
      now,
    });
    expect(new Set(plan.map((entry) => entry.id)).size).toBe(plan.length);
  });
});
