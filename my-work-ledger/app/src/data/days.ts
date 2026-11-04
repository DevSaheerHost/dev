/**
 * Day records: attendance, and the days a daily allowance actually arrived.
 *
 * The document id is the date, so every write is an upsert addressed by the day
 * it describes. Two taps on the same day, or two devices, reach the same
 * document rather than recording it twice — the same structural duplicate
 * prevention used for accruals, and the reason there is no `createdAt` here.
 *
 * Only exceptions are stored. A date with no document means the ordinary case:
 * worked, nothing received. A year of normal attendance is zero documents.
 */

import {
  documentId,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';

import { isCalendarDate, periodEnd, periodStart, type CalendarDate, type PeriodKey } from '@/lib/dates';
import type { DayRecord } from '@/types/models';

import { getDb, requireDb } from './client';
import { daysCollection, dayDoc } from './paths';
import { detach, type PendingWrite } from './writes';

export const MAX_DAY_NOTE = 200;
/** A day cannot hold more allowance receipts than this; the rules agree. */
export const MAX_ALLOWANCES_PER_DAY = 20;

/**
 * Writes a day record.
 *
 * Merging rather than replacing, so marking a day off does not wipe the
 * allowance ticks already on it and vice versa. The caller passes the complete
 * intended state, which it has from the live snapshot.
 */
export function setDay(
  uid: string,
  shopId: string,
  date: CalendarDate,
  state: { off: boolean; allowancesReceived: readonly string[]; note?: string },
): PendingWrite {
  if (!isCalendarDate(date)) throw new Error('Invalid date');
  if (state.allowancesReceived.length > MAX_ALLOWANCES_PER_DAY) {
    throw new Error('Too many allowances for one day');
  }

  const db = requireDb();
  const synced = detach(
    setDoc(dayDoc(db, uid, shopId, date), {
      date,
      off: state.off,
      allowancesReceived: [...new Set(state.allowancesReceived)],
      note: (state.note ?? '').slice(0, MAX_DAY_NOTE),
      updatedAt: serverTimestamp(),
    }),
  );
  return { synced };
}

/** Marks a day worked or not, leaving any allowance ticks on it alone. */
export function setDayOff(
  uid: string,
  shopId: string,
  date: CalendarDate,
  off: boolean,
  existing: DayRecord | undefined,
): PendingWrite {
  return setDay(uid, shopId, date, {
    off,
    allowancesReceived: existing?.allowancesReceived ?? [],
    note: existing?.note ?? '',
  });
}

/** Ticks or unticks a daily allowance for one day. */
export function toggleAllowanceReceived(
  uid: string,
  shopId: string,
  date: CalendarDate,
  configId: string,
  existing: DayRecord | undefined,
): PendingWrite {
  const current = existing?.allowancesReceived ?? [];
  const next = current.includes(configId)
    ? current.filter((id) => id !== configId)
    : [...current, configId];

  return setDay(uid, shopId, date, {
    off: existing?.off ?? false,
    allowancesReceived: next,
    note: existing?.note ?? '',
  });
}

function fromDoc(id: string, data: Record<string, unknown>): DayRecord {
  // The id is the authority on which day this is: the stored `date` is a
  // convenience for queries and could in principle disagree.
  const date = (isCalendarDate(id) ? id : '2000-01-01') as CalendarDate;
  return {
    date,
    off: data.off === true,
    allowancesReceived: Array.isArray(data.allowancesReceived)
      ? data.allowancesReceived.filter((value): value is string => typeof value === 'string')
      : [],
    note: typeof data.note === 'string' ? data.note : '',
    updatedAt: data.updatedAt ?? null,
  };
}

/**
 * Live day records for one month.
 *
 * Bounded by document id, which Firestore serves from the automatic index — so
 * this needs no composite index deployed before it will run.
 */
export function watchMonthDays(
  uid: string,
  shopId: string,
  period: PeriodKey,
  onChange: (days: DayRecord[]) => void,
  onError: (error: Error) => void,
): () => void {
  const db = getDb();
  if (!db) {
    onChange([]);
    return () => {};
  }

  return onSnapshot(
    query(
      daysCollection(db, uid, shopId),
      where(documentId(), '>=', periodStart(period)),
      where(documentId(), '<=', periodEnd(period)),
    ),
    (snapshot) => onChange(snapshot.docs.map((entry) => fromDoc(entry.id, entry.data()))),
    (error) => onError(error),
  );
}

/**
 * Live day records from a date onwards.
 *
 * Used when several past months still need their accruals confirmed, so the
 * worked-day counts for all of them are available in one listener instead of
 * one per month.
 */
export function watchDaysFrom(
  uid: string,
  shopId: string,
  from: CalendarDate,
  onChange: (days: DayRecord[]) => void,
  onError: (error: Error) => void,
): () => void {
  const db = getDb();
  if (!db) {
    onChange([]);
    return () => {};
  }

  return onSnapshot(
    query(daysCollection(db, uid, shopId), where(documentId(), '>=', from)),
    (snapshot) => onChange(snapshot.docs.map((entry) => fromDoc(entry.id, entry.data()))),
    (error) => onError(error),
  );
}
