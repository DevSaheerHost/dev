/**
 * What a statement says.
 *
 * Deliberately separate from how it is drawn. This module turns a settlement
 * into plain data — headings, summary lines, itemised rows — and the PDF
 * writer in `statementPdf.ts` only puts that data on a page.
 *
 * The split exists so the figures can be tested directly. A PDF whose numbers
 * disagree with the app is worse than no PDF, and checking a rendered page is
 * hard; checking this is trivial.
 *
 * Pure: no jsPDF, no React, no clock.
 */

import { formatDateShort, formatDateLong, type CalendarDate } from '@/lib/dates';
import { formatPaise, paise, type Paise } from '@/lib/money';
import { KIND_LABEL, type Settlement, type Shop, type Transaction } from '@/types/models';

import { transactionEffect, type RunningRow } from '../ledger/engine';

export interface StatementLine {
  readonly label: string;
  readonly amount: Paise;
  /** A total rather than a component of one. */
  readonly strong?: boolean;
}

export interface StatementRow {
  readonly date: string;
  readonly description: string;
  readonly amount: Paise;
  readonly balance: Paise;
}

export interface StatementDocument {
  readonly shopName: string;
  readonly personName: string;
  readonly statementNo: number;
  readonly periodLabel: string;
  readonly settlementDateLabel: string;
  readonly openingBalance: Paise;
  readonly closingBalance: Paise;
  /** What the closing balance means, in words. */
  readonly closingSentence: string;
  readonly earnings: readonly StatementLine[];
  readonly reductions: readonly StatementLine[];
  readonly rows: readonly StatementRow[];
  readonly notes: string;
  /** Set when entries arrived after this statement was sealed. */
  readonly disturbedNote: string | null;
}

/** Kinds that increase what the shop owes, in the order a statement lists them. */
const EARNING_ORDER = [
  'salary_earned',
  'allowance_earned',
  'other_income_earned',
  'expense_paid',
] as const;

/** Kinds that reduce it. */
const REDUCTION_ORDER = [
  'advance_received',
  'salary_payment_received',
  'reimbursement_received',
  'deduction',
] as const;

function describeClosing(shopName: string, balance: Paise): string {
  if (balance > 0) return `${shopName} owes you ${formatPaise(balance, { paise: true })}`;
  if (balance < 0) {
    return `You owe ${shopName} ${formatPaise(paise(-balance), { paise: true })}`;
  }
  return `Settled in full — nothing outstanding`;
}

/**
 * Builds the statement for a sealed settlement.
 *
 * The totals come from the stored snapshot rather than being recomputed, so
 * reprinting an old statement years later gives exactly the figures that were
 * agreed at the time — even if the engine has changed since.
 */
export function buildStatementDocument(args: {
  readonly settlement: Settlement;
  readonly shop: Shop;
  readonly personName: string;
  readonly rows: readonly RunningRow[];
  readonly disturbedCount?: number;
}): StatementDocument {
  const { settlement, shop, personName, rows, disturbedCount = 0 } = args;

  const earnings: StatementLine[] = [];
  for (const kind of EARNING_ORDER) {
    const amount = settlement.totals[kind];
    if (amount !== 0) earnings.push({ label: KIND_LABEL[kind], amount });
  }

  const reductions: StatementLine[] = [];
  for (const kind of REDUCTION_ORDER) {
    const amount = settlement.totals[kind];
    if (amount !== 0) reductions.push({ label: KIND_LABEL[kind], amount });
  }

  const adjustment = settlement.totals.adjustment;
  if (adjustment !== 0) {
    // A signed correction goes on whichever side it actually falls, so both
    // columns stay positive and read naturally.
    (adjustment > 0 ? earnings : reductions).push({
      label: KIND_LABEL.adjustment,
      amount: adjustment > 0 ? adjustment : paise(-adjustment),
    });
  }

  return {
    shopName: shop.name,
    personName,
    statementNo: settlement.statementNo,
    periodLabel: `${formatDateLong(settlement.periodStart)} to ${formatDateLong(settlement.periodEnd)}`,
    settlementDateLabel: formatDateLong(settlement.settlementDate),
    openingBalance: settlement.openingBalance,
    closingBalance: settlement.closingBalance,
    closingSentence: describeClosing(shop.name, settlement.closingBalance),
    earnings,
    reductions,
    rows: rows.map((row) => ({
      date: formatDateShort(row.transaction.transactionDate),
      description: row.transaction.description || KIND_LABEL[row.transaction.kind],
      amount: row.effect,
      balance: row.balanceAfter,
    })),
    notes: settlement.notes,
    disturbedNote:
      disturbedCount > 0
        ? `${disturbedCount} entr${disturbedCount === 1 ? 'y' : 'ies'} for these dates ` +
          'were recorded after this statement was issued. They appear on the next statement; ' +
          'the figures here are unchanged.'
        : null,
  };
}

/** The total earned and the total reduced, for the summary footer. */
export function statementTotals(document: StatementDocument): {
  earned: Paise;
  reduced: Paise;
} {
  const sum = (lines: readonly StatementLine[]) =>
    paise(lines.reduce((total, line) => total + line.amount, 0));
  return { earned: sum(document.earnings), reduced: sum(document.reductions) };
}

/**
 * A statement for a period that has not been sealed, so the user can show the
 * owner what the figures are before agreeing them.
 *
 * Marked as a draft everywhere it is rendered: an unsealed period is still
 * moving, and a figure printed from it is a proposal, not a record.
 */
export function buildDraftStatement(args: {
  readonly shop: Shop;
  readonly personName: string;
  readonly from: CalendarDate;
  readonly to: CalendarDate;
  readonly openingBalance: Paise;
  readonly closingBalance: Paise;
  readonly totals: Settlement['totals'];
  readonly rows: readonly RunningRow[];
}): StatementDocument {
  return buildStatementDocument({
    settlement: {
      id: 'draft',
      shopId: args.shop.id,
      periodStart: args.from,
      periodEnd: args.to,
      settlementDate: args.to,
      openingBalance: args.openingBalance,
      closingBalance: args.closingBalance,
      totals: args.totals,
      transactionCount: args.rows.length,
      statementNo: 0,
      sealState: 'sealed',
      status: 'sealed',
      notes: '',
      sealedAt: null,
      createdAt: null,
    },
    shop: args.shop,
    personName: args.personName,
    rows: args.rows,
  });
}

/** Rows whose effect is zero, for a note explaining why they show nothing. */
export function nonCountingRows(rows: readonly RunningRow[]): RunningRow[] {
  return rows.filter((row) => transactionEffect(row.transaction) === 0);
}

export type { Transaction };
