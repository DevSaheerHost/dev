import { describe, expect, it } from 'vitest';

import { asCalendarDate, type PeriodKey } from '@/lib/dates';
import { paise, type Paise } from '@/lib/money';
import type { Settlement, Shop, Transaction, TransactionKind } from '@/types/models';
import { TRANSACTION_KINDS } from '@/types/models';

import { runningBalance } from '../ledger/engine';
import { buildSnapshot } from '../ledger/settlement';
import { buildStatementDocument, statementTotals } from './statement';

const date = asCalendarDate;
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

let sequence = 0;
function txn(
  overrides: Partial<Transaction> & { kind: TransactionKind; amount: Paise },
): Transaction {
  sequence += 1;
  const id = overrides.id ?? `txn_${sequence}`;
  const transactionDate = overrides.transactionDate ?? date('2025-10-10');
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

function emptyTotals(): Record<TransactionKind, Paise> {
  const totals: Partial<Record<TransactionKind, Paise>> = {};
  for (const kind of TRANSACTION_KINDS) totals[kind] = paise(0);
  return totals as Record<TransactionKind, Paise>;
}

function settlementFixture(overrides: Partial<Settlement> = {}): Settlement {
  return {
    id: 'set_1',
    shopId: 'shop_1',
    periodStart: date('2025-10-01'),
    periodEnd: date('2025-10-31'),
    settlementDate: date('2025-11-01'),
    openingBalance: paise(0),
    closingBalance: rs(13640),
    totals: emptyTotals(),
    transactionCount: 3,
    statementNo: 1,
    sealState: 'sealed',
    status: 'sealed',
    notes: '',
    sealedAt: null,
    createdAt: null,
    ...overrides,
  };
}

/* ========================================================================== */

describe('buildStatementDocument', () => {
  const entries = [
    txn({
      kind: 'salary_earned',
      amount: rs(18000),
      transactionDate: date('2025-10-31'),
      description: 'October salary',
    }),
    txn({
      kind: 'advance_received',
      amount: rs(5000),
      transactionDate: date('2025-10-05'),
      description: 'Advance for rent',
    }),
    txn({
      kind: 'expense_paid',
      amount: rs(640),
      transactionDate: date('2025-10-12'),
      reimbursable: true,
      fundedFrom: 'own',
      description: 'Packing tape and twine',
    }),
  ];

  const snapshot = buildSnapshot({
    shop: shopFixture(),
    transactions: entries,
    from: date('2025-10-01'),
    to: date('2025-10-31'),
    statementNo: 1,
    settlementDate: date('2025-11-01'),
  });

  const statement = buildStatementDocument({
    settlement: settlementFixture({
      totals: snapshot.body.totals,
      closingBalance: snapshot.body.closingBalance,
    }),
    shop: shopFixture(),
    personName: 'Saheer',
    rows: snapshot.rows,
  });

  it('prints the figures the engine computed, not a second calculation', () => {
    expect(statement.closingBalance).toBe(snapshot.body.closingBalance);
    expect(statement.openingBalance).toBe(snapshot.body.openingBalance);
    const totals = statementTotals(statement);
    // 18,000 earned + 640 spent for the shop, less 5,000 taken as an advance.
    expect(totals.earned).toBe(rs(18640));
    expect(totals.reduced).toBe(rs(5000));
    expect(paise(statement.openingBalance + totals.earned - totals.reduced)).toBe(
      statement.closingBalance,
    );
  });

  it('separates what was added from what was taken', () => {
    expect(statement.earnings.map((line) => line.label)).toEqual([
      'Salary earned',
      'Expense paid',
    ]);
    expect(statement.reductions.map((line) => line.label)).toEqual(['Advance received']);
  });

  it('leaves out the kinds that did not occur', () => {
    const labels = [...statement.earnings, ...statement.reductions].map((line) => line.label);
    expect(labels).not.toContain('Deduction');
    expect(labels).not.toContain('Reimbursement received');
  });

  it('says what the closing balance means in words', () => {
    // A bare figure on a page handed to someone else is too easy to misread.
    expect(statement.closingSentence).toBe('Blue Mart owes you ₹13,640.00');
  });

  it('phrases a debt the other way round', () => {
    const owing = buildStatementDocument({
      settlement: settlementFixture({ closingBalance: rs(-450) }),
      shop: shopFixture(),
      personName: 'Saheer',
      rows: [],
    });
    expect(owing.closingSentence).toBe('You owe Blue Mart ₹450.00');
  });

  it('says so when nothing is outstanding', () => {
    const square = buildStatementDocument({
      settlement: settlementFixture({ closingBalance: paise(0) }),
      shop: shopFixture(),
      personName: 'Saheer',
      rows: [],
    });
    expect(square.closingSentence).toContain('Settled in full');
  });

  it('itemises every entry with a running balance ending at the closing figure', () => {
    expect(statement.rows).toHaveLength(3);
    expect(statement.rows.at(-1)?.balance).toBe(statement.closingBalance);
    expect(statement.rows[0]).toMatchObject({
      date: '5 Oct 2025',
      description: 'Advance for rent',
    });
  });

  it('falls back to the kind when an entry has no note', () => {
    const rows = runningBalance(paise(0), [txn({ kind: 'deduction', amount: rs(100) })]);
    const noNote = buildStatementDocument({
      settlement: settlementFixture(),
      shop: shopFixture(),
      personName: 'Saheer',
      rows,
    });
    expect(noNote.rows[0]?.description).toBe('Deduction');
  });

  it('puts a signed adjustment on whichever side it falls', () => {
    const positive = buildStatementDocument({
      settlement: settlementFixture({
        totals: { ...emptyTotals(), adjustment: rs(250) },
      }),
      shop: shopFixture(),
      personName: 'Saheer',
      rows: [],
    });
    expect(positive.earnings).toEqual([{ label: 'Adjustment', amount: rs(250) }]);
    expect(positive.reductions).toEqual([]);

    const negative = buildStatementDocument({
      settlement: settlementFixture({
        totals: { ...emptyTotals(), adjustment: paise(-25000) },
      }),
      shop: shopFixture(),
      personName: 'Saheer',
      rows: [],
    });
    // Shown as a positive figure in the reductions column, so neither column
    // ever contains a minus sign.
    expect(negative.reductions).toEqual([{ label: 'Adjustment', amount: rs(250) }]);
    expect(negative.earnings).toEqual([]);
  });

  it('carries the header details a reader needs', () => {
    expect(statement).toMatchObject({
      shopName: 'Blue Mart',
      personName: 'Saheer',
      statementNo: 1,
      periodLabel: '1 October 2025 to 31 October 2025',
      settlementDateLabel: '1 November 2025',
    });
  });

  it('notes entries that arrived after the statement was issued', () => {
    const disturbed = buildStatementDocument({
      settlement: settlementFixture(),
      shop: shopFixture(),
      personName: 'Saheer',
      rows: [],
      disturbedCount: 2,
    });
    expect(disturbed.disturbedNote).toContain('2 entries');
    expect(disturbed.disturbedNote).toContain('the figures here are unchanged');
    expect(statement.disturbedNote).toBeNull();
  });

  it('uses the singular for one late entry', () => {
    const one = buildStatementDocument({
      settlement: settlementFixture(),
      shop: shopFixture(),
      personName: 'Saheer',
      rows: [],
      disturbedCount: 1,
    });
    expect(one.disturbedNote).toContain('1 entry');
  });

  it('reprints an old statement from the stored snapshot, not from today', () => {
    // A statement agreed in October must still say what it said, even if the
    // entries behind it have since been voided or the engine has changed.
    const stored = settlementFixture({ closingBalance: rs(9999), totals: emptyTotals() });
    const reprint = buildStatementDocument({
      settlement: stored,
      shop: shopFixture(),
      personName: 'Saheer',
      rows: [],
    });
    expect(reprint.closingBalance).toBe(rs(9999));
  });
});

describe('statementTotals', () => {
  it('is zero for an empty statement', () => {
    const empty = buildStatementDocument({
      settlement: settlementFixture({ closingBalance: paise(0) }),
      shop: shopFixture(),
      personName: 'Saheer',
      rows: [],
    });
    expect(statementTotals(empty)).toEqual({ earned: 0, reduced: 0 });
  });
});
