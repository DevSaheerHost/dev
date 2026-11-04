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
  inclusiveDays,
  maxDate,
  minDate,
  periodEnd,
  periodKeyOf,
  periodStart,
  type CalendarDate,
  type PeriodKey,
} from '@/lib/dates';
import { accrualId } from '@/lib/ids';
import { paise, proRataShare, type Paise } from '@/lib/money';
import type { IncomeConfig, IncomeKind, Shop, TransactionKind } from '@/types/models';

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

/** The amount earned over a covered span, by frequency. */
function amountForSpan(
  config: IncomeConfig,
  days: number,
  daysInFullPeriod: number,
): { amount: Paise; num: number; den: number; isPartial: boolean } {
  switch (config.frequency) {
    case 'monthly': {
      const isPartial = days < daysInFullPeriod;
      return {
        // One rounding step on the magnitude, so a half month of ₹18,000 is
        // ₹9,000 and not ₹8,999.99 accumulated from daily slices.
        amount: isPartial
          ? proRataShare(config.amount, days, daysInFullPeriod)
          : config.amount,
        num: days,
        den: daysInFullPeriod,
        isPartial,
      };
    }
    case 'weekly':
      return {
        amount: paise(Math.round((config.amount * days) / 7)),
        num: days,
        den: 7,
        isPartial: days % 7 !== 0,
      };
    case 'daily':
      return {
        amount: paise(config.amount * days),
        num: days,
        den: 1,
        isPartial: false,
      };
    case 'oneTime':
      return { amount: config.amount, num: 1, den: 1, isPartial: false };
  }
}

export interface ProposalContext {
  readonly shop: Shop;
  readonly configs: readonly IncomeConfig[];
  /** Accrual keys already posted, so a confirmed month is never offered twice. */
  readonly existingAccrualKeys: ReadonlySet<string>;
  /** Today, injected — this module never reads the clock. */
  readonly today: CalendarDate;
}

/**
 * Proposals for one period. Empty when the period is not finished, when the
 * shop settles in cash only, or when everything has already been posted.
 */
export function proposeForPeriod(context: ProposalContext, period: PeriodKey): AccrualProposal[] {
  const { shop, configs, existingAccrualKeys, today } = context;

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

    const key = accrualKeyFor(config.id, period);
    if (existingAccrualKeys.has(key)) continue;

    const days = inclusiveDays(coverage.from, coverage.to);
    const { amount, num, den, isPartial } = amountForSpan(config, days, fullDays);
    if (amount === 0) continue;

    proposals.push({
      id: accrualId(config.id, period),
      configId: config.id,
      accrualKey: key,
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
    });
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
