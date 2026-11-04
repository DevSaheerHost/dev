import { describe, expect, it } from 'vitest';

import { computePeriod, transactionEffect } from '@/features/ledger/engine';
import { paise } from '@/lib/money';

import { transactionFromDoc } from './transactions';

/**
 * These cover the defensive read, not the write path.
 *
 * A single `NaN` anywhere in a ledger turns every total on the screen into
 * `NaN` — the dashboard, the month, the statement, all of it. A document can
 * arrive malformed from a restored backup, a half-finished migration or a
 * hand-edited console entry, so the reader has to make that impossible rather
 * than assume the stored shape.
 */

const wellFormed = {
  uid: 'uid_1',
  shopId: 'shop_1',
  kind: 'expense_paid',
  amount: 25000,
  direction: 'credit',
  category: 'stock',
  description: 'Packing tape',
  transactionDate: '2025-11-04',
  recognitionDate: '2025-11-04',
  periodKey: '2025-11',
  sortKey: '2025-11-04#001763000000000#txn_a',
  clientCreatedAtMs: 1_763_000_000_000,
  reimbursable: true,
  fundedFrom: 'own',
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
};

describe('transactionFromDoc', () => {
  it('reads a well-formed document unchanged', () => {
    const transaction = transactionFromDoc('txn_a', wellFormed);
    expect(transaction).toMatchObject({
      id: 'txn_a',
      kind: 'expense_paid',
      amount: 25000,
      reimbursable: true,
      fundedFrom: 'own',
      transactionDate: '2025-11-04',
      periodKey: '2025-11',
    });
    expect(transactionEffect(transaction)).toBe(25000);
  });

  it('never produces NaN from a broken amount', () => {
    for (const amount of [undefined, null, 'lots', Number.NaN, Number.POSITIVE_INFINITY, 1.5, 1e30]) {
      const transaction = transactionFromDoc('txn_a', { ...wellFormed, amount });
      expect(Number.isInteger(transaction.amount)).toBe(true);
      expect(transaction.amount).toBe(0);
    }
  });

  it('keeps one bad document from poisoning a whole period', () => {
    const good = transactionFromDoc('txn_good', { ...wellFormed, amount: 10000 });
    const bad = transactionFromDoc('txn_bad', { ...wellFormed, amount: 'oops' });
    const result = computePeriod(paise(0), [good, bad]);
    expect(result.closingBalance).toBe(10000);
    expect(Number.isNaN(result.closingBalance)).toBe(false);
  });

  it('falls back to a safe kind rather than crashing on an unknown one', () => {
    // 'adjustment' with the stored amount is the least surprising fallback: it
    // is the only kind whose sign comes from the data, so nothing is invented.
    expect(transactionFromDoc('txn_a', { ...wellFormed, kind: 'mystery' }).kind).toBe('adjustment');
    expect(transactionFromDoc('txn_a', { ...wellFormed, kind: 42 }).kind).toBe('adjustment');
  });

  it('repairs a missing or malformed date', () => {
    const transaction = transactionFromDoc('txn_a', {
      ...wellFormed,
      transactionDate: '04/11/2025',
      recognitionDate: undefined,
    });
    expect(transaction.transactionDate).toBe('2000-01-01');
    // Recognition falls back to the transaction date, keeping them consistent.
    expect(transaction.recognitionDate).toBe('2000-01-01');
  });

  it('derives a period key when one is missing', () => {
    const transaction = transactionFromDoc('txn_a', { ...wellFormed, periodKey: undefined });
    expect(transaction.periodKey).toBe('2025-11');
  });

  it('synthesises a sort key when one is missing, so ordering still works', () => {
    const transaction = transactionFromDoc('txn_a', { ...wellFormed, sortKey: undefined });
    expect(transaction.sortKey).toBe('2025-11-04#0#txn_a');
  });

  it('treats a non-boolean reimbursable as unknown, not as true', () => {
    // Guessing "true" would invent a receivable the shop never agreed to.
    const transaction = transactionFromDoc('txn_a', { ...wellFormed, reimbursable: 'yes' });
    expect(transaction.reimbursable).toBeNull();
    expect(transactionEffect(transaction)).toBe(0);
  });

  it('rejects an unknown funding source rather than assuming your money', () => {
    const transaction = transactionFromDoc('txn_a', { ...wellFormed, fundedFrom: 'somewhere' });
    expect(transaction.fundedFrom).toBeNull();
    expect(transactionEffect(transaction)).toBe(0);
  });

  it('drops non-string ids from a linked expense list', () => {
    const transaction = transactionFromDoc('txn_a', {
      ...wellFormed,
      settlesExpenseIds: ['txn_x', 42, null, 'txn_y'],
    });
    expect(transaction.settlesExpenseIds).toEqual(['txn_x', 'txn_y']);
  });

  it('survives an almost-empty document', () => {
    const transaction = transactionFromDoc('txn_a', {});
    expect(transaction.amount).toBe(0);
    expect(transaction.transactionDate).toBe('2000-01-01');
    expect(transactionEffect(transaction)).toBe(0);
    expect(computePeriod(paise(500), [transaction]).closingBalance).toBe(500);
  });

  it('honours a void flag whatever shape it arrives in', () => {
    const transaction = transactionFromDoc('txn_a', { ...wellFormed, voidedAt: 'some-timestamp' });
    expect(transactionEffect(transaction)).toBe(0);
  });
});
