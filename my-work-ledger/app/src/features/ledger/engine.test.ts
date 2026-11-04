import { describe, expect, it } from 'vitest';

import { asCalendarDate, type PeriodKey } from '@/lib/dates';
import { paise, type Paise } from '@/lib/money';
import type { Transaction, TransactionKind } from '@/types/models';

import {
  balanceAsOf,
  compareEntries,
  computeMonth,
  computePeriod,
  describeWarning,
  entriesForPeriod,
  findWarnings,
  isReceivableExpense,
  liveEntries,
  runningBalance,
  transactionEffect,
} from './engine';

const date = asCalendarDate;
const period = (value: string) => value as PeriodKey;

/** ₹ to paise, so the fixtures read like the amounts a shop would talk about. */
const rs = (rupees: number): Paise => paise(Math.round(rupees * 100));

let sequence = 0;

/**
 * A transaction fixture. Only the fields a test cares about are ever passed;
 * everything else gets a sane default so a new schema field does not require
 * touching every test.
 */
function txn(overrides: Partial<Transaction> & { kind: TransactionKind; amount: Paise }): Transaction {
  sequence += 1;
  const id = overrides.id ?? `txn_${String(sequence).padStart(4, '0')}`;
  const transactionDate = overrides.transactionDate ?? date('2025-11-10');
  const recognitionDate = overrides.recognitionDate ?? transactionDate;
  return {
    id,
    uid: 'uid_1',
    shopId: 'shop_1',
    direction: 'credit',
    category: '',
    description: '',
    periodKey: recognitionDate.slice(0, 7) as PeriodKey,
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
    recognitionDate,
  };
}

const ownExpense = (amount: Paise, extra: Partial<Transaction> = {}) =>
  txn({ kind: 'expense_paid', amount, reimbursable: true, fundedFrom: 'own', ...extra });

/* ========================================================================== */
/* The sign of each kind                                                       */
/* ========================================================================== */

describe('transactionEffect', () => {
  it('treats the three earning kinds as money the shop now owes you', () => {
    expect(transactionEffect(txn({ kind: 'salary_earned', amount: rs(18000) }))).toBe(1800000);
    expect(transactionEffect(txn({ kind: 'allowance_earned', amount: rs(1500) }))).toBe(150000);
    expect(transactionEffect(txn({ kind: 'other_income_earned', amount: rs(400) }))).toBe(40000);
  });

  it('never treats money received as an earning', () => {
    // The single most common way a hand-kept ledger goes wrong: an advance is
    // cash in your hand, so it REDUCES what is still owed to you.
    expect(transactionEffect(txn({ kind: 'advance_received', amount: rs(2000) }))).toBe(-200000);
    expect(transactionEffect(txn({ kind: 'salary_payment_received', amount: rs(10000) }))).toBe(-1000000);
    expect(transactionEffect(txn({ kind: 'reimbursement_received', amount: rs(200) }))).toBe(-20000);
  });

  it('treats a deduction as a reduction with no cash movement', () => {
    expect(transactionEffect(txn({ kind: 'deduction', amount: rs(500) }))).toBe(-50000);
  });

  it('uses the stored sign for an adjustment, in both directions', () => {
    expect(transactionEffect(txn({ kind: 'adjustment', amount: rs(250) }))).toBe(25000);
    expect(transactionEffect(txn({ kind: 'adjustment', amount: paise(-25000) }))).toBe(-25000);
  });

  it('counts an expense only when you funded it and it comes back', () => {
    expect(transactionEffect(ownExpense(rs(200)))).toBe(20000);

    // Non-reimbursable: a personal cost, recorded but not owed back.
    expect(
      transactionEffect(
        txn({ kind: 'expense_paid', amount: rs(200), reimbursable: false, fundedFrom: 'own' }),
      ),
    ).toBe(0);

    // Paid from the shop's own float: no money of yours left your pocket, so
    // the shop owes you nothing. Counting it would inflate the balance.
    expect(
      transactionEffect(
        txn({ kind: 'expense_paid', amount: rs(200), reimbursable: true, fundedFrom: 'shopFloat' }),
      ),
    ).toBe(0);
  });

  it('ignores a voided entry entirely', () => {
    expect(
      transactionEffect(txn({ kind: 'salary_earned', amount: rs(18000), voidedAt: 'sometime' })),
    ).toBe(0);
  });

  it('classifies receivable expenses consistently', () => {
    expect(isReceivableExpense(ownExpense(rs(10)))).toBe(true);
    expect(isReceivableExpense(txn({ kind: 'salary_earned', amount: rs(10) }))).toBe(false);
  });
});

/* ========================================================================== */
/* The scenarios from the brief                                                */
/* ========================================================================== */

describe('the scenarios this app exists to get right', () => {
  it('an advance is not an earning: it reduces what is outstanding', () => {
    const result = computePeriod(rs(0), [
      txn({ kind: 'salary_earned', amount: rs(18000) }),
      txn({ kind: 'advance_received', amount: rs(5000) }),
    ]);
    expect(result.closingBalance).toBe(rs(13000));
    expect(result.totals.advancesReceived).toBe(rs(5000));
    // It must not have landed in any earning bucket.
    expect(result.totals.salaryEarned).toBe(rs(18000));
    expect(result.totalEarned).toBe(rs(18000));
  });

  it('an expense and its reimbursement net to exactly zero', () => {
    const expense = ownExpense(rs(1200));
    const result = computePeriod(rs(0), [
      expense,
      txn({ kind: 'reimbursement_received', amount: rs(1200), settlesExpenseIds: [expense.id] }),
    ]);
    expect(result.closingBalance).toBe(rs(0));
    expect(result.totals.reimbursableExpenses).toBe(rs(1200));
    expect(result.totals.reimbursementsReceived).toBe(rs(1200));
  });

  it('an expense settled inside a salary payment is counted once, not twice', () => {
    // ₹10,000 salary plus a ₹200 expense, handed over as a single ₹10,200
    // payment. This is ONE payment entry, not a payment plus a reimbursement.
    const result = computePeriod(rs(0), [
      txn({ kind: 'salary_earned', amount: rs(10000) }),
      ownExpense(rs(200)),
      txn({ kind: 'salary_payment_received', amount: rs(10200) }),
    ]);
    expect(result.closingBalance).toBe(rs(0));
  });

  it('a deduction reduces the balance without any cash moving', () => {
    const result = computePeriod(rs(0), [
      txn({ kind: 'salary_earned', amount: rs(18000) }),
      txn({ kind: 'deduction', amount: rs(500), description: 'Broken crate' }),
      txn({ kind: 'salary_payment_received', amount: rs(17500) }),
    ]);
    expect(result.closingBalance).toBe(rs(0));
  });

  it('a negative balance means you owe the shop, and survives a period boundary', () => {
    const result = computePeriod(rs(0), [
      txn({ kind: 'salary_earned', amount: rs(5000) }),
      txn({ kind: 'advance_received', amount: rs(8000) }),
    ]);
    expect(result.closingBalance).toBe(rs(-3000));

    // Carried forward, not reset to zero.
    const next = computePeriod(result.closingBalance, [
      txn({ kind: 'salary_earned', amount: rs(5000) }),
    ]);
    expect(next.openingBalance).toBe(rs(-3000));
    expect(next.closingBalance).toBe(rs(2000));
  });

  it('a non-reimbursable expense is reported but never owed back', () => {
    const result = computePeriod(rs(0), [
      txn({ kind: 'salary_earned', amount: rs(18000) }),
      txn({ kind: 'expense_paid', amount: rs(300), reimbursable: false, fundedFrom: 'own' }),
    ]);
    expect(result.closingBalance).toBe(rs(18000));
    expect(result.totals.nonReimbursableExpenses).toBe(rs(300));
    expect(result.totals.reimbursableExpenses).toBe(rs(0));
  });

  it('a full month with every kind at once lands on the right figure', () => {
    const result = computePeriod(rs(1500), [
      txn({ kind: 'salary_earned', amount: rs(18000) }),
      txn({ kind: 'allowance_earned', amount: rs(1200) }),
      txn({ kind: 'other_income_earned', amount: rs(800) }),
      ownExpense(rs(640)),
      txn({ kind: 'expense_paid', amount: rs(100), reimbursable: false, fundedFrom: 'own' }),
      txn({ kind: 'expense_paid', amount: rs(90), reimbursable: true, fundedFrom: 'shopFloat' }),
      txn({ kind: 'advance_received', amount: rs(3000) }),
      txn({ kind: 'salary_payment_received', amount: rs(15000) }),
      txn({ kind: 'reimbursement_received', amount: rs(640) }),
      txn({ kind: 'deduction', amount: rs(260) }),
      txn({ kind: 'adjustment', amount: paise(-12050) }),
    ]);

    // earned:  18000 + 1200 + 800 + 640                      = 20,640
    // reduced: 3000 + 15000 + 640 + 260 + 120.50              = 19,020.50
    // closing: 1500 + 20640 - 19020.50                        =  3,119.50
    // The two expense entries that are not receivable (non-reimbursable, and
    // shop-funded) are reported but contribute nothing.
    expect(result.totalEarned).toBe(rs(20640));
    expect(result.totalReduced).toBe(rs(19020.5));
    expect(result.closingBalance).toBe(rs(3119.5));
    expect(result.entryCount).toBe(11);
  });

  it('keeps exact paise through a long run that floats would drift on', () => {
    // 0.07 is not representable in binary floating point; 300 of them summed
    // as rupees drifts. As paise it is exact.
    const entries = Array.from({ length: 300 }, () =>
      txn({ kind: 'other_income_earned', amount: paise(7) }),
    );
    expect(computePeriod(rs(0), entries).closingBalance).toBe(2100);
  });
});

/* ========================================================================== */
/* Period membership                                                           */
/* ========================================================================== */

describe('entriesForPeriod', () => {
  const entries = [
    txn({ kind: 'salary_earned', amount: rs(1), transactionDate: date('2025-10-31') }),
    txn({ kind: 'salary_earned', amount: rs(2), transactionDate: date('2025-11-01') }),
    txn({ kind: 'salary_earned', amount: rs(3), transactionDate: date('2025-11-30') }),
    txn({ kind: 'salary_earned', amount: rs(4), transactionDate: date('2025-12-01') }),
  ];

  it('includes both endpoints and nothing outside them', () => {
    const inNovember = entriesForPeriod(entries, date('2025-11-01'), date('2025-11-30'));
    expect(inNovember.map((entry) => entry.amount)).toEqual([rs(2), rs(3)]);
  });

  it('decides membership by recognition date, not by the true date', () => {
    // Dated into a sealed October, recognised on the first open day in November.
    const backdated = txn({
      kind: 'expense_paid',
      amount: rs(500),
      reimbursable: true,
      fundedFrom: 'own',
      transactionDate: date('2025-10-20'),
      recognitionDate: date('2025-11-01'),
      isPriorPeriodAdjustment: true,
      adjustsSettlementId: 'set_oct',
    });

    expect(entriesForPeriod([backdated], date('2025-10-01'), date('2025-10-31'))).toHaveLength(0);
    expect(entriesForPeriod([backdated], date('2025-11-01'), date('2025-11-30'))).toHaveLength(1);
  });

  it('drops voided entries', () => {
    const voided = txn({
      kind: 'salary_earned',
      amount: rs(9),
      transactionDate: date('2025-11-05'),
      voidedAt: 'sometime',
    });
    expect(entriesForPeriod([voided], date('2025-11-01'), date('2025-11-30'))).toHaveLength(0);
    expect(liveEntries([voided])).toHaveLength(0);
  });

  it('orders by sortKey, so an offline entry sits in the right place immediately', () => {
    const later = txn({ kind: 'salary_earned', amount: rs(1), transactionDate: date('2025-11-20') });
    const earlier = txn({ kind: 'salary_earned', amount: rs(2), transactionDate: date('2025-11-02') });
    const ordered = entriesForPeriod([later, earlier], date('2025-11-01'), date('2025-11-30'));
    expect(ordered.map((entry) => entry.transactionDate)).toEqual(['2025-11-02', '2025-11-20']);
    expect(compareEntries(earlier, later)).toBe(-1);
    expect(compareEntries(earlier, earlier)).toBe(0);
  });
});

describe('computeMonth', () => {
  it('slices a calendar month, short months included', () => {
    const entries = [
      txn({ kind: 'salary_earned', amount: rs(100), transactionDate: date('2025-02-28') }),
      txn({ kind: 'salary_earned', amount: rs(200), transactionDate: date('2025-03-01') }),
    ];
    expect(computeMonth(rs(0), entries, period('2025-02')).closingBalance).toBe(rs(100));
    expect(computeMonth(rs(0), entries, period('2025-03')).closingBalance).toBe(rs(200));
  });

  it('reports the prior-period adjustments it absorbed', () => {
    const result = computeMonth(
      rs(0),
      [
        txn({ kind: 'salary_earned', amount: rs(100), transactionDate: date('2025-11-05') }),
        txn({
          kind: 'adjustment',
          amount: rs(50),
          transactionDate: date('2025-10-20'),
          recognitionDate: date('2025-11-01'),
          isPriorPeriodAdjustment: true,
        }),
      ],
      period('2025-11'),
    );
    expect(result.closingBalance).toBe(rs(150));
    expect(result.priorPeriodAdjustments).toHaveLength(1);
  });
});

/* ========================================================================== */
/* Current balance and running totals                                          */
/* ========================================================================== */

describe('balanceAsOf', () => {
  const entries = [
    txn({ kind: 'salary_earned', amount: rs(18000), transactionDate: date('2025-11-01') }),
    txn({ kind: 'advance_received', amount: rs(5000), transactionDate: date('2025-11-15') }),
    txn({ kind: 'salary_earned', amount: rs(18000), transactionDate: date('2025-12-01') }),
  ];

  it('counts everything up to and including the given day', () => {
    expect(balanceAsOf(rs(0), entries, date('2025-10-31'))).toBe(rs(0));
    expect(balanceAsOf(rs(0), entries, date('2025-11-01'))).toBe(rs(18000));
    expect(balanceAsOf(rs(0), entries, date('2025-11-14'))).toBe(rs(18000));
    expect(balanceAsOf(rs(0), entries, date('2025-11-15'))).toBe(rs(13000));
  });

  it('excludes entries dated in the future', () => {
    // December's salary is not money owed on 20 November.
    expect(balanceAsOf(rs(0), entries, date('2025-11-20'))).toBe(rs(13000));
    expect(balanceAsOf(rs(0), entries, date('2025-12-01'))).toBe(rs(31000));
  });

  it('counts a backdated entry from its true date, not its recognition date', () => {
    // The dashboard answers "what is outstanding now", which depends on what
    // actually happened — not on which statement the entry was filed under.
    const backdated = txn({
      kind: 'advance_received',
      amount: rs(1000),
      transactionDate: date('2025-10-20'),
      recognitionDate: date('2025-11-01'),
      isPriorPeriodAdjustment: true,
    });
    expect(balanceAsOf(rs(0), [backdated], date('2025-10-25'))).toBe(rs(-1000));
  });

  it('starts from the opening balance', () => {
    expect(balanceAsOf(rs(450), [], date('2025-11-20'))).toBe(rs(450));
  });
});

describe('runningBalance', () => {
  it('produces a statement that ends on the computed closing balance', () => {
    const entries = [
      txn({ kind: 'salary_earned', amount: rs(18000), transactionDate: date('2025-11-01') }),
      txn({ kind: 'advance_received', amount: rs(5000), transactionDate: date('2025-11-10') }),
      ownExpense(rs(640), { transactionDate: date('2025-11-12') }),
    ];
    const rows = runningBalance(rs(1000), entries);
    expect(rows.map((row) => row.balanceAfter)).toEqual([rs(19000), rs(14000), rs(14640)]);
    expect(rows.at(-1)?.balanceAfter).toBe(computePeriod(rs(1000), entries).closingBalance);
  });

  it('skips voided entries without leaving a gap in the running total', () => {
    const rows = runningBalance(rs(0), [
      txn({ kind: 'salary_earned', amount: rs(100), transactionDate: date('2025-11-01') }),
      txn({
        kind: 'salary_earned',
        amount: rs(999),
        transactionDate: date('2025-11-02'),
        voidedAt: 'sometime',
      }),
      txn({ kind: 'salary_earned', amount: rs(100), transactionDate: date('2025-11-03') }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.at(-1)?.balanceAfter).toBe(rs(200));
  });
});

/* ========================================================================== */
/* Integrity warnings                                                          */
/* ========================================================================== */

describe('findWarnings', () => {
  it('says nothing when the ledger is consistent', () => {
    const expense = ownExpense(rs(500));
    expect(
      findWarnings([expense, txn({ kind: 'reimbursement_received', amount: rs(500) })]),
    ).toEqual([]);
  });

  it('flags being reimbursed more than was ever spent', () => {
    const warnings = findWarnings([
      ownExpense(rs(500)),
      txn({ kind: 'reimbursement_received', amount: rs(800) }),
    ]);
    expect(warnings).toEqual([{ code: 'reimbursement_exceeds_expenses', excess: rs(300) }]);
    expect(describeWarning(warnings[0]!)).toContain('deduction');
  });

  it('does not count a shop-funded expense towards what can be reimbursed', () => {
    const warnings = findWarnings([
      txn({ kind: 'expense_paid', amount: rs(500), reimbursable: true, fundedFrom: 'shopFloat' }),
      txn({ kind: 'reimbursement_received', amount: rs(500) }),
    ]);
    expect(warnings[0]?.code).toBe('reimbursement_exceeds_expenses');
  });

  it('flags a deduction recovering an advance, which double-counts', () => {
    const advance = txn({ kind: 'advance_received', amount: rs(2000) });
    const warnings = findWarnings([
      advance,
      txn({ kind: 'deduction', amount: rs(2000), recoversTransactionId: advance.id }),
    ]);
    expect(warnings).toEqual([{ code: 'deduction_against_advance', transactionId: expect.any(String) }]);
  });

  it('allows a deduction recovering an expense, which does not', () => {
    const expense = ownExpense(rs(300));
    expect(
      findWarnings([
        expense,
        txn({ kind: 'deduction', amount: rs(300), recoversTransactionId: expense.id }),
      ]),
    ).toEqual([]);
  });

  it('flags the same accrual posted twice', () => {
    const warnings = findWarnings([
      txn({ kind: 'salary_earned', amount: rs(18000), accrualKey: 'cfg_a:2025-11' }),
      txn({ kind: 'salary_earned', amount: rs(18000), accrualKey: 'cfg_a:2025-11' }),
    ]);
    expect(warnings).toEqual([{ code: 'duplicate_accrual', accrualKey: 'cfg_a:2025-11' }]);
  });

  it('ignores a voided duplicate, which is the normal way one gets fixed', () => {
    expect(
      findWarnings([
        txn({ kind: 'salary_earned', amount: rs(18000), accrualKey: 'cfg_a:2025-11' }),
        txn({
          kind: 'salary_earned',
          amount: rs(18000),
          accrualKey: 'cfg_a:2025-11',
          voidedAt: 'sometime',
        }),
      ]),
    ).toEqual([]);
  });
});

/* ========================================================================== */
/* Empty and degenerate input                                                  */
/* ========================================================================== */

describe('degenerate input', () => {
  it('an empty period carries the opening balance through unchanged', () => {
    const result = computePeriod(rs(450), []);
    expect(result.closingBalance).toBe(rs(450));
    expect(result.totalEarned).toBe(rs(0));
    expect(result.totalReduced).toBe(rs(0));
    expect(result.entryCount).toBe(0);
  });

  it('a period of only voided entries is the same as an empty one', () => {
    const result = computePeriod(rs(450), [
      txn({ kind: 'salary_earned', amount: rs(18000), voidedAt: 'sometime' }),
    ]);
    expect(result.closingBalance).toBe(rs(450));
    expect(result.entryCount).toBe(0);
  });
});
