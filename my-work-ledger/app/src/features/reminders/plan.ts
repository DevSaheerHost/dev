/**
 * What to hand the phone's alarm scheduler.
 *
 * A web notification only exists while a tab is open. An Android local
 * notification is an alarm registered with the operating system: it fires
 * whether or not the app is running, which is the whole reason the Android
 * build exists. The cost is that **the text is fixed when the alarm is set**,
 * not when it goes off.
 *
 * That changes what a scheduled reminder may say. `derived.ts` can put the
 * balance in a reminder because it is rebuilt from the ledger every time it is
 * shown. A notification scheduled for the 1st of next month cannot: by then the
 * figure would be a fortnight stale, and a wrong amount in a notification is
 * worse than no notification. So everything planned here is phrased as a
 * question or an instruction that stays true — "did you get your food money
 * today?", "October is over at Blue Mart" — and the amounts live in the app,
 * one tap away.
 *
 * The plan covers a rolling horizon and is rebuilt every time the app is
 * opened or resumed, so a reminder for a shop that has since been archived, or
 * a month already confirmed, is withdrawn long before it would have fired.
 *
 * Pure: no Capacitor, no clock, no Firestore. `now` is an argument.
 */

import {
  addDays,
  addMonths,
  clampDayToMonth,
  compareDates,
  monthName,
  periodKeyOf,
  type CalendarDate,
  type PeriodKey,
} from '@/lib/dates';
import type { Reminder, SettlementMode, ShopStatus } from '@/types/models';

import { SALARY_NOTICE_DAYS, type DerivedKind } from './derived';
import { DEFAULT_REMINDER_TIME, isDueOn } from './schedule';

/** How far ahead alarms are registered. Rebuilt on every app open. */
export const PLAN_HORIZON_DAYS = 21;

/** The most alarms to register at once, however many the horizon produces. */
export const MAX_PLANNED = 64;

export interface PlanShop {
  readonly id: string;
  readonly name: string;
  readonly status: ShopStatus;
  readonly settlementMode: SettlementMode;
  readonly salaryPayDay: number;
  /** True when the shop has a daily allowance that gets ticked off. */
  readonly hasDailyAllowance: boolean;
}

export interface PlannedNotification {
  /** Stable 31-bit id derived from `key`, which is what Android schedules on. */
  readonly id: number;
  /** `kind|date[|shop]` — stable, readable, and what the id is hashed from. */
  readonly key: string;
  readonly title: string;
  readonly body: string;
  readonly date: CalendarDate;
  /** `HH:MM`, local wall time. */
  readonly time: string;
}

export interface PlanClock {
  readonly date: CalendarDate;
  /** `HH:MM`. Anything already past today is not worth an alarm. */
  readonly time: string;
}

/**
 * FNV-1a, masked to 31 bits.
 *
 * Android notification ids are signed ints, and rescheduling must land on the
 * same id as last time or the tray fills with duplicates. A hash of a stable
 * key gives that without storing a counter anywhere.
 */
export function planId(key: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 0x7fffffff;
}

/** Shops that can produce a reminder at all. */
function liveShops(shops: readonly PlanShop[]): PlanShop[] {
  return shops.filter((shop) => shop.status === 'active');
}

/** "Blue Mart", "Blue Mart and Corner Store", "Blue Mart and 3 others". */
function nameList(shops: readonly PlanShop[]): string {
  const names = shops.map((shop) => shop.name);
  if (names.length === 0) return '';
  if (names.length === 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]} and ${names.length - 1} others`;
}

/**
 * The schedule for one of the four automatic kinds, or null when it is off.
 */
function settingFor(
  reminders: readonly Reminder[],
  kind: DerivedKind,
): { enabled: boolean; time: string } | null {
  const stored = reminders.find((reminder) => reminder.kind === kind);
  // Absent means never configured, which is on — the four are on by default,
  // and `derived.ts` treats an absent setting the same way.
  if (!stored) return { enabled: true, time: DEFAULT_REMINDER_TIME };
  return stored.enabled ? { enabled: true, time: stored.time } : null;
}

/** Every date from today to the end of the horizon, inclusive. */
function horizonDates(from: CalendarDate, days: number): CalendarDate[] {
  const dates: CalendarDate[] = [];
  for (let offset = 0; offset <= days; offset += 1) dates.push(addDays(from, offset));
  return dates;
}

/** The first of each month the horizon touches, today's month included. */
function monthStartsIn(dates: readonly CalendarDate[]): CalendarDate[] {
  const starts: CalendarDate[] = [];
  for (const date of dates) if (date.endsWith('-01')) starts.push(date);
  return starts;
}

export function planNotifications(args: {
  readonly reminders: readonly Reminder[];
  readonly shops: readonly PlanShop[];
  readonly now: PlanClock;
  readonly horizonDays?: number;
}): PlannedNotification[] {
  const { reminders, now } = args;
  const shops = liveShops(args.shops);
  const dates = horizonDates(now.date, args.horizonDays ?? PLAN_HORIZON_DAYS);
  const planned: PlannedNotification[] = [];

  const add = (entry: Omit<PlannedNotification, 'id'>) => {
    // An alarm for a moment that has already passed fires the instant it is
    // registered, so opening the app at 9pm would pop every 8pm reminder from
    // today. Those are the in-app list's job, not the tray's.
    if (entry.date === now.date && entry.time <= now.time) return;
    planned.push({ ...entry, id: planId(entry.key) });
  };

  /* ---- food money, every evening ----------------------------------------- */
  const daily = settingFor(reminders, 'dailyTick');
  const dailyShops = shops.filter(
    (shop) => shop.hasDailyAllowance && shop.settlementMode === 'accrual',
  );
  if (daily && dailyShops.length > 0) {
    for (const date of dates) {
      add({
        key: `dailyTick|${date}`,
        title: 'Did you get your food money today?',
        body: `Tick today at ${nameList(dailyShops)} so what you are owed stays right.`,
        date,
        time: daily.time,
      });
    }
  }

  /* ---- a week before salary day ------------------------------------------ */
  const salary = settingFor(reminders, 'salaryDueSoon');
  if (salary) {
    const accrualShops = shops.filter((shop) => shop.settlementMode === 'accrual');
    const periods = monthsTouched(dates);
    for (const shop of accrualShops) {
      for (const period of periods) {
        const payDay = clampDayToMonth(period, shop.salaryPayDay);
        const notice = addDays(payDay, -SALARY_NOTICE_DAYS);
        if (compareDates(notice, now.date) < 0) continue;
        if (compareDates(notice, dates[dates.length - 1] ?? now.date) > 0) continue;
        add({
          key: `salaryDueSoon|${notice}|${shop.id}`,
          title: `Salary from ${shop.name} in a week`,
          body: `It is normally paid on day ${shop.salaryPayDay}. Check what has built up before then.`,
          date: notice,
          time: salary.time,
        });
      }
    }
  }

  /* ---- the month turning -------------------------------------------------- */
  //
  // "The month is over" and "a period is ready to settle" both become true on
  // the 1st. At their default time they would be two notifications a minute
  // apart saying almost the same thing, so when both are on at the same hour
  // they become one. Giving either its own time splits them again, which is
  // presumably why someone would change it.
  const monthEnded = settingFor(reminders, 'monthEnded');
  const settleReady = settingFor(reminders, 'settleReady');
  const accrualShops = shops.filter((shop) => shop.settlementMode === 'accrual');

  if (accrualShops.length > 0) {
    for (const date of monthStartsIn(dates)) {
      const finished = addMonths(periodKeyOf(date), -1);
      const over = `${monthName(finished)} is over at ${nameList(accrualShops)}`;
      const combined =
        monthEnded && settleReady && monthEnded.time === settleReady.time;

      if (combined && monthEnded) {
        add({
          key: `monthTurned|${date}`,
          title: over,
          body: 'Confirm the month, then settle it into a statement you can hand over.',
          date,
          time: monthEnded.time,
        });
        continue;
      }

      if (monthEnded) {
        add({
          key: `monthEnded|${date}`,
          title: over,
          body: 'Confirm what you earned and ask for what you are owed.',
          date,
          time: monthEnded.time,
        });
      }
      if (settleReady) {
        add({
          key: `settleReady|${date}`,
          title: `${monthName(finished)} can be settled`,
          body: `Seal it into a statement for ${nameList(accrualShops)}.`,
          date,
          time: settleReady.time,
        });
      }
    }
  }

  /* ---- the user's own reminders ------------------------------------------ */
  for (const reminder of reminders) {
    if (reminder.kind !== 'custom' || !reminder.enabled) continue;
    for (const date of dates) {
      if (!isDueOn(reminder, date)) continue;
      add({
        key: `custom|${reminder.id}|${date}`,
        title: reminder.title,
        body: reminder.body === '' ? 'A reminder you set in My Work Ledger.' : reminder.body,
        date,
        time: reminder.time,
      });
    }
  }

  // Soonest first, then trimmed: if the horizon ever produces more alarms than
  // the cap, the ones that matter are the ones about to fire.
  planned.sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
  return planned.slice(0, MAX_PLANNED);
}

/** The period keys the horizon covers, in order. */
function monthsTouched(dates: readonly CalendarDate[]): PeriodKey[] {
  const seen: PeriodKey[] = [];
  for (const date of dates) {
    const period = periodKeyOf(date);
    if (!seen.includes(period)) seen.push(period);
  }
  // The salary notice for the month after the horizon's last day can still fall
  // inside it when pay day is early, so look one month further.
  const last = seen[seen.length - 1];
  if (last) seen.push(addMonths(last, 1));
  return seen;
}

/** A fingerprint of a plan, so an unchanged plan is not rescheduled. */
export function planFingerprint(plan: readonly PlannedNotification[]): string {
  return plan.map((entry) => `${entry.id}@${entry.date}T${entry.time}`).join(',');
}
