import { describe, expect, it } from 'vitest';

import { asCalendarDate } from '@/lib/dates';
import { paise, type Paise } from '@/lib/money';
import type { Shop } from '@/types/models';

import { computePeriod, transactionEffect } from './engine';
import { TRANSACTION_KINDS } from '@/types/models';

import {
  ENTRY_DOCUMENT_FIELDS,
  buildCashBonusPair,
  buildEntryDocument,
  buildSortKey,
  directionFor,
  recognitionFor,
  validateEntry,
  type EntryInput,
} from './posting';

const date = asCalendarDate;
const rs = (rupees: number): Paise => paise(Math.round(rupees * 100));
const TODAY = date('2025-11-20');

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

function entry(overrides: Partial<EntryInput> = {}): EntryInput {
  return {
    kind: 'salary_payment_received',
    amount: rs(1000),
    transactionDate: date('2025-11-10'),
    category: '',
    description: '',
    ...overrides,
  };
}

/* ========================================================================== */

describe('directionFor', () => {
  it('derives the direction from the kind, never from the amount', () => {
    expect(directionFor('salary_earned')).toBe('credit');
    expect(directionFor('expense_paid')).toBe('credit');
    expect(directionFor('advance_received')).toBe('debit');
    expect(directionFor('deduction')).toBe('debit');
  });
});

/* ========================================================================== */

describe('recognitionFor', () => {
  it('recognises an ordinary entry on the day it happened', () => {
    expect(recognitionFor({ sealedThroughDate: null }, date('2025-11-10'))).toEqual({
      recognitionDate: '2025-11-10',
      periodKey: '2025-11',
      isPriorPeriodAdjustment: false,
    });
  });

  it('leaves an entry after the seal alone', () => {
    expect(
      recognitionFor({ sealedThroughDate: date('2025-10-31') }, date('2025-11-10')),
    ).toEqual({
      recognitionDate: '2025-11-10',
      periodKey: '2025-11',
      isPriorPeriodAdjustment: false,
    });
  });

  it('pushes an entry dated inside a sealed period to the first open day', () => {
    // The sealed October statement is not rewritten; the entry is recognised in
    // November and keeps 20 October as its true date.
    expect(
      recognitionFor({ sealedThroughDate: date('2025-10-31') }, date('2025-10-20')),
    ).toEqual({
      recognitionDate: '2025-11-01',
      periodKey: '2025-11',
      isPriorPeriodAdjustment: true,
    });
  });

  it('treats the seal date itself as sealed', () => {
    expect(
      recognitionFor({ sealedThroughDate: date('2025-10-31') }, date('2025-10-31')),
    ).toMatchObject({ recognitionDate: '2025-11-01', isPriorPeriodAdjustment: true });
  });

  it('crosses a year boundary correctly', () => {
    expect(
      recognitionFor({ sealedThroughDate: date('2025-12-31') }, date('2025-12-05')),
    ).toMatchObject({ recognitionDate: '2026-01-01', periodKey: '2026-01' });
  });
});

/* ========================================================================== */

describe('buildSortKey', () => {
  it('sorts by date first, then by when the entry was made', () => {
    const earlier = buildSortKey(date('2025-11-02'), 1_700_000_000_000, 'txn_b');
    const later = buildSortKey(date('2025-11-20'), 1_600_000_000_000, 'txn_a');
    expect(earlier < later).toBe(true);
  });

  it('pads the timestamp so string comparison matches numeric order', () => {
    // Without padding, "9999999999999" would sort after "10000000000000".
    const small = buildSortKey(date('2025-11-02'), 999_999_999_999, 'txn_a');
    const large = buildSortKey(date('2025-11-02'), 1_000_000_000_000, 'txn_a');
    expect(small < large).toBe(true);
  });

  it('breaks a same-millisecond tie by id, so the order is total', () => {
    const a = buildSortKey(date('2025-11-02'), 1_700_000_000_000, 'txn_a');
    const b = buildSortKey(date('2025-11-02'), 1_700_000_000_000, 'txn_b');
    expect(a < b).toBe(true);
    expect(a).not.toBe(b);
  });
});

/* ========================================================================== */

describe('validateEntry', () => {
  const shop = shopFixture({ openingBalanceAsOf: date('2025-06-01') });

  const fieldsFor = (input: EntryInput) =>
    validateEntry(shop, input, TODAY).map((error) => error.field);

  it('accepts a well-formed entry', () => {
    expect(validateEntry(shop, entry(), TODAY)).toEqual([]);
  });

  it('refuses a zero or out-of-range amount', () => {
    expect(fieldsFor(entry({ amount: paise(0) }))).toContain('amount');
    expect(fieldsFor(entry({ amount: paise(99_999_999_999) }))).toContain('amount');
  });

  it('refuses a negative amount on every kind but an adjustment', () => {
    expect(fieldsFor(entry({ kind: 'salary_earned', amount: paise(-100) }))).toContain('amount');
    expect(
      validateEntry(shop, entry({ kind: 'adjustment', amount: paise(-100) }), TODAY),
    ).toEqual([]);
  });

  it('refuses a future date, because this records what happened', () => {
    expect(fieldsFor(entry({ transactionDate: date('2025-11-21') }))).toContain('transactionDate');
    expect(validateEntry(shop, entry({ transactionDate: TODAY }), TODAY)).toEqual([]);
  });

  it('refuses a date before the opening balance, which would double-count', () => {
    const errors = validateEntry(shop, entry({ transactionDate: date('2025-05-31') }), TODAY);
    expect(errors[0]?.field).toBe('transactionDate');
    expect(errors[0]?.message).toContain('opening balance');
    // The opening date itself is fine.
    expect(validateEntry(shop, entry({ transactionDate: date('2025-06-01') }), TODAY)).toEqual([]);
  });

  it('requires an expense to say whose money it was and whether it comes back', () => {
    expect(fieldsFor(entry({ kind: 'expense_paid' }))).toEqual(
      expect.arrayContaining(['reimbursable', 'fundedFrom']),
    );
    expect(
      validateEntry(
        shop,
        entry({ kind: 'expense_paid', reimbursable: true, fundedFrom: 'own' }),
        TODAY,
      ),
    ).toEqual([]);
  });

  it('refuses those fields on anything that is not an expense', () => {
    expect(fieldsFor(entry({ kind: 'advance_received', reimbursable: true }))).toContain(
      'reimbursable',
    );
  });

  it('bounds the free text', () => {
    expect(fieldsFor(entry({ description: 'x'.repeat(501) }))).toContain('description');
    expect(fieldsFor(entry({ category: 'x'.repeat(41) }))).toContain('category');
  });

  it('reports every problem at once rather than stopping at the first', () => {
    const errors = validateEntry(
      shop,
      entry({ kind: 'expense_paid', amount: paise(0), transactionDate: date('2025-05-01') }),
      TODAY,
    );
    expect(errors.length).toBeGreaterThanOrEqual(4);
  });
});

/* ========================================================================== */

describe('buildEntryDocument', () => {
  const base = {
    id: 'txn_abc',
    uid: 'uid_1',
    clientCreatedAtMs: 1_763_000_000_000,
  };

  it('fills every field the schema and the rules expect', () => {
    const document = buildEntryDocument({
      ...base,
      shop: shopFixture(),
      input: entry({ kind: 'salary_earned', amount: rs(18000), description: '  padded  ' }),
    });

    // The id is the document key, not a stored field: the rules whitelist the
    // fields exactly, so an extra one is rejected outright.
    expect(document).not.toHaveProperty('id');
    expect(document).toMatchObject({
      uid: 'uid_1',
      shopId: 'shop_1',
      kind: 'salary_earned',
      amount: rs(18000),
      direction: 'credit',
      description: 'padded',
      transactionDate: '2025-11-10',
      recognitionDate: '2025-11-10',
      periodKey: '2025-11',
      settlementId: null,
      voidedAt: null,
      isPriorPeriodAdjustment: false,
    });
    expect(document.sortKey).toBe('2025-11-10#001763000000000#txn_abc');
  });

  it('carries expense fields only for an expense', () => {
    const expense = buildEntryDocument({
      ...base,
      shop: shopFixture(),
      input: entry({ kind: 'expense_paid', reimbursable: true, fundedFrom: 'own' }),
    });
    expect(expense).toMatchObject({ reimbursable: true, fundedFrom: 'own' });

    const payment = buildEntryDocument({
      ...base,
      shop: shopFixture(),
      input: entry({ kind: 'salary_payment_received' }),
    });
    expect(payment).toMatchObject({ reimbursable: null, fundedFrom: null });
  });

  it('marks and reroutes an entry backdated into a sealed period', () => {
    const document = buildEntryDocument({
      ...base,
      shop: shopFixture({ sealedThroughDate: date('2025-10-31') }),
      input: entry({ transactionDate: date('2025-10-15') }),
    });
    expect(document).toMatchObject({
      transactionDate: '2025-10-15', // the truth is preserved
      recognitionDate: '2025-11-01', // but it counts in the open period
      periodKey: '2025-11',
      isPriorPeriodAdjustment: true,
    });
    // The sort key follows the true date, so the entry reads in the order it
    // actually happened in a full history view.
    expect(document.sortKey.startsWith('2025-10-15#')).toBe(true);
  });

  it('never lets the client claim a settlement or a pre-void', () => {
    const document = buildEntryDocument({ ...base, shop: shopFixture(), input: entry() });
    expect(document.settlementId).toBeNull();
    expect(document.voidedAt).toBeNull();
    expect(document.adjustsSettlementId).toBeNull();
  });

  it('produces documents the engine agrees with', () => {
    const shop = shopFixture();
    const documents = [
      buildEntryDocument({
        ...base,
        id: 'txn_1',
        shop,
        input: entry({ kind: 'salary_earned', amount: rs(18000) }),
      }),
      buildEntryDocument({
        ...base,
        id: 'txn_2',
        shop,
        input: entry({ kind: 'advance_received', amount: rs(5000) }),
      }),
    ].map((document, index) => ({
      ...document,
      id: `txn_${index}`,
      createdAt: null,
      updatedAt: null,
    }));

    expect(computePeriod(paise(0), documents).closingBalance).toBe(rs(13000));
  });
});

/* ========================================================================== */

describe('buildCashBonusPair', () => {
  it('records a cash tip as both earned and received, netting to zero', () => {
    // Recording only the cash would quietly reduce what the shop still owes,
    // as though the tip were a payment against the salary.
    const [earned, received] = buildCashBonusPair({
      amount: rs(500),
      transactionDate: date('2025-11-10'),
      description: 'Diwali tip',
      category: 'bonus',
      pairId: 'pair_1',
    });

    expect(earned.kind).toBe('other_income_earned');
    expect(received.kind).toBe('salary_payment_received');
    expect(earned.pairId).toBe(received.pairId);

    const shop = shopFixture();
    const documents = [earned, received].map((input, index) =>
      ({
        ...buildEntryDocument({
          id: `txn_${index}`,
          uid: 'uid_1',
          shop,
          input,
          clientCreatedAtMs: 1_763_000_000_000 + index,
        }),
        id: `txn_${index}`,
        createdAt: null,
        updatedAt: null,
      }),
    );

    expect(computePeriod(paise(0), documents).closingBalance).toBe(rs(0));
    // But the income is still visible in the month's totals.
    expect(computePeriod(paise(0), documents).totals.otherIncomeEarned).toBe(rs(500));
    expect(transactionEffect(documents[0]!)).toBe(rs(500));
    expect(transactionEffect(documents[1]!)).toBe(rs(-500));
  });
});

/* ========================================================================== */
/* The stored shape must match what the rules allow                            */
/* ========================================================================== */

describe('the document body matches the security rules whitelist', () => {
  // This is the test that would have caught a real bug: the builder used to
  // include `id` in the body. The rules whitelist fields exactly, so every
  // write was rejected with an opaque "evaluation error" — and because writes
  // are deliberately not awaited, the UI reported success while nothing saved.
  it('writes exactly the whitelisted fields, no more and no fewer', () => {
    const document = buildEntryDocument({
      id: 'txn_abc',
      uid: 'uid_1',
      shop: shopFixture(),
      input: entry(),
      clientCreatedAtMs: 1_763_000_000_000,
    });

    expect(Object.keys(document).sort()).toEqual([...ENTRY_DOCUMENT_FIELDS].sort());
  });

  it('never carries an id, which is the document key', () => {
    for (const kind of TRANSACTION_KINDS) {
      const document = buildEntryDocument({
        id: 'txn_abc',
        uid: 'uid_1',
        shop: shopFixture(),
        input: entry({
          kind,
          ...(kind === 'expense_paid' ? { reimbursable: true, fundedFrom: 'own' as const } : {}),
        }),
        clientCreatedAtMs: 1_763_000_000_000,
      });
      expect(Object.keys(document)).not.toContain('id');
      expect(Object.keys(document).sort()).toEqual([...ENTRY_DOCUMENT_FIELDS].sort());
    }
  });

  it('never writes undefined, which Firestore rejects', () => {
    const document = buildEntryDocument({
      id: 'txn_abc',
      uid: 'uid_1',
      shop: shopFixture(),
      input: entry(),
      clientCreatedAtMs: 1_763_000_000_000,
    });
    for (const [key, value] of Object.entries(document)) {
      expect(value, `${key} must be null rather than undefined`).not.toBeUndefined();
    }
  });
});
