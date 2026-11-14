/**
 * The clock.
 *
 * Reading the current time is an impurity, so it happens here and nowhere else.
 * Everything downstream takes `today` or `nowMs` as an argument, which is what
 * makes the ledger engine testable and its results reproducible.
 */

import { timeFrom, todayFrom, type CalendarDate } from './dates';

/** The calendar day the device is currently in. */
export function today(): CalendarDate {
  return todayFrom(new Date());
}

/** The wall-clock time now, `HH:MM`, in the form reminder schedules use. */
export function nowTime(): string {
  return timeFrom(new Date());
}

/** Wall-clock milliseconds, used only for client-side ordering and sort keys. */
export function nowMs(): number {
  return Date.now();
}

/**
 * Milliseconds the device clock is ahead of (or behind) a trusted reference.
 * Posting an accrual depends on "has the salary date passed", so a device whose
 * clock is weeks out would mint entries for months that have not happened. The
 * caller compares the device clock against a server timestamp and refuses to
 * post when this exceeds the tolerance.
 */
export function clockSkewMs(serverMs: number): number {
  return nowMs() - serverMs;
}

/** How far the device clock may differ from the server before we stop trusting it. */
export const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;
