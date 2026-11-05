import { describe, expect, it } from 'vitest';

import { asCalendarDate, type PeriodKey } from '@/lib/dates';
import { paise, type Paise } from '@/lib/money';
import type { Settlement, Shop, Transaction, TransactionKind } from '@/types/models';

import { balanceAsOf, computeMonth } from './engine';
import {
  buildSnapshot,
  defaultSettlementRange,
  describeRange,
  disturbedBy,
  findUnfinished,
  firstOpenDay,
  isDisturbed,
  nextStatementNo,
  sortStatements,
} from './settlement';

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
  const id = overrides.id ?? `txn_${String(sequence).padStart(3, '0')}`;
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

function settlementFixture(overrides: Partial<Settlement> = {}): Settlement {
  return {
    id: 'set_1',
    shopId: 'shop_1',
    periodStart: date('2025-10-01'),
    periodEnd: date('2025-10-31'),
    settlementDate: date('2025-11-01'),
    openingBalance: paise(0),
    closingBalance: rs(1000),
    totals: {} as Settlement['totals'],
    transactionCount: 2,
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
/* Which days to settle                                                        */
/* ========================================================================== */

describe('firstOpenDay', () => {
  it('starts at the shop start when nothing has been settled', () => {
    expect(firstOpenDay(shopFixture())).toBe('2025-01-01');
  });

  it('never starts before the opening balance date', () => {
    const shop = shopFixture({
      joiningDate: date('2024-06-01'),
      openingBalanceAsOf: date('2025-03-15'),
    });
    expect(firstOpenDay(shop)).toBe('2025-03-15');
  });

  it('starts the day after the last statement', () => {
    const shop = shopFixture({ sealedThroughDate: date('2025-10-31') });
    expect(firstOpenDay(shop)).toBe('2025-11-01');
  });

  it('crosses a year boundary', () => {
    expect(firstOpenDay(shopFixture({ sealedThroughDate: date('2025-12-31') }))).toBe('2026-01-01');
  });
});

describe('defaultSettlementRange', () => {
  it('offers everything unsettled up to the end of last month', () => {
    const shop = shopFixture({ sealedThroughDate: date('2025-08-31') });
    expect(defaultSettlementRange(shop, date('2025-11-12'))).toEqual({
      from: '2025-09-01',
      to: '2025-10-31',
    });
  });

  it('sweeps in months that were skipped', () => {
    // Nothing settled since joining in July; all of it is offered at once
    // rather than only the most recent month.
    const shop = shopFixture({
      joiningDate: date('2025-07-10'),
      openingBalanceAsOf: date('2025-07-10'),
    });
    expect(defaultSettlementRange(shop, date('2025-11-12'))).toEqual({
      from: '2025-07-10',
      to: '2025-10-31',
    });
  });

  it('excludes the month in progress', () => {
    // Sealing days still being worked would freeze a period that is still
    // changing, and a sealed period cannot be corrected in place.
    const shop = shopFixture({ sealedThroughDate: date('2025-10-31') });
    expect(defaultSettlementRange(shop, date('2025-11-12'))).toBeNull();
  });

  it('offers nothing in the first month at a new shop', () => {
    const shop = shopFixture({
      joiningDate: date('2025-11-01'),
      openingBalanceAsOf: date('2025-11-01'),
    });
    expect(defaultSettlementRange(shop, date('2025-11-20'))).toBeNull();
  });

  it('offers last month on the first day of this one', () => {
    const shop = shopFixture({ sealedThroughDate: date('2025-09-30') });
    expect(defaultSettlementRange(shop, date('2025-11-01'))).toEqual({
      from: '2025-10-01',
      to: '2025-10-31',
    });
  });
});

describe('nextStatementNo', () => {
  it('starts at 1 and counts up from the highest used', () => {
    expect(nextStatementNo([])).toBe(1);
    expect(nextStatementNo([settlementFixture({ statementNo: 1 })])).toBe(2);
    expect(
      nextStatementNo([
        settlementFixture({ id: 'a', statementNo: 3 }),
        settlementFixture({ id: 'b', statementNo: 1 }),
      ]),
    ).toBe(4);
  });
});

/* ========================================================================== */
/* The snapshot                                                                */
/* ========================================================================== */

describe('buildSnapshot', () => {
  const shop = shopFixture();
  const october = [
    txn({ kind: 'salary_earned', amount: rs(18000), transactionDate: date('2025-10-31') }),
    txn({ kind: 'advance_received', amount: rs(5000), transactionDate: date('2025-10-05') }),
    txn({
      kind: 'expense_paid',
      amount: rs(640),
      transactionDate: date('2025-10-12'),
      reimbursable: true,
      fundedFrom: 'own',
    }),
  ];

  const snapshot = () =>
    buildSnapshot({
      shop,
      transactions: october,
      from: date('2025-10-01'),
      to: date('2025-10-31'),
      statementNo: 1,
      settlementDate: date('2025-11-01'),
    });

  it('agrees with the engine, which is the whole point', () => {
    // A statement that disagreed with the screen would be worse than no
    // statement at all.
    const built = snapshot();
    const fromEngine = computeMonth(paise(0), october, '2025-10' as PeriodKey);
    expect(built.body.closingBalance).toBe(fromEngine.closingBalance);
    expect(built.body.closingBalance).toBe(rs(13640));
  });

  it('records a total for every kind, including the untouched ones', () => {
    const { totals } = snapshot().body;
    expect(totals.salary_earned).toBe(rs(18000));
    expect(totals.advance_received).toBe(rs(5000));
    expect(totals.expense_paid).toBe(rs(640));
    expect(totals.deduction).toBe(rs(0));
    expect(Object.keys(totals)).toHaveLength(9);
  });

  it('claims exactly the entries it counted', () => {
    const built = snapshot();
    expect(built.includedIds).toHaveLength(3);
    expect(built.body.transactionCount).toBe(3);
    expect(new Set(built.includedIds).size).toBe(3);
  });

  it('is created as stamping, never as sealed', () => {
    // Sealing is a two-step write: the entries have to be claimed before the
    // statement can call itself final.
    expect(snapshot().body.sealState).toBe('stamping');
  });

  it('produces rows that end on the closing balance', () => {
    const built = snapshot();
    expect(built.rows).toHaveLength(3);
    expect(built.rows.at(-1)?.balanceAfter).toBe(built.body.closingBalance);
  });

  it('carries the earlier balance in rather than starting at zero', () => {
    const withHistory = [
      txn({ kind: 'salary_earned', amount: rs(10000), transactionDate: date('2025-09-30') }),
      ...october,
    ];
    const built = buildSnapshot({
      shop,
      transactions: withHistory,
      from: date('2025-10-01'),
      to: date('2025-10-31'),
      statementNo: 2,
      settlementDate: date('2025-11-01'),
    });
    expect(built.body.openingBalance).toBe(rs(10000));
    expect(built.body.closingBalance).toBe(rs(23640));
  });

  it('includes the shop opening balance in the first statement', () => {
    const built = buildSnapshot({
      shop: shopFixture({ openingBalance: rs(450) }),
      transactions: october,
      from: date('2025-10-01'),
      to: date('2025-10-31'),
      statementNo: 1,
      settlementDate: date('2025-11-01'),
    });
    expect(built.body.openingBalance).toBe(rs(450));
    expect(built.body.closingBalance).toBe(rs(14090));
  });

  it('chains across three periods without losing a paise', () => {
    const all = [
      txn({ kind: 'salary_earned', amount: rs(1000), transactionDate: date('2025-09-15') }),
      txn({ kind: 'salary_earned', amount: rs(2000), transactionDate: date('2025-10-15') }),
      txn({ kind: 'advance_received', amount: rs(500), transactionDate: date('2025-11-15') }),
    ];
    const months: [string, string][] = [
      ['2025-09-01', '2025-09-30'],
      ['2025-10-01', '2025-10-31'],
      ['2025-11-01', '2025-11-30'],
    ];

    let previousClosing = paise(0);
    const closings = months.map(([from, to], index) => {
      const built = buildSnapshot({
        shop,
        transactions: all,
        from: date(from),
        to: date(to),
        statementNo: index + 1,
        settlementDate: date(to),
      });
      // Each statement must open exactly where the last one closed.
      expect(built.body.openingBalance).toBe(previousClosing);
      previousClosing = built.body.closingBalance;
      return built.body.closingBalance;
    });

    expect(closings).toEqual([rs(1000), rs(3000), rs(2500)]);
    // And the final closing equals the balance computed straight from the top.
    expect(closings.at(-1)).toBe(balanceAsOf(paise(0), all, date('2025-11-30')));
  });

  it('settles an empty period without complaint', () => {
    const built = buildSnapshot({
      shop,
      transactions: [],
      from: date('2025-10-01'),
      to: date('2025-10-31'),
      statementNo: 1,
      settlementDate: date('2025-11-01'),
    });
    expect(built.body.transactionCount).toBe(0);
    expect(built.body.closingBalance).toBe(rs(0));
    expect(built.rows).toEqual([]);
  });

  it('ignores voided entries', () => {
    const built = buildSnapshot({
      shop,
      transactions: [
        ...october,
        txn({
          kind: 'salary_earned',
          amount: rs(99000),
          transactionDate: date('2025-10-20'),
          voidedAt: 'gone',
        }),
      ],
      from: date('2025-10-01'),
      to: date('2025-10-31'),
      statementNo: 1,
      settlementDate: date('2025-11-01'),
    });
    expect(built.body.closingBalance).toBe(rs(13640));
    expect(built.body.transactionCount).toBe(3);
  });

  it('refuses a range that ends before it starts', () => {
    expect(() =>
      buildSnapshot({
        shop,
        transactions: [],
        from: date('2025-10-31'),
        to: date('2025-10-01'),
        statementNo: 1,
        settlementDate: date('2025-11-01'),
      }),
    ).toThrow(RangeError);
  });

  it('bounds the note', () => {
    const built = buildSnapshot({
      shop,
      transactions: [],
      from: date('2025-10-01'),
      to: date('2025-10-31'),
      statementNo: 1,
      settlementDate: date('2025-11-01'),
      notes: 'x'.repeat(2000),
    });
    expect(built.body.notes).toHaveLength(1000);
  });
});

/* ========================================================================== */
/* A sealed statement is never rewritten                                       */
/* ========================================================================== */

describe('an entry backdated into a sealed period', () => {
  const shop = shopFixture({ sealedThroughDate: date('2025-10-31') });
  const october = [
    txn({ kind: 'salary_earned', amount: rs(18000), transactionDate: date('2025-10-31') }),
  ];

  // Dated 20 October, but recognised on 1 November because October is sealed.
  const late = txn({
    kind: 'expense_paid',
    amount: rs(500),
    transactionDate: date('2025-10-20'),
    recognitionDate: date('2025-11-01'),
    reimbursable: true,
    fundedFrom: 'own',
    isPriorPeriodAdjustment: true,
  });

  it('leaves the sealed statement identical', () => {
    const before = buildSnapshot({
      shop,
      transactions: october,
      from: date('2025-10-01'),
      to: date('2025-10-31'),
      statementNo: 1,
      settlementDate: date('2025-11-01'),
    });
    const after = buildSnapshot({
      shop,
      transactions: [...october, late],
      from: date('2025-10-01'),
      to: date('2025-10-31'),
      statementNo: 1,
      settlementDate: date('2025-11-01'),
    });

    expect(after.body).toEqual(before.body);
    expect(after.includedIds).toEqual(before.includedIds);
  });

  it('lands in the next statement instead', () => {
    const november = buildSnapshot({
      shop,
      transactions: [...october, late],
      from: date('2025-11-01'),
      to: date('2025-11-30'),
      statementNo: 2,
      settlementDate: date('2025-12-01'),
    });
    expect(november.includedIds).toContain(late.id);
    expect(november.body.openingBalance).toBe(rs(18000));
    expect(november.body.closingBalance).toBe(rs(18500));
  });

  it('is reported against the statement it disturbed', () => {
    const sealed = settlementFixture({
      periodStart: date('2025-10-01'),
      periodEnd: date('2025-10-31'),
    });
    expect(disturbedBy(sealed, [...october, late])).toHaveLength(1);
    expect(isDisturbed(sealed, [...october, late])).toBe(true);
    expect(isDisturbed(sealed, october)).toBe(false);
  });

  it('is not reported against a statement for other days', () => {
    const september = settlementFixture({
      periodStart: date('2025-09-01'),
      periodEnd: date('2025-09-30'),
    });
    expect(isDisturbed(september, [late])).toBe(false);
  });

  it('is not reported once voided', () => {
    const sealed = settlementFixture({
      periodStart: date('2025-10-01'),
      periodEnd: date('2025-10-31'),
    });
    const voided = { ...late, voidedAt: 'gone' };
    expect(isDisturbed(sealed, [voided])).toBe(false);
  });

  it('does not flag an ordinary entry that simply falls in the range', () => {
    // Only an entry that arrived *after* sealing disturbs a statement. The
    // entries the statement itself counted obviously fall inside it.
    const sealed = settlementFixture({
      periodStart: date('2025-10-01'),
      periodEnd: date('2025-10-31'),
    });
    expect(isDisturbed(sealed, october)).toBe(false);
  });
});

/* ========================================================================== */
/* Housekeeping                                                                */
/* ========================================================================== */

describe('sortStatements', () => {
  it('puts the most recent period first', () => {
    const sorted = sortStatements([
      settlementFixture({ id: 'a', periodEnd: date('2025-09-30'), statementNo: 1 }),
      settlementFixture({ id: 'c', periodEnd: date('2025-11-30'), statementNo: 3 }),
      settlementFixture({ id: 'b', periodEnd: date('2025-10-31'), statementNo: 2 }),
    ]);
    expect(sorted.map((settlement) => settlement.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('findUnfinished', () => {
  it('finds a seal that was interrupted part-way', () => {
    const half = settlementFixture({ id: 'half', sealState: 'stamping' });
    expect(findUnfinished([settlementFixture(), half])?.id).toBe('half');
  });

  it('returns null when everything is sealed', () => {
    expect(findUnfinished([settlementFixture()])).toBeNull();
    expect(findUnfinished([])).toBeNull();
  });
});

describe('describeRange', () => {
  it('names a whole month as just that month', () => {
    expect(describeRange({ from: date('2025-10-01'), to: date('2025-10-31') })).toBe('2025-10');
    expect(describeRange({ from: date('2025-02-01'), to: date('2025-02-28') })).toBe('2025-02');
  });

  it('spells out a partial or multi-month range', () => {
    expect(describeRange({ from: date('2025-10-05'), to: date('2025-10-31') })).toBe(
      '2025-10-05 to 2025-10-31',
    );
    expect(describeRange({ from: date('2025-09-01'), to: date('2025-10-31') })).toBe(
      '2025-09-01 to 2025-10-31',
    );
  });
});
