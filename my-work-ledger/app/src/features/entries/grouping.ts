/**
 * Entries grouped by the day they happened, for the two-column ledger view.
 *
 * The familiar shape of a shop ledger is a day heading, then the entries for
 * that day in two columns — what was added to what you are owed on one side,
 * what you were paid on the other — with the balance after each entry beside
 * it. That shape is useful because it makes a day's net effect visible without
 * arithmetic, which is exactly the arithmetic people get wrong when they argue
 * about a balance.
 *
 * All of the grouping and all of the totalling happens here, so the component
 * only has to place numbers on the page. Pure, so it can be tested directly.
 *
 * Rows arrive in ledger order — oldest first, with each row's `balanceAfter`
 * already computed by `engine.runningBalance`. Reversing them for display is a
 * presentation choice and never touches the balances: each row keeps the
 * balance it had when the entries were walked in order.
 */

import type { CalendarDate } from '@/lib/dates';
import { paise, type Paise } from '@/lib/money';

import type { RunningRow } from '@/features/ledger/engine';

/** Which column an entry belongs in. Decided by its effect on the balance. */
export type EntrySide = 'credit' | 'debit' | 'none';

export interface GroupedRow extends RunningRow {
  readonly side: EntrySide;
}

export interface EntryGroup {
  /** The day these entries happened on. */
  readonly date: CalendarDate;
  readonly rows: readonly GroupedRow[];
  /** Added to what the shop owes you on this day. */
  readonly credit: Paise;
  /** Taken off what the shop owes you on this day. */
  readonly debit: Paise;
  /** The balance after the last entry of the day, in ledger order. */
  readonly closing: Paise;
}

export function sideOf(row: RunningRow): EntrySide {
  if (row.effect > 0) return 'credit';
  if (row.effect < 0) return 'debit';
  // A non-reimbursable or shop-funded expense is recorded but moves nothing, so
  // it sits in neither column and shows as a note.
  return 'none';
}

/**
 * Groups rows by `transactionDate`.
 *
 * `order: 'newest'` puts the most recent day first, and the most recent entry
 * first inside each day — the current position at the top, which is what
 * someone opening the app wants to see. The totals are unaffected by order.
 */
export function groupEntriesByDay(
  rows: readonly RunningRow[],
  order: 'newest' | 'oldest' = 'newest',
): EntryGroup[] {
  const byDate = new Map<CalendarDate, GroupedRow[]>();
  const closing = new Map<CalendarDate, Paise>();

  // Walked in ledger order, so the last row seen for a date is the one whose
  // balance closes that day.
  for (const row of rows) {
    const date = row.transaction.transactionDate;
    const existing = byDate.get(date);
    const grouped: GroupedRow = { ...row, side: sideOf(row) };
    if (existing) existing.push(grouped);
    else byDate.set(date, [grouped]);
    closing.set(date, row.balanceAfter);
  }

  const dates = [...byDate.keys()].sort();
  if (order === 'newest') dates.reverse();

  return dates.map((date) => {
    const dayRows = byDate.get(date) ?? [];
    let credit = 0;
    let debit = 0;
    for (const row of dayRows) {
      if (row.side === 'credit') credit += row.effect;
      else if (row.side === 'debit') debit += -row.effect;
    }
    return {
      date,
      rows: order === 'newest' ? [...dayRows].reverse() : dayRows,
      credit: paise(credit),
      debit: paise(debit),
      closing: closing.get(date) ?? paise(0),
    };
  });
}

/** Column totals across every group, for the ledger footer. */
export function groupTotals(groups: readonly EntryGroup[]): {
  readonly credit: Paise;
  readonly debit: Paise;
} {
  let credit = 0;
  let debit = 0;
  for (const group of groups) {
    credit += group.credit;
    debit += group.debit;
  }
  return { credit: paise(credit), debit: paise(debit) };
}
