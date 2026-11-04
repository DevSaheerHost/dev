import { describe, expect, it } from 'vitest';

import { asCalendarDate, type PeriodKey } from '@/lib/dates';
import { paise, sumPaise, type Paise } from '@/lib/money';
import type { DayRecord, IncomeConfig, IncomeFrequency, IncomeKind, Shop } from '@/types/models';

/** Day records: dates not worked, and dates a daily allowance was received. */
function dayMap(spec: { off?: string[]; got?: Record<string, string[]> } = {}) {
  const records = new Map<ReturnType<typeof date>, DayRecord>();
  const blank = (value: string): DayRecord => ({
    date: date(value),
    off: false,
    allowancesReceived: [],
    note: '',
    updatedAt: null,
  });
  for (const value of spec.off ?? []) records.set(date(value), { ...blank(value), off: true });
  for (const [value, ids] of Object.entries(spec.got ?? {})) {
    const existing = records.get(date(value)) ?? blank(value);
    records.set(date(value), { ...existing, allowancesReceived: ids });
  }
  return records as ReadonlyMap<ReturnType<typeof date>, DayRecord>;
}

import {
  accrualKeyFor,
  coverageInPeriod,
  describeProposal,
  proposeForPeriod,
  proposeOutstanding,
  totalProposed,
  type ProposalContext,
} from './accrual';

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

function configFixture(overrides: Partial<IncomeConfig> = {}): IncomeConfig {
  return {
    id: 'cfg_salary',
    kind: 'salary' as IncomeKind,
    label: 'Monthly salary',
    amount: rs(18000),
    frequency: 'monthly' as IncomeFrequency,
    effectiveFrom: date('2025-01-01'),
    effectiveTo: null,
    active: true,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

function contextFixture(overrides: Partial<ProposalContext> = {}): ProposalContext {
  return {
    shop: shopFixture(),
    configs: [configFixture()],
    existingAccrualKeys: new Set<string>(),
    days: new Map(),
    today: date('2025-12-01'),
    ...overrides,
  };
}

/* ========================================================================== */

describe('a full month', () => {
  it('proposes the whole amount once the month is over', () => {
    const [proposal, ...rest] = proposeForPeriod(contextFixture(), period('2025-11'));
    expect(rest).toHaveLength(0);
    expect(proposal).toMatchObject({
      amount: rs(18000),
      kind: 'salary_earned',
      period: '2025-11',
      transactionDate: '2025-11-30',
      coverageFrom: '2025-11-01',
      coverageTo: '2025-11-30',
      isPartial: false,
    });
  });

  it('writes under a deterministic id, so a retry is the same document', () => {
    const [proposal] = proposeForPeriod(contextFixture(), period('2025-11'));
    expect(proposal?.id).toBe('acc_cfg_salary_202511');
    expect(proposal?.accrualKey).toBe('cfg_salary:2025-11');
    expect(accrualKeyFor('cfg_salary', period('2025-11'))).toBe('cfg_salary:2025-11');
  });

  it('maps each income kind to its transaction kind', () => {
    const kinds: [IncomeKind, string][] = [
      ['salary', 'salary_earned'],
      ['allowance', 'allowance_earned'],
      ['other', 'other_income_earned'],
    ];
    for (const [incomeKind, transactionKind] of kinds) {
      const context = contextFixture({ configs: [configFixture({ kind: incomeKind })] });
      expect(proposeForPeriod(context, period('2025-11'))[0]?.kind).toBe(transactionKind);
    }
  });
});

/* ========================================================================== */

describe('nothing is proposed before it has been earned', () => {
  it('does not propose the current month partway through it', () => {
    // On 15 November only half the month has been worked. Proposing ₹18,000
    // now would need a correction later, which is how duplicates start.
    const context = contextFixture({ today: date('2025-11-15') });
    expect(proposeForPeriod(context, period('2025-11'))).toEqual([]);
  });

  it('does not propose on the last day either — the day is not over', () => {
    expect(proposeForPeriod(contextFixture({ today: date('2025-11-30') }), period('2025-11'))).toEqual([]);
  });

  it('proposes on the first day of the next month', () => {
    expect(proposeForPeriod(contextFixture({ today: date('2025-12-01') }), period('2025-11'))).toHaveLength(1);
  });

  it('ignores the salary pay day, which only drives the reminder', () => {
    const context = contextFixture({
      shop: shopFixture({ salaryPayDay: 5 }),
      today: date('2025-11-05'),
    });
    expect(proposeForPeriod(context, period('2025-11'))).toEqual([]);
  });
});

/* ========================================================================== */

describe('a month is never proposed twice', () => {
  it('skips a period whose accrual has already been posted', () => {
    const context = contextFixture({
      existingAccrualKeys: new Set(['cfg_salary:2025-11']),
    });
    expect(proposeForPeriod(context, period('2025-11'))).toEqual([]);
  });

  it('still proposes the other months', () => {
    const context = contextFixture({
      today: date('2025-12-01'),
      existingAccrualKeys: new Set(['cfg_salary:2025-11']),
    });
    const periods = proposeOutstanding(context).map((proposal) => proposal.period);
    expect(periods).toContain('2025-10');
    expect(periods).not.toContain('2025-11');
  });
});

/* ========================================================================== */

describe('partial months are pro-rated by calendar day', () => {
  it('pro-rates a mid-month start', () => {
    // Joined 21 November: 10 of November's 30 days.
    const context = contextFixture({
      shop: shopFixture({ joiningDate: date('2025-11-21'), openingBalanceAsOf: date('2025-11-21') }),
      configs: [configFixture({ effectiveFrom: date('2025-11-21') })],
    });
    const [proposal] = proposeForPeriod(context, period('2025-11'));
    expect(proposal).toMatchObject({
      amount: rs(6000),
      coverageFrom: '2025-11-21',
      coverageTo: '2025-11-30',
      prorationNum: 10,
      prorationDen: 30,
      isPartial: true,
    });
    expect(describeProposal(proposal!)).toBe('Monthly salary — 10 of 30 days');
  });

  it('pro-rates a mid-month leaving date', () => {
    const context = contextFixture({
      configs: [configFixture({ effectiveTo: date('2025-11-10') })],
    });
    const [proposal] = proposeForPeriod(context, period('2025-11'));
    // 18000 x 10/30
    expect(proposal?.amount).toBe(rs(6000));
    expect(proposal?.coverageTo).toBe('2025-11-10');
  });

  it('uses the real length of a short month, not an assumed 30', () => {
    const context = contextFixture({
      configs: [configFixture({ effectiveFrom: date('2025-02-15') })],
      today: date('2025-03-01'),
    });
    const [proposal] = proposeForPeriod(context, period('2025-02'));
    // 14 of February's 28 days is exactly half.
    expect(proposal).toMatchObject({ amount: rs(9000), prorationNum: 14, prorationDen: 28 });
  });

  it('handles a leap February', () => {
    const context = contextFixture({
      shop: shopFixture({ joiningDate: date('2024-01-01'), openingBalanceAsOf: date('2024-01-01') }),
      configs: [configFixture({ effectiveFrom: date('2024-02-01') })],
      today: date('2024-03-01'),
    });
    const [proposal] = proposeForPeriod(context, period('2024-02'));
    expect(proposal).toMatchObject({ amount: rs(18000), prorationDen: 29, isPartial: false });
  });

  it('rounds a pro-rata that does not divide evenly, once', () => {
    const context = contextFixture({
      configs: [configFixture({ amount: rs(10000), effectiveFrom: date('2025-11-30') })],
    });
    // 1 of 30 days: 1,000,000 paise / 30 = 33,333.33 -> 33,333
    expect(proposeForPeriod(context, period('2025-11'))[0]?.amount).toBe(33333);
  });
});

/* ========================================================================== */

describe('a mid-month raise', () => {
  it('splits the month across the old and new rate without overlap', () => {
    const context = contextFixture({
      configs: [
        configFixture({
          id: 'cfg_old',
          label: 'Salary (old rate)',
          amount: rs(18000),
          effectiveFrom: date('2025-01-01'),
          effectiveTo: date('2025-11-10'),
        }),
        configFixture({
          id: 'cfg_new',
          label: 'Salary (new rate)',
          amount: rs(21000),
          effectiveFrom: date('2025-11-11'),
        }),
      ],
    });

    const proposals = proposeForPeriod(context, period('2025-11'));
    expect(proposals).toHaveLength(2);

    // Each rate is pro-rated over its own share of the month's 30 days.
    expect(proposals[0]).toMatchObject({ amount: rs(6000), prorationNum: 10 }); // 18000 x 10/30
    expect(proposals[1]).toMatchObject({ amount: rs(14000), prorationNum: 20 }); // 21000 x 20/30
    expect(totalProposed(proposals)).toBe(rs(20000));

    // The two spans must tile the month exactly: no day counted twice, none missed.
    expect(proposals[0]?.coverageTo).toBe('2025-11-10');
    expect(proposals[1]?.coverageFrom).toBe('2025-11-11');
    expect((proposals[0]?.prorationNum ?? 0) + (proposals[1]?.prorationNum ?? 0)).toBe(30);
  });

  it('gives the two rates separate documents, so neither rewrites the other', () => {
    const context = contextFixture({
      configs: [
        configFixture({ id: 'cfg_old', effectiveTo: date('2025-11-10') }),
        configFixture({ id: 'cfg_new', effectiveFrom: date('2025-11-11') }),
      ],
    });
    const ids = proposeForPeriod(context, period('2025-11')).map((proposal) => proposal.id);
    expect(new Set(ids).size).toBe(2);
  });
});

/* ========================================================================== */

describe('frequencies other than monthly', () => {
  it('multiplies a daily rate by the days covered', () => {
    const context = contextFixture({
      configs: [configFixture({ frequency: 'daily', amount: rs(600), label: 'Daily food' })],
    });
    // 30 days of November.
    expect(proposeForPeriod(context, period('2025-11'))[0]?.amount).toBe(rs(18000));
  });

  it('scales a weekly rate by the days covered', () => {
    const context = contextFixture({
      configs: [configFixture({ frequency: 'weekly', amount: rs(700), label: 'Weekly allowance' })],
    });
    // 700 x 30/7 = 3000
    expect(proposeForPeriod(context, period('2025-11'))[0]?.amount).toBe(rs(3000));
  });

  it('posts a one-time amount only in the period it falls in', () => {
    const context = contextFixture({
      configs: [
        configFixture({
          frequency: 'oneTime',
          amount: rs(5000),
          label: 'Diwali bonus',
          effectiveFrom: date('2025-10-20'),
          effectiveTo: date('2025-10-20'),
        }),
      ],
    });
    expect(proposeForPeriod(context, period('2025-10'))[0]?.amount).toBe(rs(5000));
    expect(proposeForPeriod(context, period('2025-11'))).toEqual([]);
    expect(proposeForPeriod(context, period('2025-09'))).toEqual([]);
  });
});

/* ========================================================================== */

describe('what is excluded', () => {
  it('proposes nothing for a daily-wage shop', () => {
    // Nothing accrues there: an unpaid day is not a receivable.
    const context = contextFixture({ shop: shopFixture({ settlementMode: 'cashOnly' }) });
    expect(proposeForPeriod(context, period('2025-11'))).toEqual([]);
    expect(proposeOutstanding(context)).toEqual([]);
  });

  it('ignores a deactivated config', () => {
    const context = contextFixture({ configs: [configFixture({ active: false })] });
    expect(proposeForPeriod(context, period('2025-11'))).toEqual([]);
  });

  it('ignores a config that does not reach the period', () => {
    expect(
      proposeForPeriod(
        contextFixture({ configs: [configFixture({ effectiveFrom: date('2025-12-01') })] }),
        period('2025-11'),
      ),
    ).toEqual([]);
    expect(
      proposeForPeriod(
        contextFixture({ configs: [configFixture({ effectiveTo: date('2025-10-31') })] }),
        period('2025-11'),
      ),
    ).toEqual([]);
  });

  it('never accrues before the opening balance date', () => {
    // Anything earlier is already inside the opening figure; accruing it again
    // would count the same salary twice.
    const context = contextFixture({
      shop: shopFixture({
        joiningDate: date('2024-06-01'),
        openingBalanceAsOf: date('2025-11-16'),
        openingBalance: rs(12000),
      }),
      configs: [configFixture({ effectiveFrom: date('2024-06-01') })],
    });
    const [proposal] = proposeForPeriod(context, period('2025-11'));
    expect(proposal?.coverageFrom).toBe('2025-11-16');
    expect(proposal?.prorationNum).toBe(15);

    expect(proposeForPeriod(context, period('2025-10'))).toEqual([]);
  });

  it('never accrues before the joining date', () => {
    const context = contextFixture({
      shop: shopFixture({ joiningDate: date('2025-11-21'), openingBalanceAsOf: date('2025-01-01') }),
      configs: [configFixture({ effectiveFrom: date('2025-01-01') })],
    });
    expect(proposeForPeriod(context, period('2025-11'))[0]?.coverageFrom).toBe('2025-11-21');
  });

  it('skips a config whose covered amount rounds to nothing', () => {
    const context = contextFixture({
      configs: [configFixture({ amount: paise(0) })],
    });
    expect(proposeForPeriod(context, period('2025-11'))).toEqual([]);
  });
});

/* ========================================================================== */

describe('coverageInPeriod', () => {
  it('returns null when the config and period do not overlap', () => {
    expect(
      coverageInPeriod(shopFixture(), configFixture({ effectiveTo: date('2025-10-01') }), period('2025-11')),
    ).toBeNull();
  });

  it('clips to the tightest of every constraint', () => {
    const coverage = coverageInPeriod(
      shopFixture({ joiningDate: date('2025-11-05'), openingBalanceAsOf: date('2025-11-08') }),
      configFixture({ effectiveFrom: date('2025-11-03'), effectiveTo: date('2025-11-25') }),
      period('2025-11'),
    );
    expect(coverage).toEqual({ from: '2025-11-08', to: '2025-11-25' });
  });

  it('handles a single-day span', () => {
    expect(
      coverageInPeriod(
        shopFixture(),
        configFixture({ effectiveFrom: date('2025-11-15'), effectiveTo: date('2025-11-15') }),
        period('2025-11'),
      ),
    ).toEqual({ from: '2025-11-15', to: '2025-11-15' });
  });
});

/* ========================================================================== */

describe('proposeOutstanding', () => {
  it('offers every month missed since joining, oldest first', () => {
    const context = contextFixture({
      shop: shopFixture({ joiningDate: date('2025-07-10'), openingBalanceAsOf: date('2025-07-10') }),
      configs: [configFixture({ effectiveFrom: date('2025-07-10') })],
      today: date('2025-12-01'),
    });

    const proposals = proposeOutstanding(context);
    expect(proposals.map((proposal) => proposal.period)).toEqual([
      '2025-07',
      '2025-08',
      '2025-09',
      '2025-10',
      '2025-11',
    ]);
    // July is a part month (22 of 31 days); the rest are whole.
    expect(proposals[0]).toMatchObject({ isPartial: true, prorationNum: 22, prorationDen: 31 });
    expect(proposals.slice(1).every((proposal) => !proposal.isPartial)).toBe(true);
  });

  it('proposes nothing when everything is already posted', () => {
    const context = contextFixture({
      shop: shopFixture({ joiningDate: date('2025-10-01'), openingBalanceAsOf: date('2025-10-01') }),
      today: date('2025-12-01'),
      existingAccrualKeys: new Set(['cfg_salary:2025-10', 'cfg_salary:2025-11']),
    });
    expect(proposeOutstanding(context)).toEqual([]);
  });

  it('proposes nothing in the first, unfinished month', () => {
    const context = contextFixture({
      shop: shopFixture({ joiningDate: date('2025-11-01'), openingBalanceAsOf: date('2025-11-01') }),
      today: date('2025-11-20'),
    });
    expect(proposeOutstanding(context)).toEqual([]);
  });

  it('sums to what a year of full months should be worth', () => {
    const context = contextFixture({
      shop: shopFixture({ joiningDate: date('2025-01-01'), openingBalanceAsOf: date('2025-01-01') }),
      today: date('2026-01-01'),
    });
    const proposals = proposeOutstanding(context);
    expect(proposals).toHaveLength(12);
    expect(totalProposed(proposals)).toBe(rs(18000 * 12));
    expect(sumPaise(proposals.map((proposal) => proposal.amount))).toBe(rs(216000));
  });

  it('does not scan forever when the joining date is absurd', () => {
    const context = contextFixture({
      shop: shopFixture({ joiningDate: date('2000-01-01'), openingBalanceAsOf: date('2000-01-01') }),
      configs: [configFixture({ effectiveFrom: date('2000-01-01') })],
      today: date('2025-12-01'),
    });
    // Bounded by MAX_PERIODS_SCANNED rather than running to 300 months.
    expect(proposeOutstanding(context).length).toBeLessThanOrEqual(60);
  });
});

/* ========================================================================== */

describe('posted proposals reconcile with the engine', () => {
  it('a year of accruals plus payments leaves exactly what is unpaid', () => {
    const context = contextFixture({
      shop: shopFixture({ joiningDate: date('2025-01-01'), openingBalanceAsOf: date('2025-01-01') }),
      today: date('2026-01-01'),
    });
    const earned = totalProposed(proposeOutstanding(context));
    const paid = rs(18000 * 11); // every month paid except the last
    expect(paise(earned - paid)).toBe(rs(18000));
  });
});

/* ========================================================================== */
/* Attendance                                                                  */
/* ========================================================================== */

describe('days off reduce what is accrued', () => {
  it('pro-rates the month on the calendar, not on the days worked', () => {
    // Two days off in a 30-day November: 28/30 of 18,000, NOT a full month
    // spread across 28 days.
    const context = contextFixture({
      days: dayMap({ off: ['2025-11-09', '2025-11-23'] }),
    });
    const [proposal] = proposeForPeriod(context, period('2025-11'));
    expect(proposal).toMatchObject({
      amount: 1680000, // 18,000 x 28/30
      prorationNum: 28,
      prorationDen: 30,
      isPartial: true,
    });
  });

  it('is unchanged by absences in a different month', () => {
    const context = contextFixture({ days: dayMap({ off: ['2025-10-09', '2025-12-01'] }) });
    expect(proposeForPeriod(context, period('2025-11'))[0]?.amount).toBe(rs(18000));
  });

  it('ignores absences outside a config\u2019s own coverage', () => {
    const context = contextFixture({
      configs: [configFixture({ effectiveFrom: date('2025-11-21') })],
      days: dayMap({ off: ['2025-11-05'] }),
      shop: shopFixture({ joiningDate: date('2025-11-21'), openingBalanceAsOf: date('2025-11-21') }),
    });
    // The 5th is before this config starts, so it cannot reduce its 10 days.
    expect(proposeForPeriod(context, period('2025-11'))[0]).toMatchObject({
      prorationNum: 10,
      amount: rs(6000),
    });
  });

  it('proposes nothing for a month that was entirely off', () => {
    const allOff = Array.from({ length: 30 }, (_, index) =>
      `2025-11-${String(index + 1).padStart(2, '0')}`,
    );
    const context = contextFixture({ days: dayMap({ off: allOff }) });
    expect(proposeForPeriod(context, period('2025-11'))).toEqual([]);
  });

  it('reduces a daily rate by the days not worked', () => {
    const context = contextFixture({
      configs: [configFixture({ frequency: 'daily', amount: rs(600) })],
      days: dayMap({ off: ['2025-11-09', '2025-11-23'] }),
    });
    expect(proposeForPeriod(context, period('2025-11'))[0]?.amount).toBe(rs(600 * 28));
  });

  it('does not touch a one-time payment, which is not day-based', () => {
    const context = contextFixture({
      configs: [
        configFixture({
          frequency: 'oneTime',
          amount: rs(5000),
          effectiveFrom: date('2025-11-10'),
          effectiveTo: date('2025-11-10'),
        }),
      ],
      days: dayMap({ off: ['2025-11-09', '2025-11-23'] }),
    });
    expect(proposeForPeriod(context, period('2025-11'))[0]?.amount).toBe(rs(5000));
  });
});

/* ========================================================================== */
/* Food money: owed daily, settled by ticking                                  */
/* ========================================================================== */

describe('a daily allowance proposes both halves', () => {
  const food = () =>
    configFixture({
      id: 'inc_food',
      kind: 'allowance',
      label: 'Food money',
      amount: rs(100),
      frequency: 'daily',
    });

  it('proposes what was owed and what was actually handed over', () => {
    const context = contextFixture({
      configs: [food()],
      days: dayMap({
        got: {
          '2025-11-01': ['inc_food'],
          '2025-11-02': ['inc_food'],
          '2025-11-03': ['inc_food'],
        },
      }),
    });

    const proposals = proposeForPeriod(context, period('2025-11'));
    expect(proposals).toHaveLength(2);

    expect(proposals[0]).toMatchObject({
      settles: 'earned',
      kind: 'allowance_earned',
      amount: rs(3000), // 30 days at 100
      accrualKey: 'inc_food:2025-11',
    });
    expect(proposals[1]).toMatchObject({
      settles: 'received',
      kind: 'salary_payment_received',
      amount: rs(300), // only the 3 ticked days
      accrualKey: 'inc_food:2025-11:received',
      prorationNum: 3,
      prorationDen: 30,
    });

    // Net effect on the balance: 27 days of food money still outstanding.
    expect(proposals[0]!.amount - proposals[1]!.amount).toBe(rs(2700));
  });

  it('gives the two halves separate documents', () => {
    const context = contextFixture({
      configs: [food()],
      days: dayMap({ got: { '2025-11-01': ['inc_food'] } }),
    });
    const ids = proposeForPeriod(context, period('2025-11')).map((proposal) => proposal.id);
    expect(ids).toEqual(['acc_inc_food_202511', 'rcv_inc_food_202511']);
  });

  it('proposes only the earned half when nothing was handed over', () => {
    const context = contextFixture({ configs: [food()] });
    const proposals = proposeForPeriod(context, period('2025-11'));
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ settles: 'earned', amount: rs(3000) });
  });

  it('settles each half independently once posted', () => {
    const days = dayMap({ got: { '2025-11-01': ['inc_food'] } });

    const earnedPosted = proposeForPeriod(
      contextFixture({ configs: [food()], days, existingAccrualKeys: new Set(['inc_food:2025-11']) }),
      period('2025-11'),
    );
    expect(earnedPosted.map((proposal) => proposal.settles)).toEqual(['received']);

    const bothPosted = proposeForPeriod(
      contextFixture({
        configs: [food()],
        days,
        existingAccrualKeys: new Set(['inc_food:2025-11', 'inc_food:2025-11:received']),
      }),
      period('2025-11'),
    );
    expect(bothPosted).toEqual([]);
  });

  it('never counts food money for a day that was not worked', () => {
    const context = contextFixture({
      configs: [food()],
      days: dayMap({ off: ['2025-11-04'], got: { '2025-11-01': ['inc_food'] } }),
    });
    const proposals = proposeForPeriod(context, period('2025-11'));
    expect(proposals[0]?.amount).toBe(rs(2900)); // 29 worked days
    expect(proposals[1]?.amount).toBe(rs(100));
  });

  it('leaves a monthly allowance out of the daily settlement path', () => {
    const context = contextFixture({
      configs: [configFixture({ kind: 'allowance', frequency: 'monthly', amount: rs(1200) })],
    });
    const proposals = proposeForPeriod(context, period('2025-11'));
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ settles: 'earned', kind: 'allowance_earned' });
  });
});
