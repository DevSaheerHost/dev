import { describe, expect, it } from 'vitest';

import { asCalendarDate, type PeriodKey } from '@/lib/dates';
import { paise, type Paise } from '@/lib/money';
import type { DayRecord, IncomeConfig, Shop, Transaction, TransactionKind } from '@/types/models';

import { balanceAsOf } from './engine';
import { combineFigures, computeShopFigures, postedAccrualKeys } from './figures';

const date = asCalendarDate;
const rs = (rupees: number): Paise => paise(Math.round(rupees * 100));

function shopFixture(overrides: Partial<Shop> = {}): Shop {
  return {
    id: 'shop_1',
    name: 'Blue Mart',
    description: '',
    phone: null,
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

let sequence = 0;
function txn(
  overrides: Partial<Transaction> & { kind: TransactionKind; amount: Paise },
): Transaction {
  sequence += 1;
  const id = overrides.id ?? `txn_${sequence}`;
  const transactionDate = overrides.transactionDate ?? date('2025-11-10');
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

const noDays: DayRecord[] = [];

/* ========================================================================== */

describe('computeShopFigures', () => {
  // Joined at the start of November, so there is no backlog of unconfirmed
  // months behind the figure under test. A shop with a real backlog is covered
  // separately below, because that backlog genuinely is money owed.
  const base = {
    shop: shopFixture({
      joiningDate: date('2025-11-01'),
      openingBalanceAsOf: date('2025-11-01'),
    }),
    transactions: [] as Transaction[],
    configs: [salaryConfig({ effectiveFrom: date('2025-11-01') })],
    days: noDays,
  };

  it('climbs daily before anything has been posted', () => {
    const day10 = computeShopFigures({ ...base, today: date('2025-11-10') });
    const day20 = computeShopFigures({ ...base, today: date('2025-11-20') });

    expect(day10.postedBalance).toBe(rs(0));
    expect(day10.unposted).toBe(rs(10000 / 3)); // 10/30 of 10,000
    expect(day10.balance).toBe(day10.unposted);
    expect(day20.balance).toBeGreaterThan(day10.balance);
  });

  it('counts an advance against the earned-so-far figure', () => {
    const figures = computeShopFigures({
      ...base,
      transactions: [
        txn({ kind: 'advance_received', amount: rs(2000), transactionDate: date('2025-11-05') }),
      ],
      today: date('2025-11-10'),
    });
    // 3,333.33 earned so far, minus the 2,000 already taken.
    expect(figures.postedBalance).toBe(rs(-2000));
    expect(figures.balance).toBe(133333);
  });

  it('does not count a posted month twice', () => {
    // The whole point of keying on the accrual: once November is a real entry,
    // the live estimate for it must stop being added.
    // November is finished but unconfirmed, so it counts as a proposal; plus
    // one day of December. The balance must not lurch when the month turns.
    const withoutPosting = computeShopFigures({ ...base, today: date('2025-12-01') });
    expect(withoutPosting.postedBalance).toBe(rs(0));
    expect(withoutPosting.unposted).toBe(rs(10000) + 32258);
    expect(withoutPosting.balance).toBe(rs(10000) + 32258);

    const posted = computeShopFigures({
      ...base,
      transactions: [
        txn({
          kind: 'salary_earned',
          amount: rs(10000),
          transactionDate: date('2025-11-30'),
          accrualKey: 'inc_salary:2025-11',
        }),
      ],
      today: date('2025-12-01'),
    });
    expect(posted.postedBalance).toBe(rs(10000));
    expect(posted.unposted).toBe(32258); // 1/31 of December only
    expect(posted.balance).toBe(rs(10000) + 32258);
  });

  it('does not lurch when the month turns', () => {
    // The balance on the last evening of November and on the first morning of
    // December must differ only by the one day earned, not by a whole month
    // flickering out of the live figure before it becomes an entry.
    const lastDay = computeShopFigures({ ...base, today: date('2025-11-30') });
    const nextDay = computeShopFigures({ ...base, today: date('2025-12-01') });

    expect(lastDay.balance).toBe(rs(10000));
    expect(nextDay.balance).toBe(rs(10000) + 32258);
    expect(nextDay.balance).toBeGreaterThan(lastDay.balance);
  });

  it('counts several unconfirmed months at once', () => {
    const figures = computeShopFigures({
      ...base,
      shop: shopFixture({
        joiningDate: date('2025-09-01'),
        openingBalanceAsOf: date('2025-09-01'),
      }),
      configs: [salaryConfig({ effectiveFrom: date('2025-09-01') })],
      today: date('2025-12-01'),
    });
    // September, October and November earned but unconfirmed, plus one day of
    // December.
    expect(figures.unposted).toBe(rs(30000) + 32258);
    expect(figures.proposals).toHaveLength(3);
  });

  it('subtracts food money already handed over from the unconfirmed total', () => {
    const food: IncomeConfig = salaryConfig({
      id: 'inc_food',
      kind: 'allowance',
      label: 'Food money',
      amount: rs(100),
      frequency: 'daily',
    });
    const days: DayRecord[] = ['2025-11-01', '2025-11-02'].map((value) => ({
      date: date(value),
      off: false,
      allowancesReceived: ['inc_food'],
      note: '',
      updatedAt: null,
    }));

    const figures = computeShopFigures({
      ...base,
      configs: [food],
      days,
      today: date('2025-12-01'),
    });
    // 30 days owed at 100, less the 2 days actually received, plus 1 day of
    // December.
    expect(figures.unposted).toBe(rs(3000) - rs(200) + rs(100));
  });

  it('matches the engine exactly when nothing is accruing', () => {
    // The exit test for this phase: the figure on the dashboard is the figure
    // the engine computes, not a parallel calculation that can drift.
    const transactions = [
      txn({ kind: 'salary_earned', amount: rs(10000), transactionDate: date('2025-11-01') }),
      txn({ kind: 'advance_received', amount: rs(3000), transactionDate: date('2025-11-05') }),
      txn({
        kind: 'expense_paid',
        amount: rs(450),
        transactionDate: date('2025-11-06'),
        reimbursable: true,
        fundedFrom: 'own',
      }),
    ];
    const today = date('2025-11-10');
    const figures = computeShopFigures({
      ...base,
      configs: [], // nothing accruing, so posted is the whole story
      transactions,
      today,
    });

    expect(figures.unposted).toBe(rs(0));
    expect(figures.balance).toBe(balanceAsOf(paise(0), transactions, today));
    expect(figures.balance).toBe(rs(7450));
  });

  it('starts from the shop opening balance', () => {
    const figures = computeShopFigures({
      ...base,
      shop: shopFixture({
        openingBalance: rs(4500),
        joiningDate: date('2025-11-01'),
        openingBalanceAsOf: date('2025-11-01'),
      }),
      configs: [],
      today: date('2025-11-10'),
    });
    expect(figures.balance).toBe(rs(4500));
  });

  it('reads as a debt when you have taken more than you have earned', () => {
    const figures = computeShopFigures({
      ...base,
      configs: [],
      transactions: [
        txn({ kind: 'advance_received', amount: rs(2000), transactionDate: date('2025-11-05') }),
      ],
      today: date('2025-11-10'),
    });
    expect(figures.balance).toBe(rs(-2000));
  });

  it('drops the earned figure when days are marked off', () => {
    const days: DayRecord[] = [
      { date: date('2025-11-03'), off: true, allowancesReceived: [], note: '', updatedAt: null },
      { date: date('2025-11-04'), off: true, allowancesReceived: [], note: '', updatedAt: null },
    ];
    const present = computeShopFigures({ ...base, today: date('2025-11-10') });
    const absent = computeShopFigures({ ...base, days, today: date('2025-11-10') });
    expect(absent.balance).toBeLessThan(present.balance);
    expect(absent.position.elapsed.worked).toBe(8);
  });

  it('offers the months that still need confirming', () => {
    const figures = computeShopFigures({
      ...base,
      shop: shopFixture({
        joiningDate: date('2025-09-01'),
        openingBalanceAsOf: date('2025-09-01'),
      }),
      configs: [salaryConfig({ effectiveFrom: date('2025-09-01') })],
      today: date('2025-12-01'),
    });
    expect(figures.proposals.map((proposal) => proposal.period)).toEqual([
      '2025-09',
      '2025-10',
      '2025-11',
    ]);
  });

  it('stops offering a month once it is posted', () => {
    const figures = computeShopFigures({
      ...base,
      transactions: [
        txn({
          kind: 'salary_earned',
          amount: rs(10000),
          transactionDate: date('2025-11-30'),
          accrualKey: 'inc_salary:2025-11',
        }),
      ],
      today: date('2025-12-01'),
    });
    expect(figures.proposals.map((proposal) => proposal.period)).not.toContain('2025-11');
  });

  it('shows a past month without changing what is owed today', () => {
    const transactions = [
      txn({ kind: 'advance_received', amount: rs(1000), transactionDate: date('2025-10-15') }),
    ];
    const today = date('2025-11-10');
    const current = computeShopFigures({ ...base, transactions, today });
    const october = computeShopFigures({
      ...base,
      transactions,
      today,
      period: '2025-10' as PeriodKey,
    });

    expect(october.balance).toBe(current.balance);
    expect(october.month.totals.advancesReceived).toBe(rs(1000));
    expect(current.month.totals.advancesReceived).toBe(rs(0));
  });

  it('surfaces an inconsistency rather than silently correcting it', () => {
    const figures = computeShopFigures({
      ...base,
      transactions: [
        txn({ kind: 'reimbursement_received', amount: rs(900), transactionDate: date('2025-11-02') }),
      ],
      today: date('2025-11-10'),
    });
    expect(figures.warnings[0]?.code).toBe('reimbursement_exceeds_expenses');
  });

  it('reports the day of the most recent entry, for the shop list', () => {
    const figures = computeShopFigures({
      ...base,
      transactions: [
        txn({ kind: 'expense_paid', amount: rs(100), transactionDate: date('2025-11-02') }),
        txn({ kind: 'expense_paid', amount: rs(100), transactionDate: date('2025-11-09') }),
        txn({ kind: 'expense_paid', amount: rs(100), transactionDate: date('2025-11-05') }),
      ],
      today: date('2025-11-10'),
    });
    expect(figures.lastActivity).toBe('2025-11-09');
  });

  it('has no last activity for a shop with no entries', () => {
    expect(computeShopFigures({ ...base, today: date('2025-11-10') }).lastActivity).toBeNull();
  });

  it('ignores a voided entry when saying when the shop was last touched', () => {
    const figures = computeShopFigures({
      ...base,
      transactions: [
        txn({ kind: 'expense_paid', amount: rs(100), transactionDate: date('2025-11-02') }),
        txn({
          kind: 'expense_paid',
          amount: rs(100),
          transactionDate: date('2025-11-09'),
          voidedAt: 'voided',
        }),
      ],
      today: date('2025-11-10'),
    });
    expect(figures.lastActivity).toBe('2025-11-02');
  });

  it('accrues nothing at a daily-wage shop', () => {
    const figures = computeShopFigures({
      ...base,
      shop: shopFixture({
        settlementMode: 'cashOnly',
        joiningDate: date('2025-11-01'),
        openingBalanceAsOf: date('2025-11-01'),
      }),
      today: date('2025-11-10'),
    });
    expect(figures.unposted).toBe(rs(0));
    expect(figures.proposals).toEqual([]);
  });
});

/* ========================================================================== */

describe('postedAccrualKeys', () => {
  it('collects the keys of live accruals only', () => {
    const keys = postedAccrualKeys([
      txn({ kind: 'salary_earned', amount: rs(1), accrualKey: 'a:2025-11' }),
      txn({ kind: 'salary_earned', amount: rs(1), accrualKey: 'b:2025-11', voidedAt: 'gone' }),
      txn({ kind: 'advance_received', amount: rs(1) }),
    ]);
    // A voided accrual frees its month to be posted again, which is how a
    // wrongly confirmed month gets corrected.
    expect([...keys]).toEqual(['a:2025-11']);
  });
});

describe('combineFigures', () => {
  const figuresFor = (balance: Paise, unposted = paise(0)) =>
    ({ balance, unposted }) as ReturnType<typeof computeShopFigures>;

  it('separates what you are owed from what you owe', () => {
    const combined = combineFigures([
      figuresFor(rs(4500)),
      figuresFor(rs(-450)),
      figuresFor(rs(1200)),
    ]);
    expect(combined.owedToYou).toBe(rs(5700));
    expect(combined.owedByYou).toBe(rs(450));
    expect(combined.net).toBe(rs(5250));
  });

  it('adds up what is still unconfirmed', () => {
    const combined = combineFigures([figuresFor(rs(100), rs(60)), figuresFor(rs(200), rs(40))]);
    expect(combined.unposted).toBe(rs(100));
  });

  it('is all zeroes with no shops', () => {
    expect(combineFigures([])).toEqual({
      owedToYou: 0,
      owedByYou: 0,
      net: 0,
      unposted: 0,
    });
  });
});
