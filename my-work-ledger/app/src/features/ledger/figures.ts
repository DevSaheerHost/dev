/**
 * The figures every screen shows, derived in one place.
 *
 * The dashboard, the shop page and a future PDF must never disagree about what
 * a shop owes. The only way to guarantee that is for all of them to call the
 * same function, so this is it — pure, with `today` injected, and tested
 * directly rather than through the UI.
 *
 * The headline balance has two parts:
 *
 *   posted    what the ledger actually contains, from `engine.balanceAsOf`
 *   unposted  salary and allowances earned so far whose month-end entry has
 *             not been confirmed yet, from `attendance.unpostedEarnings`
 *
 * Adding the second is what makes the number climb daily. Double counting is
 * avoided by keying on the accrual: once a month has been posted it is a real
 * transaction, so its live estimate is dropped.
 */

import { periodKeyOf, periodStart, type CalendarDate, type PeriodKey } from '@/lib/dates';
import { paise, type Paise } from '@/lib/money';
import type { DayRecord, IncomeConfig, Shop, Transaction } from '@/types/models';

import {
  livePosition,
  toDayMap,
  unpostedEarnings,
  type LivePosition,
} from './attendance';
import {
  proposeOutstanding,
  type AccrualProposal,
} from './accrual';
import {
  balanceAsOf,
  balanceBeforePeriod,
  computeMonth,
  findWarnings,
  liveEntries,
  type LedgerPeriod,
  type LedgerWarning,
} from './engine';

export interface ShopFigures {
  readonly shop: Shop;
  readonly period: PeriodKey;
  /** What the stored ledger says, with nothing estimated. */
  readonly postedBalance: Paise;
  /** Earned so far this month that has not been confirmed into an entry yet. */
  readonly unposted: Paise;
  /** The headline: what the shop owes right now. `posted + unposted`. */
  readonly balance: Paise;
  readonly position: LivePosition;
  /**
   * The period on screen. Its `openingBalance` is what was carried into that
   * month, not the shop's original opening figure, so a running balance beside
   * the rows reconciles to the closing total.
   */
  readonly month: LedgerPeriod;
  /** Month-end accruals waiting for a tap, oldest first. */
  readonly proposals: readonly AccrualProposal[];
  readonly warnings: readonly LedgerWarning[];
  /**
   * The most recent day this shop has a live entry for, or null if it has
   * none. Shown as "3 days ago" on the shop list, which is the quickest way to
   * spot a shop nobody has recorded anything against in a fortnight.
   */
  readonly lastActivity: CalendarDate | null;
}

/** The latest `transactionDate` among live entries. Null when there are none. */
function lastActivityDate(transactions: readonly Transaction[]): CalendarDate | null {
  let latest: CalendarDate | null = null;
  for (const entry of liveEntries(transactions)) {
    if (latest === null || entry.transactionDate > latest) latest = entry.transactionDate;
  }
  return latest;
}

/** Accrual keys already present in the ledger, so nothing is counted twice. */
export function postedAccrualKeys(transactions: readonly Transaction[]): Set<string> {
  const keys = new Set<string>();
  for (const transaction of liveEntries(transactions)) {
    if (transaction.accrualKey) keys.add(transaction.accrualKey);
  }
  return keys;
}

export function computeShopFigures(args: {
  readonly shop: Shop;
  readonly transactions: readonly Transaction[];
  readonly configs: readonly IncomeConfig[];
  readonly days: readonly DayRecord[];
  readonly today: CalendarDate;
  /** The month on screen. Defaults to the one `today` falls in. */
  readonly period?: PeriodKey;
}): ShopFigures {
  const { shop, transactions, configs, days, today } = args;
  const period = args.period ?? periodKeyOf(today);

  const dayMap = toDayMap(days);
  const posted = postedAccrualKeys(transactions);

  // The live position is always for the *current* month, whatever month is on
  // screen: "what is owed right now" does not change because the user is
  // looking at September.
  const currentPosition = livePosition({
    shop,
    configs,
    days: dayMap,
    period: periodKeyOf(today),
    today,
  });

  const postedBalance = balanceAsOf(shop.openingBalance, transactions, today);

  const proposals = proposeOutstanding({
    shop,
    configs,
    existingAccrualKeys: posted,
    days: dayMap,
    today,
  });

  // Unconfirmed money has two sources, and both must count or the balance
  // lurches. The live figure covers the month in progress. The proposals cover
  // every *finished* month still waiting for a tap — without them the balance
  // would visibly drop on the 1st, when last month stops being "live" but has
  // not yet become an entry.
  //
  // These cannot overlap: a span is only proposed once it has ended, and the
  // current month has not.
  const unposted = paise(
    unpostedEarnings(currentPosition, posted) +
      proposals.reduce(
        (total, proposal) =>
          proposal.settles === 'received' ? total - proposal.amount : total + proposal.amount,
        0,
      ),
  );

  return {
    shop,
    period,
    postedBalance,
    unposted,
    balance: paise(postedBalance + unposted),
    position:
      period === periodKeyOf(today)
        ? currentPosition
        : livePosition({ shop, configs, days: dayMap, period, today }),
    month: computeMonth(
      balanceBeforePeriod(shop.openingBalance, transactions, periodStart(period)),
      transactions,
      period,
    ),
    proposals,
    warnings: findWarnings(transactions),
    lastActivity: lastActivityDate(transactions),
  };
}

/** Totals across every shop, for the dashboard header. */
export interface CombinedFigures {
  /** Sum of the shops that owe you. */
  readonly owedToYou: Paise;
  /** Sum, as a positive number, of the shops you owe. */
  readonly owedByYou: Paise;
  /** `owedToYou - owedByYou`. */
  readonly net: Paise;
  /** Earned today across every shop, before anything is confirmed. */
  readonly unposted: Paise;
}

export function combineFigures(figures: readonly ShopFigures[]): CombinedFigures {
  let owedToYou = 0;
  let owedByYou = 0;
  let unposted = 0;

  for (const shop of figures) {
    if (shop.balance > 0) owedToYou += shop.balance;
    else owedByYou += -shop.balance;
    unposted += shop.unposted;
  }

  return {
    owedToYou: paise(owedToYou),
    owedByYou: paise(owedByYou),
    net: paise(owedToYou - owedByYou),
    unposted: paise(unposted),
  };
}
