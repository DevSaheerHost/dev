import { describe, expect, it } from 'vitest';

import { asCalendarDate, type PeriodKey } from '@/lib/dates';
import { paise, type Paise } from '@/lib/money';
import type {
  DayRecord,
  IncomeConfig,
  Shop,
  Transaction,
  TransactionKind,
} from '@/types/models';

import {
  deriveReminders,
  dueForNotification,
  type DerivedKind,
  type ReminderPrefs,
  type ShopSnapshot,
} from './derived';

const date = asCalendarDate;
const rs = (rupees: number): Paise => paise(Math.round(rupees * 100));

/** Today in the fixtures: a Wednesday, mid-month. */
const TODAY = date('2025-11-12');

function shopFixture(overrides: Partial<Shop> = {}): Shop {
  return {
    id: 'shop_1',
    name: 'Blue Mart',
    description: '',
    joiningDate: date('2025-01-01'),
    salaryPayDay: 18,
    settlementMode: 'accrual',
    openingBalance: paise(0),
    openingBalanceAsOf: date('2025-01-01'),
    sealedThroughDate: date('2025-10-31'),
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

const foodConfig = (overrides: Partial<IncomeConfig> = {}): IncomeConfig =>
  salaryConfig({
    id: 'inc_food',
    kind: 'allowance',
    label: 'Food money',
    amount: rs(100),
    frequency: 'daily',
    ...overrides,
  });

let sequence = 0;
function txn(
  overrides: Partial<Transaction> & { kind: TransactionKind; amount: Paise },
): Transaction {
  sequence += 1;
  const id = overrides.id ?? `txn_${sequence}`;
  const transactionDate = overrides.transactionDate ?? TODAY;
  return {
    id,
    uid: 'uid_1',
    shopId: 'shop_1',
    direction: 'credit',
    category: '',
    description: '',
    recognitionDate: transactionDate,
    periodKey: transactionDate.slice(0, 7) as PeriodKey,
    sortKey: `${transactionDate}#${1_700_000_000_000 + sequence}#${id}`,
    clientCreatedAtMs: 1_700_000_000_000 + sequence,
    reimbursable: null,
    fundedFrom: null,
    accrualKey: null,
    settlesExpenseIds: null,
    recoversTransactionId: null,
    pairId: null,
    settlementId: null,
    isPriorPeriodAdjustment: false,
    adjustsSettlementId: null,
    createdAt: null,
    updatedAt: null,
    voidedAt: null,
    voidReason: null,
    ...overrides,
    transactionDate,
  };
}

function snapshot(overrides: Partial<ShopSnapshot> = {}): ShopSnapshot {
  return {
    shop: shopFixture(),
    transactions: [],
    configs: [salaryConfig()],
    days: [],
    ...overrides,
  };
}

const allOn: ReminderPrefs = new Map();
const only = (kind: DerivedKind): ReminderPrefs => {
  const off: [DerivedKind, { enabled: boolean; time: string }][] = (
    ['salaryDueSoon', 'monthEnded', 'dailyTick', 'settleReady'] as DerivedKind[]
  ).map((k) => [k, { enabled: k === kind, time: '20:00' }]);
  return new Map(off);
};

const kindsOf = (shops: ShopSnapshot[], prefs: ReminderPrefs = allOn, today = TODAY) =>
  deriveReminders({ shops, prefs, today }).map((reminder) => reminder.kind);

/* ========================================================================== */

describe('a week before salary day', () => {
  it('appears inside the notice window', () => {
    // Salary day is the 18th; today is the 12th, so six days away.
    const [reminder] = deriveReminders({
      shops: [snapshot()],
      prefs: only('salaryDueSoon'),
      today: TODAY,
    });
    expect(reminder?.kind).toBe('salaryDueSoon');
    expect(reminder?.title).toContain('in 6 days');
  });

  it('stays quiet when salary day is further off', () => {
    const shop = shopFixture({ salaryPayDay: 28 });
    expect(kindsOf([snapshot({ shop })], only('salaryDueSoon'))).toEqual([]);
  });

  it('stops once the day has arrived', () => {
    // On the day itself the reminder has done its job; the month-end and
    // settle nudges take over from here.
    expect(kindsOf([snapshot()], only('salaryDueSoon'), date('2025-11-18'))).toEqual([]);
    expect(kindsOf([snapshot()], only('salaryDueSoon'), date('2025-11-19'))).toEqual([]);
  });

  it('uses the singular on the last day', () => {
    const [reminder] = deriveReminders({
      shops: [snapshot()],
      prefs: only('salaryDueSoon'),
      today: date('2025-11-17'),
    });
    expect(reminder?.title).toContain('in 1 day');
  });

  it('works for a salary day that does not exist in a short month', () => {
    const shop = shopFixture({ salaryPayDay: 31 });
    const [reminder] = deriveReminders({
      shops: [snapshot({ shop })],
      prefs: only('salaryDueSoon'),
      today: date('2025-02-24'),
    });
    // Clamped to the 28th, so four days away rather than never.
    expect(reminder?.title).toContain('in 4 days');
  });

  it('says nothing at a daily-wage shop, where no salary accrues', () => {
    const shop = shopFixture({ settlementMode: 'cashOnly' });
    expect(kindsOf([snapshot({ shop })], only('salaryDueSoon'))).toEqual([]);
  });
});

/* ========================================================================== */

describe('the month is over', () => {
  it('appears while a finished month is unconfirmed', () => {
    const shop = shopFixture({ sealedThroughDate: null });
    const [reminder] = deriveReminders({
      shops: [snapshot({ shop })],
      prefs: only('monthEnded'),
      today: TODAY,
    });
    expect(reminder?.kind).toBe('monthEnded');
    expect(reminder?.title).toContain('is finished at Blue Mart');
    expect(reminder?.action).toEqual({ type: 'confirmMonth', shopId: 'shop_1' });
  });

  it('clears once the month has been confirmed', () => {
    // The accrual is now a real entry, so there is nothing left to confirm.
    const shop = shopFixture({ sealedThroughDate: null });
    const posted = ['2025-09', '2025-10'].map((period, index) =>
      txn({
        id: `acc_${index}`,
        kind: 'salary_earned',
        amount: rs(10000),
        transactionDate: date(`${period}-28`),
        accrualKey: `inc_salary:${period}`,
      }),
    );
    const everyMonth = [
      ...posted,
      ...['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08'].map(
        (period, index) =>
          txn({
            id: `acc_old_${index}`,
            kind: 'salary_earned',
            amount: rs(10000),
            transactionDate: date(`${period}-28`),
            accrualKey: `inc_salary:${period}`,
          }),
      ),
    ];
    expect(kindsOf([snapshot({ shop, transactions: everyMonth })], only('monthEnded'))).toEqual([]);
  });

  it('says nothing for an archived shop', () => {
    const shop = shopFixture({ status: 'archived', sealedThroughDate: null });
    expect(kindsOf([snapshot({ shop })], allOn)).toEqual([]);
  });
});

/* ========================================================================== */

describe('the daily tick', () => {
  const withFood = () => snapshot({ configs: [salaryConfig(), foodConfig()] });

  it('appears when today has not been recorded', () => {
    const [reminder] = deriveReminders({
      shops: [withFood()],
      prefs: only('dailyTick'),
      today: TODAY,
    });
    expect(reminder?.kind).toBe('dailyTick');
    expect(reminder?.title.toLowerCase()).toContain('food money');
    expect(reminder?.action).toEqual({ type: 'tickToday', shopId: 'shop_1' });
  });

  it('clears once today is ticked', () => {
    const days: DayRecord[] = [
      { date: TODAY, off: false, allowancesReceived: ['inc_food'], note: '', updatedAt: null },
    ];
    expect(kindsOf([{ ...withFood(), days }], only('dailyTick'))).toEqual([]);
  });

  it('clears once today is marked as a day off', () => {
    const days: DayRecord[] = [
      { date: TODAY, off: true, allowancesReceived: [], note: '', updatedAt: null },
    ];
    expect(kindsOf([{ ...withFood(), days }], only('dailyTick'))).toEqual([]);
  });

  it('says nothing when the shop has no daily allowance', () => {
    // Nothing to tick, so nothing to nudge about.
    expect(kindsOf([snapshot()], only('dailyTick'))).toEqual([]);
  });

  it('says nothing before you joined', () => {
    const shop = shopFixture({ joiningDate: date('2025-12-01') });
    expect(kindsOf([{ ...withFood(), shop }], only('dailyTick'))).toEqual([]);
  });

  it('names what is still outstanding once days have gone unticked', () => {
    const [reminder] = deriveReminders({
      shops: [withFood()],
      prefs: only('dailyTick'),
      today: TODAY,
    });
    // Twelve days into November at 100 a day, none of them ticked.
    expect(reminder?.body).toContain('1,200');
  });
});

/* ========================================================================== */

describe('a period waiting to be settled', () => {
  it('appears while there is something to settle', () => {
    const shop = shopFixture({ sealedThroughDate: date('2025-09-30') });
    const [reminder] = deriveReminders({
      shops: [snapshot({ shop })],
      prefs: only('settleReady'),
      today: TODAY,
    });
    expect(reminder?.kind).toBe('settleReady');
    expect(reminder?.action).toEqual({ type: 'settle', shopId: 'shop_1' });
  });

  it('clears once the period is settled', () => {
    // Sealed through the end of last month, so nothing is outstanding.
    expect(kindsOf([snapshot()], only('settleReady'))).toEqual([]);
  });
});

/* ========================================================================== */

describe('switching kinds off', () => {
  it('honours the preference', () => {
    const shop = shopFixture({ sealedThroughDate: null });
    const everything = kindsOf([snapshot({ shop, configs: [salaryConfig(), foodConfig()] })]);
    expect(new Set(everything)).toEqual(
      new Set(['salaryDueSoon', 'monthEnded', 'dailyTick', 'settleReady']),
    );

    const silenced: ReminderPrefs = new Map([
      ['monthEnded', { enabled: false, time: '20:00' }],
      ['dailyTick', { enabled: false, time: '20:00' }],
    ]);
    const some = kindsOf(
      [snapshot({ shop, configs: [salaryConfig(), foodConfig()] })],
      silenced,
    );
    expect(some).not.toContain('monthEnded');
    expect(some).not.toContain('dailyTick');
    expect(some).toContain('settleReady');
  });

  it('treats an unconfigured kind as on, because all four were asked for', () => {
    const shop = shopFixture({ sealedThroughDate: null });
    expect(kindsOf([snapshot({ shop })], new Map())).toContain('monthEnded');
  });
});

describe('ordering and identity', () => {
  it('puts the most pressing first', () => {
    const shop = shopFixture({ sealedThroughDate: null });
    const reminders = deriveReminders({
      shops: [snapshot({ shop, configs: [salaryConfig(), foodConfig()] })],
      prefs: allOn,
      today: TODAY,
    });
    expect(reminders[0]?.kind).toBe('monthEnded');
    expect(reminders.at(-1)?.kind).toBe('dailyTick');
  });

  it('gives each reminder a stable id, so it is notified once', () => {
    const shop = shopFixture({ sealedThroughDate: null });
    const first = deriveReminders({ shops: [snapshot({ shop })], prefs: allOn, today: TODAY });
    const again = deriveReminders({ shops: [snapshot({ shop })], prefs: allOn, today: TODAY });
    expect(first.map((r) => r.id)).toEqual(again.map((r) => r.id));
    expect(new Set(first.map((r) => r.id)).size).toBe(first.length);
  });

  it('keeps two shops apart', () => {
    const a = snapshot({ shop: shopFixture({ id: 'shop_a', name: 'Alpha' }) });
    const b = snapshot({ shop: shopFixture({ id: 'shop_b', name: 'Beta' }) });
    const reminders = deriveReminders({ shops: [a, b], prefs: only('salaryDueSoon'), today: TODAY });
    expect(reminders).toHaveLength(2);
    expect(reminders.map((r) => r.shopName)).toEqual(['Alpha', 'Beta']);
  });
});

/* ========================================================================== */

describe('dueForNotification', () => {
  const shop = shopFixture({ sealedThroughDate: null });
  const reminders = deriveReminders({ shops: [snapshot({ shop })], prefs: allOn, today: TODAY });

  it('holds everything back until its hour', () => {
    // The list is always visible in the app; only the buzz waits for 8pm.
    expect(dueForNotification(reminders, allOn, 12 * 60)).toEqual([]);
    expect(dueForNotification(reminders, allOn, 20 * 60)).toHaveLength(reminders.length);
  });

  it('uses the time set for each kind', () => {
    const prefs: ReminderPrefs = new Map([
      ['monthEnded', { enabled: true, time: '09:00' }],
    ]);
    const atTen = dueForNotification(reminders, prefs, 10 * 60);
    expect(atTen.map((r) => r.kind)).toContain('monthEnded');
    expect(atTen.map((r) => r.kind)).not.toContain('settleReady');
  });
});
