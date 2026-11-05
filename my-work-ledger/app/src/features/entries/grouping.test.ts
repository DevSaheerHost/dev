import { describe, expect, it } from 'vitest';

import { asCalendarDate, type PeriodKey } from '@/lib/dates';
import { paise, type Paise } from '@/lib/money';
import type { Transaction, TransactionKind } from '@/types/models';

import { runningBalance } from '@/features/ledger/engine';

import { groupEntriesByDay, groupTotals, sideOf } from './grouping';

const date = asCalendarDate;
const rs = (rupees: number): Paise => paise(Math.round(rupees * 100));

let sequence = 0;

function txn(
  overrides: Partial<Transaction> & { kind: TransactionKind; amount: Paise },
): Transaction {
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

describe('sideOf', () => {
  it('puts anything that increases what you are owed on the credit side', () => {
    const rows = runningBalance(paise(0), [txn({ kind: 'salary_earned', amount: rs(10_000) })]);
    expect(sideOf(rows[0]!)).toBe('credit');
  });

  it('puts money you received on the debit side', () => {
    const rows = runningBalance(paise(0), [
      txn({ kind: 'salary_payment_received', amount: rs(5_000) }),
    ]);
    expect(sideOf(rows[0]!)).toBe('debit');
  });

  it('puts an expense that is not owed back in neither column', () => {
    const rows = runningBalance(paise(0), [
      txn({ kind: 'expense_paid', amount: rs(200), reimbursable: false, fundedFrom: 'own' }),
    ]);
    expect(sideOf(rows[0]!)).toBe('none');
  });
});

describe('groupEntriesByDay', () => {
  const entries = [
    txn({ kind: 'salary_earned', amount: rs(10_000), transactionDate: date('2025-11-01') }),
    txn({
      kind: 'expense_paid',
      amount: rs(300),
      reimbursable: true,
      fundedFrom: 'own',
      transactionDate: date('2025-11-05'),
    }),
    txn({
      kind: 'advance_received',
      amount: rs(2_000),
      transactionDate: date('2025-11-05'),
    }),
    txn({
      kind: 'salary_payment_received',
      amount: rs(8_000),
      transactionDate: date('2025-11-09'),
    }),
  ];
  const rows = runningBalance(rs(500), entries);

  it('groups by the day the entry happened, newest day first', () => {
    const groups = groupEntriesByDay(rows, 'newest');
    expect(groups.map((group) => group.date)).toEqual([
      '2025-11-09',
      '2025-11-05',
      '2025-11-01',
    ]);
  });

  it('can be read oldest first instead', () => {
    const groups = groupEntriesByDay(rows, 'oldest');
    expect(groups.map((group) => group.date)).toEqual([
      '2025-11-01',
      '2025-11-05',
      '2025-11-09',
    ]);
  });

  it('totals each day into the two columns', () => {
    const groups = groupEntriesByDay(rows, 'oldest');
    expect(groups[1]?.credit).toBe(rs(300));
    expect(groups[1]?.debit).toBe(rs(2_000));
  });

  it('closes a day on the balance after its last entry in ledger order', () => {
    const groups = groupEntriesByDay(rows, 'oldest');
    // 500 opening + 10,000 salary
    expect(groups[0]?.closing).toBe(rs(10_500));
    // + 300 expense - 2,000 advance
    expect(groups[1]?.closing).toBe(rs(8_800));
    // - 8,000 paid
    expect(groups[2]?.closing).toBe(rs(800));
  });

  it('keeps each row on the balance it had in ledger order, whatever the display order', () => {
    const newest = groupEntriesByDay(rows, 'newest');
    const oldest = groupEntriesByDay(rows, 'oldest');
    const byId = (groups: ReturnType<typeof groupEntriesByDay>) =>
      new Map(
        groups.flatMap((group) => group.rows.map((row) => [row.transaction.id, row.balanceAfter])),
      );
    expect(byId(newest)).toEqual(byId(oldest));
  });

  it('reverses the entries inside a day when read newest first', () => {
    const newest = groupEntriesByDay(rows, 'newest');
    const day = newest.find((group) => group.date === '2025-11-05');
    expect(day?.rows.map((row) => row.transaction.kind)).toEqual([
      'advance_received',
      'expense_paid',
    ]);
  });

  it('has nothing to group when there are no entries', () => {
    expect(groupEntriesByDay([])).toEqual([]);
    expect(groupTotals([])).toEqual({ credit: paise(0), debit: paise(0) });
  });

  it('adds the column totals across every day', () => {
    const totals = groupTotals(groupEntriesByDay(rows));
    expect(totals.credit).toBe(rs(10_300));
    expect(totals.debit).toBe(rs(10_000));
  });

  it('leaves an entry that moves nothing out of both totals', () => {
    const nonReimbursable = runningBalance(paise(0), [
      txn({ kind: 'expense_paid', amount: rs(200), reimbursable: false, fundedFrom: 'own' }),
    ]);
    const totals = groupTotals(groupEntriesByDay(nonReimbursable));
    expect(totals).toEqual({ credit: paise(0), debit: paise(0) });
  });
});
