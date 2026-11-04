/**
 * Salary and allowance accrual.
 *
 * This module *proposes*. It never writes. The app shows each proposal as a
 * card the user confirms, because a ledger that silently mints money entries is
 * a ledger nobody can audit — and because a device with a wrong clock would
 * otherwise invent months that have not happened.
 *
 * Three decisions shape everything here:
 *
 *  1. **A span is only proposed once it has fully elapsed.** November's salary
 *     appears on 1 December, not on the salary pay day partway through
 *     November, because on 15 November only half of it has been earned.
 *     Proposing a whole month early would need a mid-month top-up later, which
 *     is exactly how double entries happen. The shop's `salaryPayDay` drives
 *     the *reminder*, which is its natural job.
 *
 *  2. **Configs are effective-dated, never edited in place.** A raise creates a
 *     new config rather than rewriting the old one, so what was earned last
 *     month does not change retroactively when this month's rate does.
 *
 *  3. **Ids are deterministic.** `acc_{configId}_{YYYYMM}` means two attempts
 *     to post one month's salary are not merely discouraged, they are the same
 *     document. Duplicate prevention is structural, not hopeful.
 */

import {
  addMonths,
  compareDates,
  daysInMonth,
  maxDate,
  minDate,
  periodEnd,
  periodKeyOf,
  periodStart,
  type CalendarDate,
  type PeriodKey,
} from '@/lib/dates';
import { accrualId, allowanceReceiptId } from '@/lib/ids';
import { paise, type Paise } from '@/lib/money';
import type { IncomeConfig, IncomeKind, Shop, TransactionKind } from '@/types/models';

import {
  amountForWorkedDays,
  countDays,
  isDailySettled,
  receivedKeyFor,
  settledDays,
  type DayMap,
} from './attendance';

/** Guards against an absurd `joiningDate` producing an unbounded scan. */
export const MAX_PERIODS_SCANNED = 60;

export interface AccrualProposal {
  /** The deterministic document id this will be written under. */
  readonly id: string;
  readonly configId: string;
  readonly accrualKey: string;
  readonly kind: TransactionKind;
  readonly label: string;
  readonly amount: Paise;
  readonly period: PeriodKey;
  /** The day it is earned through — the last day of the covered span. */
  readonly transactionDate: CalendarDate;
  readonly coverageFrom: CalendarDate;
  readonly coverageTo: CalendarDate;
  /** Days covered, and days in the full span, for a pro-rated proposal. */
  readonly prorationNum: number;
  readonly prorationDen: number;
  readonly isPartial: boolean;
  /** The config's full-period amount, for showing what the pro-rata came from. */
  readonly fullAmount: Paise;
  /**
   * `earned` is what the shop owes for the period. `received` is the other half
   * of a daily allowance: the days the money actually changed hands. Keeping
   * them separate means the ledger shows both sides rather than a net figure
   * that hides how many days are still outstanding.
   */
  readonly settles: 'earned' | 'received';
}

const KIND_FOR_INCOME: Readonly<Record<IncomeKind, TransactionKind>> = {
  salary: 'salary_earned',
  allowance: 'allowance_earned',
  other: 'other_income_earned',
};

/** The `accrualKey` stored on the transaction, for duplicate detection. */
export function accrualKeyFor(configId: string, period: PeriodKey): string {
  return `${configId}:${period}`;
}

function isConfigLive(config: IncomeConfig): boolean {
  return config.active;
}

/**
 * The span of a period a config actually covers, after clipping to the config's
 * effective dates, the day you joined, and the day the opening balance starts
 * from. Returns null when the config does not touch the period at all.
 *
 * Clipping to `openingBalanceAsOf` matters: anything before it is already
 * baked into the opening figure, so accruing it again would count it twice.
 */
export function coverageInPeriod(
  shop: Shop,
  config: IncomeConfig,
  period: PeriodKey,
): { from: CalendarDate; to: CalendarDate } | null {
  const earliest = maxDate(
    maxDate(periodStart(period), config.effectiveFrom),
    maxDate(shop.joiningDate, shop.openingBalanceAsOf),
  );
  const latest = config.effectiveTo
    ? minDate(periodEnd(period), config.effectiveTo)
    : periodEnd(period);

  if (compareDates(earliest, latest) > 0) return null;
  return { from: earliest, to: latest };
}

/**
 * How a covered span is divided, for showing the user what they are confirming.
 *
 * The amount itself comes from `amountForWorkedDays` in `attendance.ts`, which
 * is the single place that turns worked days into money — the live "earned so
 * far" figure and the month-end proposal must never disagree, and they cannot
 * if they go through the same function.
 */
function prorationForSpan(
  config: IncomeConfig,
  workedDays: number,
  daysInFullPeriod: number,
): { num: number; den: number; isPartial: boolean } {
  switch (config.frequency) {
    case 'monthly':
      return {
        num: workedDays,
        den: daysInFullPeriod,
        isPartial: workedDays < daysInFullPeriod,
      };
    case 'weekly':
      return { num: workedDays, den: 7, isPartial: workedDays % 7 !== 0 };
    case 'daily':
      return { num: workedDays, den: 1, isPartial: false };
    case 'oneTime':
      return { num: 1, den: 1, isPartial: false };
  }
}

export interface ProposalContext {
  readonly shop: Shop;
  readonly configs: readonly IncomeConfig[];
  /** Accrual keys already posted, so a confirmed month is never offered twice. */
  readonly existingAccrualKeys: ReadonlySet<string>;
  /**
   * Attendance and daily-allowance receipts. A day marked off does not accrue,
   * so the month comes to less than the full amount; a day ticked means the
   * food money for it actually changed hands.
   */
  readonly days: DayMap;
  /** Today, injected — this module never reads the clock. */
  readonly today: CalendarDate;
}

/**
 * Proposals for one period. Empty when the period is not finished, when the
 * shop settles in cash only, or when everything has already been posted.
 */
export function proposeForPeriod(context: ProposalContext, period: PeriodKey): AccrualProposal[] {
  const { shop, configs, existingAccrualKeys, days, today } = context;

  // A daily-wage shop accrues nothing: an unpaid day is not a receivable, so
  // only actual payments are ever recorded.
  if (shop.settlementMode === 'cashOnly') return [];

  const proposals: AccrualProposal[] = [];
  const fullDays = daysInMonth(Number(period.slice(0, 4)), Number(period.slice(5, 7)));

  for (const config of configs) {
    if (!isConfigLive(config)) continue;

    // A one-time payment belongs to the period it falls in, and nowhere else.
    if (config.frequency === 'oneTime' && periodKeyOf(config.effectiveFrom) !== period) continue;

    const coverage = coverageInPeriod(shop, config, period);
    if (!coverage) continue;

    // The span must be over. Proposing a full month on its fifth day would
    // credit three weeks that have not been worked.
    if (compareDates(today, coverage.to) <= 0) continue;

    // Days off do not accrue, so the month comes to less than the full amount.
    // `oneTime` is a lump sum, not day-based, so attendance does not touch it.
    const worked =
      config.frequency === 'oneTime'
        ? 1
        : countDays({ from: coverage.from, to: coverage.to }, days).worked;

    const earnedKey = accrualKeyFor(config.id, period);
    if (!existingAccrualKeys.has(earnedKey)) {
      const amount = amountForWorkedDays(config, worked, period);
      if (amount !== 0) {
        const { num, den, isPartial } = prorationForSpan(config, worked, fullDays);
        proposals.push({
          id: accrualId(config.id, period),
          configId: config.id,
          accrualKey: earnedKey,
          kind: KIND_FOR_INCOME[config.kind],
          label: config.label,
          amount,
          period,
          transactionDate: coverage.to,
          coverageFrom: coverage.from,
          coverageTo: coverage.to,
          prorationNum: num,
          prorationDen: den,
          isPartial,
          fullAmount: config.amount,
          settles: 'earned',
        });
      }
    }

    // The other half of a daily allowance: the days the food money was
    // actually handed over. Posted as a payment received, so the month's
    // ledger shows both what was owed and what arrived rather than a net
    // figure that hides how many days are still outstanding.
    if (isDailySettled(config)) {
      const receivedKey = receivedKeyFor(config.id, period);
      if (existingAccrualKeys.has(receivedKey)) continue;

      const settled = settledDays({ from: coverage.from, to: coverage.to }, days, config.id);
      if (settled === 0) continue;

      proposals.push({
        id: allowanceReceiptId(config.id, period),
        configId: config.id,
        accrualKey: receivedKey,
        kind: 'salary_payment_received',
        label: `${config.label} received`,
        amount: amountForWorkedDays(config, settled, period),
        period,
        transactionDate: coverage.to,
        coverageFrom: coverage.from,
        coverageTo: coverage.to,
        prorationNum: settled,
        prorationDen: worked,
        isPartial: settled < worked,
        fullAmount: config.amount,
        settles: 'received',
      });
    }
  }

  return proposals;
}

/**
 * Every period from the shop's start up to today that still owes an accrual.
 *
 * Walking back rather than only looking at last month matters: someone who has
 * not opened the app since July should be offered July through November, not
 * just November, and should not have to discover the gap themselves.
 */
export function proposeOutstanding(context: ProposalContext): AccrualProposal[] {
  const { shop, today } = context;

  const start = periodKeyOf(maxDate(shop.joiningDate, shop.openingBalanceAsOf));
  const end = periodKeyOf(today);

  const proposals: AccrualProposal[] = [];
  let period = start;
  for (let scanned = 0; scanned < MAX_PERIODS_SCANNED; scanned += 1) {
    proposals.push(...proposeForPeriod(context, period));
    if (period >= end) break;
    period = addMonths(period, 1);
  }

  return proposals;
}

/** What a proposal is worth in total, for a "post all" summary. */
export function totalProposed(proposals: readonly AccrualProposal[]): Paise {
  let total = 0;
  for (const proposal of proposals) total += proposal.amount;
  return paise(total);
}

/**
 * A sentence explaining a proposal, so the user confirms something they can
 * check rather than a bare figure. Pro-rata is always spelled out.
 */
export function describeProposal(proposal: AccrualProposal): string {
  if (!proposal.isPartial) return proposal.label;
  return `${proposal.label} — ${proposal.prorationNum} of ${proposal.prorationDen} days`;
}
