/**
 * Settlements: closing a period and writing down what it came to.
 *
 * A settlement is a **statement, not a money movement**. It records what was
 * owed for a span of days and freezes it. Cash the owner hands over at the same
 * moment is an ordinary payment entry; conflating the two would count every
 * settlement twice, which is the single most important mistake this module
 * exists to prevent.
 *
 * The figures come from `engine.ts` — the same functions the screen uses — so a
 * printed statement can never disagree with what the app showed. Pure: no
 * Firestore, no React, and `today` always arrives as an argument.
 */

import {
  addDays,
  addMonths,
  compareDates,
  periodEnd,
  periodKeyOf,
  periodStart,
  type CalendarDate,
} from '@/lib/dates';
import { ZERO, paise, type Paise } from '@/lib/money';
import type { Settlement, Shop, Transaction, TransactionKind } from '@/types/models';
import { TRANSACTION_KINDS } from '@/types/models';

import {
  balanceBeforePeriod,
  computePeriod,
  entriesForPeriod,
  liveEntries,
  runningBalance,
  type LedgerPeriod,
  type RunningRow,
} from './engine';

export interface SettlementRange {
  readonly from: CalendarDate;
  readonly to: CalendarDate;
}

/** The first day a shop can have a settlement for: the day after the last one. */
export function firstOpenDay(shop: Shop): CalendarDate {
  if (shop.sealedThroughDate) return addDays(shop.sealedThroughDate, 1);
  return compareDates(shop.joiningDate, shop.openingBalanceAsOf) >= 0
    ? shop.joiningDate
    : shop.openingBalanceAsOf;
}

/**
 * What "Settle up" should offer by default: everything not yet settled, up to
 * the end of last month.
 *
 * Sweeping in forgotten months rather than only offering the most recent one
 * matters — a month skipped in August should not stay unsettled forever because
 * the button only ever proposes October. The current month is excluded because
 * sealing days you are still working would freeze a period that is still
 * changing.
 *
 * Returns null when there is nothing to settle yet.
 */
export function defaultSettlementRange(shop: Shop, today: CalendarDate): SettlementRange | null {
  const from = firstOpenDay(shop);
  const to = periodEnd(addMonths(periodKeyOf(today), -1));
  if (compareDates(from, to) > 0) return null;
  return { from, to };
}

/** The lowest statement number not yet used. Statements number from 1. */
export function nextStatementNo(settlements: readonly Settlement[]): number {
  let highest = 0;
  for (const settlement of settlements) {
    if (settlement.statementNo > highest) highest = settlement.statementNo;
  }
  return highest + 1;
}

/** An empty total for every kind, so a snapshot always has the full shape. */
function emptyTotals(): Record<TransactionKind, Paise> {
  const totals = {} as Record<TransactionKind, Paise>;
  for (const kind of TRANSACTION_KINDS) totals[kind] = ZERO;
  return totals;
}

export interface SettlementSnapshot {
  /** Exactly what is stored, with no id and no timestamps. */
  readonly body: Omit<Settlement, 'id' | 'sealedAt' | 'createdAt'>;
  /** The entries this statement claims, to be stamped with its id. */
  readonly includedIds: readonly string[];
  /** The period as the engine computed it, for the preview and the PDF. */
  readonly period: LedgerPeriod;
  /** Line-by-line with a running balance, for the body of the statement. */
  readonly rows: readonly RunningRow[];
}

/**
 * Builds a statement for a span of days.
 *
 * Membership follows `recognitionDate`, matching `entriesForPeriod`: an entry
 * backdated into an already-sealed period is recognised in the open one, so it
 * belongs to this statement rather than silently altering an old one.
 */
export function buildSnapshot(args: {
  readonly shop: Shop;
  readonly transactions: readonly Transaction[];
  readonly from: CalendarDate;
  readonly to: CalendarDate;
  readonly statementNo: number;
  readonly settlementDate: CalendarDate;
  readonly notes?: string;
}): SettlementSnapshot {
  const { shop, transactions, from, to, statementNo, settlementDate } = args;

  if (compareDates(from, to) > 0) {
    throw new RangeError('A settlement cannot end before it starts');
  }

  const openingBalance = balanceBeforePeriod(shop.openingBalance, transactions, from);
  const entries = entriesForPeriod(transactions, from, to);
  const period = computePeriod(openingBalance, entries);

  // Per-kind totals, which is what the stored snapshot and the PDF summary use.
  // Derived from the same entries the engine just summed, so the two agree by
  // construction rather than by coincidence.
  const totals = emptyTotals();
  for (const entry of entries) {
    totals[entry.kind] = paise(totals[entry.kind] + entry.amount);
  }

  return {
    body: {
      shopId: shop.id,
      periodStart: from,
      periodEnd: to,
      settlementDate,
      openingBalance,
      closingBalance: period.closingBalance,
      totals,
      transactionCount: entries.length,
      statementNo,
      sealState: 'stamping',
      status: 'sealed',
      notes: (args.notes ?? '').slice(0, 1000),
    },
    includedIds: entries.map((entry) => entry.id),
    period,
    rows: runningBalance(openingBalance, entries),
  };
}

/**
 * Entries that arrived after a statement was sealed but belong to the days it
 * covers.
 *
 * The statement itself is never rewritten — that is the whole point of sealing.
 * This is how the app says "something turned up later" without touching a
 * figure the shop owner has already seen.
 *
 * Derived rather than stored: computing it from the entries every time means
 * the flag cannot drift away from the facts it describes.
 */
export function disturbedBy(
  settlement: Pick<Settlement, 'periodStart' | 'periodEnd'>,
  transactions: readonly Transaction[],
): Transaction[] {
  return liveEntries(transactions).filter(
    (entry) =>
      entry.isPriorPeriodAdjustment &&
      compareDates(entry.transactionDate, settlement.periodStart) >= 0 &&
      compareDates(entry.transactionDate, settlement.periodEnd) <= 0,
  );
}

/** True when a sealed statement has been disturbed by a later entry. */
export function isDisturbed(
  settlement: Pick<Settlement, 'periodStart' | 'periodEnd'>,
  transactions: readonly Transaction[],
): boolean {
  return disturbedBy(settlement, transactions).length > 0;
}

/**
 * Statements newest first. Sorting on `periodEnd` rather than `statementNo`
 * keeps a back-filled statement for an older span in the right place.
 */
export function sortStatements(settlements: readonly Settlement[]): Settlement[] {
  return [...settlements].sort(
    (a, b) => compareDates(b.periodEnd, a.periodEnd) || b.statementNo - a.statementNo,
  );
}

/** A settlement left half-finished by an interrupted seal, if there is one. */
export function findUnfinished(settlements: readonly Settlement[]): Settlement | null {
  return settlements.find((settlement) => settlement.sealState === 'stamping') ?? null;
}

/**
 * The months a statement spans, for a heading like "October – November 2025".
 * A statement covering one month reads as just that month.
 */
export function describeRange(range: SettlementRange): string {
  const first = periodKeyOf(range.from);
  const last = periodKeyOf(range.to);
  const wholeMonth =
    first === last && range.from === periodStart(first) && range.to === periodEnd(last);
  if (wholeMonth) return first;
  return `${range.from} to ${range.to}`;
}
