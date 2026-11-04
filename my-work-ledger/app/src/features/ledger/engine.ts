/**
 * The ledger engine.
 *
 * Given an opening balance and a set of entries, it produces the totals and the
 * closing balance. That is all it does. It knows nothing about React, nothing
 * about Firestore, and it never reads the clock — "today" arrives as an
 * argument. That is what makes a balance reproducible: the same inputs always
 * give the same figure, in a test, on a phone, and in a PDF handed to a shop
 * owner.
 *
 * Every arithmetic decision in this file is deliberate. In particular:
 *
 *  - The sign of an entry comes from its `kind`, never from the stored amount.
 *    Only `adjustment` carries its own sign, because a correction is signed by
 *    definition. The rules enforce this, so a negative salary cannot exist.
 *  - An expense only increases what the shop owes when *you* funded it and it
 *    is reimbursable. A non-reimbursable expense, or one paid from the shop's
 *    own float, is a cost record with no effect on the balance. Without that
 *    distinction a petty-cash float silently inflates the balance.
 *  - Money received is never an earning. An advance reduces what is
 *    outstanding; it does not add to it. This is the single most common way a
 *    hand-kept ledger goes wrong.
 */

import {
  compareDates,
  type CalendarDate,
  type PeriodKey,
  periodEnd,
  periodStart,
} from '@/lib/dates';
import { ZERO, negatePaise, paise, sumPaise, type Paise } from '@/lib/money';
import type { Transaction, TransactionKind } from '@/types/models';

/* -------------------------------------------------------------------------- */
/* The effect of a single entry                                                */
/* -------------------------------------------------------------------------- */

/** True when an expense is money you are owed back, rather than a cost record. */
export function isReceivableExpense(transaction: Transaction): boolean {
  return (
    transaction.kind === 'expense_paid' &&
    transaction.reimbursable === true &&
    transaction.fundedFrom === 'own'
  );
}

/**
 * What one entry contributes to the balance, from the employee's side:
 * positive means the shop owes you more.
 *
 * A voided entry contributes nothing. It is kept rather than deleted so the
 * history of a disputed balance survives the correction.
 */
export function transactionEffect(transaction: Transaction): Paise {
  if (transaction.voidedAt != null) return ZERO;

  switch (transaction.kind) {
    case 'salary_earned':
    case 'allowance_earned':
    case 'other_income_earned':
      return transaction.amount;

    case 'expense_paid':
      return isReceivableExpense(transaction) ? transaction.amount : ZERO;

    case 'advance_received':
    case 'salary_payment_received':
    case 'reimbursement_received':
    case 'deduction':
      return negatePaise(transaction.amount);

    case 'adjustment':
      // Already signed; an adjustment of -450 reduces the balance by 450.
      return transaction.amount;
  }
}

/* -------------------------------------------------------------------------- */
/* Totals                                                                      */
/* -------------------------------------------------------------------------- */

export interface LedgerTotals {
  readonly salaryEarned: Paise;
  readonly allowanceEarned: Paise;
  readonly otherIncomeEarned: Paise;
  /** Expenses you funded that the shop owes back. Counts towards the balance. */
  readonly reimbursableExpenses: Paise;
  /** Expenses that do not create a receivable. Reported, never added. */
  readonly nonReimbursableExpenses: Paise;
  readonly advancesReceived: Paise;
  readonly salaryPaymentsReceived: Paise;
  readonly reimbursementsReceived: Paise;
  readonly deductions: Paise;
  /** Net of the signed adjustments, which may be negative. */
  readonly adjustments: Paise;
}

export const EMPTY_TOTALS: LedgerTotals = {
  salaryEarned: ZERO,
  allowanceEarned: ZERO,
  otherIncomeEarned: ZERO,
  reimbursableExpenses: ZERO,
  nonReimbursableExpenses: ZERO,
  advancesReceived: ZERO,
  salaryPaymentsReceived: ZERO,
  reimbursementsReceived: ZERO,
  deductions: ZERO,
  adjustments: ZERO,
};

/** The same shape as `LedgerTotals`, but mutable and in plain numbers. */
type TotalsAccumulator = { -readonly [K in keyof LedgerTotals]: number };

function accumulate(totals: TotalsAccumulator, transaction: Transaction): void {
  const amount = transaction.amount;
  switch (transaction.kind) {
    case 'salary_earned':
      totals.salaryEarned += amount;
      break;
    case 'allowance_earned':
      totals.allowanceEarned += amount;
      break;
    case 'other_income_earned':
      totals.otherIncomeEarned += amount;
      break;
    case 'expense_paid':
      if (isReceivableExpense(transaction)) totals.reimbursableExpenses += amount;
      else totals.nonReimbursableExpenses += amount;
      break;
    case 'advance_received':
      totals.advancesReceived += amount;
      break;
    case 'salary_payment_received':
      totals.salaryPaymentsReceived += amount;
      break;
    case 'reimbursement_received':
      totals.reimbursementsReceived += amount;
      break;
    case 'deduction':
      totals.deductions += amount;
      break;
    case 'adjustment':
      totals.adjustments += amount;
      break;
  }
}

/* -------------------------------------------------------------------------- */
/* Period computation                                                          */
/* -------------------------------------------------------------------------- */

export interface LedgerPeriod {
  readonly openingBalance: Paise;
  readonly totals: LedgerTotals;
  /** Everything that increased what the shop owes you. */
  readonly totalEarned: Paise;
  /** Everything that reduced it. */
  readonly totalReduced: Paise;
  /** `opening + earned - reduced`. Positive means the shop owes you. */
  readonly closingBalance: Paise;
  /** The entries this period actually counted, in ledger order. */
  readonly entries: readonly Transaction[];
  /** Entries recognised here but dated in an earlier, sealed period. */
  readonly priorPeriodAdjustments: readonly Transaction[];
  readonly entryCount: number;
}

/**
 * Entries are ordered by `sortKey`, which is
 * `transactionDate#clientCreatedAtMs#id`.
 *
 * Deliberately not `createdAt`: `serverTimestamp()` reads back as null until
 * the server acknowledges the write, which offline can be hours. An entry
 * ordered by `createdAt` would sit in the wrong place, or vanish from a sorted
 * list entirely, until it synced. `sortKey` is final the moment the write is
 * queued.
 */
export function compareEntries(a: Transaction, b: Transaction): number {
  return a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0;
}

/** Live entries only: voided ones are excluded from every calculation. */
export function liveEntries(transactions: readonly Transaction[]): Transaction[] {
  return transactions.filter((transaction) => transaction.voidedAt == null);
}

/**
 * Which entries belong to a statement period.
 *
 * Membership is decided by `recognitionDate`, not `transactionDate`. They are
 * the same for an ordinary entry. They differ only when something is entered
 * late, dated inside a period that has already been sealed: that entry keeps
 * its true `transactionDate` for the record, but is *recognised* in the first
 * open day, so it lands in the current statement instead of rewriting a sealed
 * one.
 */
export function entriesForPeriod(
  transactions: readonly Transaction[],
  from: CalendarDate,
  to: CalendarDate,
): Transaction[] {
  return liveEntries(transactions)
    .filter(
      (transaction) =>
        compareDates(transaction.recognitionDate, from) >= 0 &&
        compareDates(transaction.recognitionDate, to) <= 0,
    )
    .sort(compareEntries);
}

/**
 * Computes a period from an opening balance and the entries recognised in it.
 *
 * The caller supplies entries already narrowed to the period — normally via
 * `entriesForPeriod` — because the query that loads them is also narrowed, and
 * silently re-filtering here would hide a mismatch between the two.
 */
export function computePeriod(
  openingBalance: Paise,
  entries: readonly Transaction[],
): LedgerPeriod {
  const live = liveEntries(entries).sort(compareEntries);

  const accumulator: TotalsAccumulator = { ...EMPTY_TOTALS };
  for (const entry of live) accumulate(accumulator, entry);

  const totals: LedgerTotals = {
    salaryEarned: paise(accumulator.salaryEarned),
    allowanceEarned: paise(accumulator.allowanceEarned),
    otherIncomeEarned: paise(accumulator.otherIncomeEarned),
    reimbursableExpenses: paise(accumulator.reimbursableExpenses),
    nonReimbursableExpenses: paise(accumulator.nonReimbursableExpenses),
    advancesReceived: paise(accumulator.advancesReceived),
    salaryPaymentsReceived: paise(accumulator.salaryPaymentsReceived),
    reimbursementsReceived: paise(accumulator.reimbursementsReceived),
    deductions: paise(accumulator.deductions),
    adjustments: paise(accumulator.adjustments),
  };

  // Positive adjustments count as earned and negative ones as reduced, so the
  // two headline figures stay non-negative and read naturally in the UI.
  const adjustmentUp = totals.adjustments > 0 ? totals.adjustments : ZERO;
  const adjustmentDown = totals.adjustments < 0 ? paise(-totals.adjustments) : ZERO;

  const totalEarned = sumPaise([
    totals.salaryEarned,
    totals.allowanceEarned,
    totals.otherIncomeEarned,
    totals.reimbursableExpenses,
    adjustmentUp,
  ]);

  const totalReduced = sumPaise([
    totals.advancesReceived,
    totals.salaryPaymentsReceived,
    totals.reimbursementsReceived,
    totals.deductions,
    adjustmentDown,
  ]);

  return {
    openingBalance,
    totals,
    totalEarned,
    totalReduced,
    closingBalance: paise(openingBalance + totalEarned - totalReduced),
    entries: live,
    priorPeriodAdjustments: live.filter((entry) => entry.isPriorPeriodAdjustment),
    entryCount: live.length,
  };
}

/** Convenience wrapper for a whole calendar month. */
export function computeMonth(
  openingBalance: Paise,
  transactions: readonly Transaction[],
  period: PeriodKey,
): LedgerPeriod {
  return computePeriod(
    openingBalance,
    entriesForPeriod(transactions, periodStart(period), periodEnd(period)),
  );
}

/* -------------------------------------------------------------------------- */
/* Current balance                                                             */
/* -------------------------------------------------------------------------- */

/**
 * What a shop owes you as of a given day — the dashboard's headline figure.
 *
 * This filters on `transactionDate`, not `recognitionDate`. The question being
 * answered is "how much is outstanding right now", and that depends on what has
 * actually happened, not on which statement an entry was assigned to. An entry
 * backdated into a sealed period still represents real money that changed
 * hands, so it counts from its true date.
 *
 * Entries dated in the future are excluded: a salary you have not yet earned is
 * not money owed today.
 */
export function balanceAsOf(
  openingBalance: Paise,
  transactions: readonly Transaction[],
  asOf: CalendarDate,
): Paise {
  const effects = liveEntries(transactions)
    .filter((transaction) => compareDates(transaction.transactionDate, asOf) <= 0)
    .map(transactionEffect);
  return paise(openingBalance + sumPaise(effects));
}

/**
 * The balance a period opens at: everything recognised before its first day.
 *
 * Deliberately filtered on `recognitionDate`, not `transactionDate`, because
 * that is how `entriesForPeriod` decides membership. Mixing the two would count
 * a backdated entry twice on a statement — once inside the opening figure and
 * again as a row — and the running balance would not reconcile.
 */
export function balanceBeforePeriod(
  openingBalance: Paise,
  transactions: readonly Transaction[],
  from: CalendarDate,
): Paise {
  const effects = liveEntries(transactions)
    .filter((transaction) => compareDates(transaction.recognitionDate, from) < 0)
    .map(transactionEffect);
  return paise(openingBalance + sumPaise(effects));
}

/** A row in a statement: the entry plus the balance after applying it. */
export interface RunningRow {
  readonly transaction: Transaction;
  readonly effect: Paise;
  readonly balanceAfter: Paise;
}

/** Entries in ledger order with a running balance, for a statement or a list. */
export function runningBalance(
  openingBalance: Paise,
  entries: readonly Transaction[],
): RunningRow[] {
  let balance: number = openingBalance;
  return liveEntries(entries)
    .sort(compareEntries)
    .map((transaction) => {
      const effect = transactionEffect(transaction);
      balance += effect;
      return { transaction, effect, balanceAfter: paise(balance) };
    });
}

/* -------------------------------------------------------------------------- */
/* Integrity checks                                                            */
/* -------------------------------------------------------------------------- */

export type LedgerWarning =
  | { readonly code: 'reimbursement_exceeds_expenses'; readonly excess: Paise }
  | { readonly code: 'deduction_against_advance'; readonly transactionId: string }
  | { readonly code: 'duplicate_accrual'; readonly accrualKey: string };

/**
 * Problems that arithmetic alone cannot catch, surfaced rather than corrected.
 *
 * These are the ways a ledger double-counts in practice. The app warns and lets
 * the user decide, because an automatic "fix" to a financial record that the
 * user did not ask for is worse than the inconsistency.
 */
export function findWarnings(transactions: readonly Transaction[]): LedgerWarning[] {
  const live = liveEntries(transactions);
  const warnings: LedgerWarning[] = [];

  // Being reimbursed more than you ever spent means an expense was recorded as
  // a deduction too, or a reimbursement was entered twice.
  const expenses = sumPaise(
    live.filter(isReceivableExpense).map((transaction) => transaction.amount),
  );
  const reimbursements = sumPaise(
    live
      .filter((transaction) => transaction.kind === 'reimbursement_received')
      .map((transaction) => transaction.amount),
  );
  if (reimbursements > expenses) {
    warnings.push({
      code: 'reimbursement_exceeds_expenses',
      excess: paise(reimbursements - expenses),
    });
  }

  // A deduction that recovers an advance counts the same money twice: the
  // advance already reduced the balance when it was received.
  const byId = new Map(live.map((transaction) => [transaction.id, transaction]));
  for (const transaction of live) {
    if (transaction.kind !== 'deduction' || !transaction.recoversTransactionId) continue;
    if (byId.get(transaction.recoversTransactionId)?.kind === 'advance_received') {
      warnings.push({ code: 'deduction_against_advance', transactionId: transaction.id });
    }
  }

  // Deterministic ids make this impossible through the app, but a restored
  // backup or a hand-edited document could still produce it.
  const seen = new Set<string>();
  for (const transaction of live) {
    if (!transaction.accrualKey) continue;
    if (seen.has(transaction.accrualKey)) {
      warnings.push({ code: 'duplicate_accrual', accrualKey: transaction.accrualKey });
    }
    seen.add(transaction.accrualKey);
  }

  return warnings;
}

/** Human wording for a warning, kept beside the detection so the two agree. */
export function describeWarning(warning: LedgerWarning): string {
  switch (warning.code) {
    case 'reimbursement_exceeds_expenses':
      return 'Reimbursements here add up to more than the expenses you recorded. Check whether an expense was also entered as a deduction.';
    case 'deduction_against_advance':
      return 'A deduction is recorded against an advance. The advance already reduced what the shop owes, so this counts the same money twice.';
    case 'duplicate_accrual':
      return 'The same salary or allowance appears to have been posted twice for one month.';
  }
}

/** The kinds that represent money actually changing hands. */
export const CASH_KINDS: readonly TransactionKind[] = [
  'advance_received',
  'salary_payment_received',
  'reimbursement_received',
];
