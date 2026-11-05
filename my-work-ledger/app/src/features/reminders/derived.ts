/**
 * The reminders the app works out for itself.
 *
 * Their wording and figures are derived from the ledger every time they are
 * shown, never stored, so they cannot go stale and there is nothing to
 * reconcile. Only the schedule — whether each kind is on, and at what time —
 * lives in a document.
 *
 * Three of the four clear themselves by being acted on: tick the day and the
 * daily nudge goes, confirm the month and the month-end nudge goes, settle and
 * the settle nudge goes. That is why none of them needs a stored "dismissed"
 * flag, which would be one more thing able to drift out of step with the facts.
 *
 * Pure: `today` is injected and nothing here reads the clock or Firestore.
 */

import {
  addDays,
  addMonths,
  clampDayToMonth,
  compareDates,
  formatPeriod,
  inclusiveDays,
  periodKeyOf,
  type CalendarDate,
} from '@/lib/dates';
import { formatPaise, type Paise } from '@/lib/money';
import type { DayRecord, IncomeConfig, Reminder, Shop, Transaction } from '@/types/models';

import { isDailySettled, livePosition, toDayMap } from '../ledger/attendance';
import { computeShopFigures } from '../ledger/figures';
import { defaultSettlementRange } from '../ledger/settlement';

/** How many days before salary day the heads-up appears. */
export const SALARY_NOTICE_DAYS = 7;

export type DerivedKind = 'salaryDueSoon' | 'monthEnded' | 'dailyTick' | 'settleReady';

/** Where tapping a reminder should take you — the place that clears it. */
export type ReminderAction =
  | { readonly type: 'openShop'; readonly shopId: string }
  | { readonly type: 'settle'; readonly shopId: string }
  | { readonly type: 'confirmMonth'; readonly shopId: string }
  | { readonly type: 'tickToday'; readonly shopId: string };

export interface DerivedReminder {
  /** Stable for a given kind, shop and day, so "already notified" can be tracked. */
  readonly id: string;
  readonly kind: DerivedKind;
  readonly shopId: string;
  readonly shopName: string;
  readonly title: string;
  readonly body: string;
  /** Higher sorts first. */
  readonly urgency: number;
  readonly action: ReminderAction;
}

export interface ShopSnapshot {
  readonly shop: Shop;
  readonly transactions: readonly Transaction[];
  readonly configs: readonly IncomeConfig[];
  readonly days: readonly DayRecord[];
}

/** Which automatic kinds are switched on, keyed by kind. */
export type ReminderPrefs = ReadonlyMap<DerivedKind, Pick<Reminder, 'enabled' | 'time'>>;

function isOn(prefs: ReminderPrefs, kind: DerivedKind): boolean {
  // Absent means not configured yet, which is on: the user asked for all four.
  return prefs.get(kind)?.enabled ?? true;
}

function owedSentence(shopName: string, balance: Paise): string {
  if (balance > 0) return `${shopName} owes you ${formatPaise(balance)}`;
  if (balance < 0) return `You owe ${shopName} ${formatPaise(balance)}`;
  return `${shopName} is square with you`;
}

/**
 * Everything that needs doing right now, across every shop.
 *
 * A shop that is archived, or that settles in cash only, produces nothing:
 * there is no salary to be due and nothing accrues to chase.
 */
export function deriveReminders(args: {
  readonly shops: readonly ShopSnapshot[];
  readonly prefs: ReminderPrefs;
  readonly today: CalendarDate;
}): DerivedReminder[] {
  const { shops, prefs, today } = args;
  const reminders: DerivedReminder[] = [];

  for (const { shop, transactions, configs, days } of shops) {
    if (shop.status !== 'active') continue;

    const figures = computeShopFigures({ shop, transactions, configs, days, today });
    const dayMap = toDayMap(days);

    /* ---- a week before salary day ---------------------------------------- */
    if (isOn(prefs, 'salaryDueSoon') && shop.settlementMode === 'accrual') {
      const payDay = clampDayToMonth(periodKeyOf(today), shop.salaryPayDay);
      const away = inclusiveDays(today, payDay) - 1;
      if (away > 0 && away <= SALARY_NOTICE_DAYS) {
        reminders.push({
          id: `salaryDueSoon:${shop.id}:${today}`,
          kind: 'salaryDueSoon',
          shopId: shop.id,
          shopName: shop.name,
          title: `Salary from ${shop.name} in ${away} day${away === 1 ? '' : 's'}`,
          body: `${owedSentence(shop.name, figures.balance)} so far.`,
          urgency: 2,
          action: { type: 'openShop', shopId: shop.id },
        });
      }
    }

    /* ---- the month is over, ask for your money --------------------------- */
    if (isOn(prefs, 'monthEnded') && figures.proposals.length > 0) {
      const lastMonth = addMonths(periodKeyOf(today), -1);
      reminders.push({
        id: `monthEnded:${shop.id}:${lastMonth}`,
        kind: 'monthEnded',
        shopId: shop.id,
        shopName: shop.name,
        title: `${formatPeriod(lastMonth)} is finished at ${shop.name}`,
        body: `${owedSentence(shop.name, figures.balance)}. Confirm the month and ask for it.`,
        urgency: 4,
        action: { type: 'confirmMonth', shopId: shop.id },
      });
    }

    /* ---- tick today's food money and attendance -------------------------- */
    if (isOn(prefs, 'dailyTick') && shop.settlementMode === 'accrual') {
      const dailyConfigs = configs.filter(isDailySettled);
      const record = dayMap.get(today);
      const started = compareDates(today, shop.joiningDate) >= 0;
      const untouched = !record || (!record.off && record.allowancesReceived.length === 0);

      if (dailyConfigs.length > 0 && started && untouched) {
        const position = livePosition({
          shop,
          configs,
          days: dayMap,
          period: periodKeyOf(today),
          today,
        });
        const outstanding = position.lines
          .filter((line) => line.isDailySettled)
          .reduce((total, line) => total + line.outstanding, 0);

        reminders.push({
          id: `dailyTick:${shop.id}:${today}`,
          kind: 'dailyTick',
          shopId: shop.id,
          shopName: shop.name,
          title: `Did you get your ${dailyConfigs[0]?.label.toLowerCase() ?? 'allowance'} today?`,
          body:
            outstanding > 0
              ? `${formatPaise(outstanding as Paise)} is still owed for days you have not ticked at ${shop.name}.`
              : `Tick today at ${shop.name}, or mark it as a day off.`,
          urgency: 1,
          action: { type: 'tickToday', shopId: shop.id },
        });
      }
    }

    /* ---- a period is waiting to be settled ------------------------------- */
    if (isOn(prefs, 'settleReady')) {
      const range = defaultSettlementRange(shop, today);
      if (range) {
        reminders.push({
          id: `settleReady:${shop.id}:${range.to}`,
          kind: 'settleReady',
          shopId: shop.id,
          shopName: shop.name,
          title: `${shop.name} is ready to settle`,
          body: `Everything up to ${range.to} can be put on a statement you can hand over.`,
          urgency: 3,
          action: { type: 'settle', shopId: shop.id },
        });
      }
    }
  }

  return reminders.sort(
    (a, b) => b.urgency - a.urgency || a.shopName.localeCompare(b.shopName),
  );
}

/**
 * The derived reminders whose time of day has come.
 *
 * Shown in the app regardless — a list of what needs doing is useful whenever
 * you look — but only *notified* once the hour arrives, so a phone does not
 * buzz at breakfast about something meant for the evening.
 */
export function dueForNotification(
  reminders: readonly DerivedReminder[],
  prefs: ReminderPrefs,
  nowMinutes: number,
): DerivedReminder[] {
  return reminders.filter((reminder) => {
    const time = prefs.get(reminder.kind)?.time ?? '20:00';
    const [hours = '0', minutes = '0'] = time.split(':');
    return nowMinutes >= Number(hours) * 60 + Number(minutes);
  });
}

/** The day after which a `salaryDueSoon` reminder starts appearing. */
export function salaryNoticeStart(shop: Shop, today: CalendarDate): CalendarDate {
  return addDays(clampDayToMonth(periodKeyOf(today), shop.salaryPayDay), -SALARY_NOTICE_DAYS);
}
