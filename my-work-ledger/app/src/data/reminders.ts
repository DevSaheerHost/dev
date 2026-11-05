/**
 * Reminders: reads and writes.
 *
 * The four automatic kinds are stored under deterministic ids, so switching one
 * on is an upsert rather than a chance to create a second copy of it. Only
 * their schedule lives here; what they actually say is worked out from the
 * ledger each time, in `features/reminders/derived.ts`.
 *
 * This is the one collection whose documents may genuinely be deleted. A
 * reminder holds no financial record — removing one loses nothing that could
 * ever be needed to explain a balance, which is why everything else in this app
 * is archived or voided instead.
 */

import { deleteDoc, onSnapshot, orderBy, query, setDoc, updateDoc } from 'firebase/firestore';

import { isCalendarDate, type CalendarDate } from '@/lib/dates';
import { randomId } from '@/lib/ids';
import {
  AUTO_REMINDER_IDS,
  type Reminder,
  type ReminderKind,
  type ReminderType,
} from '@/types/models';

import { DEFAULT_REMINDER_TIME, isValidTime } from '@/features/reminders/schedule';

import { getDb, requireDb } from './client';
import { reminderDoc, remindersCollection } from './paths';
import { detach, type PendingWrite, type PendingWriteWithId } from './writes';

export const MAX_TITLE = 80;
export const MAX_BODY = 300;

export interface ReminderInput {
  readonly kind: ReminderKind;
  readonly shopId: string | null;
  readonly type: ReminderType;
  readonly title: string;
  readonly body: string;
  readonly weekday: number | null;
  readonly dayOfMonth: number | null;
  readonly onDate: CalendarDate | null;
  readonly time: string;
  readonly enabled: boolean;
}

export interface ReminderError {
  readonly field: keyof ReminderInput;
  readonly message: string;
}

export function validateReminder(input: ReminderInput): ReminderError[] {
  const errors: ReminderError[] = [];

  const title = input.title.trim();
  if (title === '') errors.push({ field: 'title', message: 'Give the reminder a name' });
  else if (title.length > MAX_TITLE) {
    errors.push({ field: 'title', message: `Keep it under ${MAX_TITLE} characters` });
  }

  if (input.body.length > MAX_BODY) {
    errors.push({ field: 'body', message: 'Keep the note shorter' });
  }

  if (!isValidTime(input.time)) {
    errors.push({ field: 'time', message: 'Pick a time' });
  }

  if (input.type === 'weekly' && (input.weekday === null || input.weekday < 0 || input.weekday > 6)) {
    errors.push({ field: 'weekday', message: 'Pick a day of the week' });
  }

  if (
    input.type === 'monthly' &&
    (input.dayOfMonth === null || input.dayOfMonth < 1 || input.dayOfMonth > 31)
  ) {
    errors.push({ field: 'dayOfMonth', message: 'Pick a day of the month' });
  }

  if (input.type === 'oneTime' && !isCalendarDate(input.onDate)) {
    errors.push({ field: 'onDate', message: 'Pick a date' });
  }

  return errors;
}

/** Exactly the fields the rules whitelist, with no undefined anywhere. */
function toWriteShape(input: ReminderInput) {
  return {
    kind: input.kind,
    shopId: input.shopId,
    type: input.type,
    title: input.title.trim(),
    body: input.body.trim().slice(0, MAX_BODY),
    weekday: input.type === 'weekly' ? input.weekday : null,
    dayOfMonth: input.type === 'monthly' ? input.dayOfMonth : null,
    onDate: input.type === 'oneTime' ? input.onDate : null,
    time: input.time,
    enabled: input.enabled,
  };
}

export function createReminder(uid: string, input: ReminderInput): PendingWriteWithId {
  const errors = validateReminder(input);
  if (errors.length > 0) throw new Error(errors[0]?.message ?? 'Invalid reminder');

  const db = requireDb();
  const id = randomId('rem');
  const synced = detach(
    setDoc(reminderDoc(db, uid, id), {
      ...toWriteShape(input),
      lastFiredAt: null,
    }),
  );
  return { id, synced };
}

export function updateReminder(
  uid: string,
  reminderId: string,
  input: ReminderInput,
): PendingWrite {
  const errors = validateReminder(input);
  if (errors.length > 0) throw new Error(errors[0]?.message ?? 'Invalid reminder');

  const db = requireDb();
  return { synced: detach(updateDoc(reminderDoc(db, uid, reminderId), toWriteShape(input))) };
}

/** A reminder is the one thing here that can be removed outright. */
export function deleteReminder(uid: string, reminderId: string): PendingWrite {
  const db = requireDb();
  return { synced: detach(deleteDoc(reminderDoc(db, uid, reminderId))) };
}

/**
 * Writes the schedule for one of the four automatic kinds.
 *
 * The id is derived from the kind, so this is an upsert: switching the same
 * reminder on from two devices writes the same document rather than leaving two
 * of them firing.
 */
export function setAutoReminder(
  uid: string,
  kind: ReminderKind,
  settings: { enabled: boolean; time: string },
): PendingWrite {
  const id = AUTO_REMINDER_IDS[kind];
  if (!id) throw new Error(`Not an automatic reminder: ${kind}`);
  if (!isValidTime(settings.time)) throw new Error('Invalid time');

  const db = requireDb();
  return {
    synced: detach(
      setDoc(
        reminderDoc(db, uid, id),
        {
          kind,
          shopId: null,
          // Checked every day; which days actually produce a reminder is
          // decided by the ledger, not by this schedule.
          type: 'daily',
          title: AUTO_TITLES[kind] ?? 'Reminder',
          body: '',
          weekday: null,
          dayOfMonth: null,
          onDate: null,
          time: settings.time,
          enabled: settings.enabled,
          lastFiredAt: null,
        },
        { merge: false },
      ),
    ),
  };
}

const AUTO_TITLES: Readonly<Record<string, string>> = {
  salaryDueSoon: 'Salary coming up',
  monthEnded: 'The month is over',
  dailyTick: 'Food money and days off',
  settleReady: 'Ready to settle',
};

const VALID_KINDS = new Set<string>([
  'custom',
  'salaryDueSoon',
  'monthEnded',
  'dailyTick',
  'settleReady',
]);

function fromDoc(id: string, data: Record<string, unknown>): Reminder {
  const weekday = typeof data.weekday === 'number' ? data.weekday : null;
  const dayOfMonth = typeof data.dayOfMonth === 'number' ? data.dayOfMonth : null;
  const type = data.type;

  return {
    id,
    kind: (typeof data.kind === 'string' && VALID_KINDS.has(data.kind)
      ? data.kind
      : 'custom') as ReminderKind,
    shopId: typeof data.shopId === 'string' ? data.shopId : null,
    type:
      type === 'daily' || type === 'weekly' || type === 'monthly' || type === 'oneTime'
        ? type
        : 'daily',
    title: typeof data.title === 'string' ? data.title : 'Reminder',
    body: typeof data.body === 'string' ? data.body : '',
    weekday: weekday !== null && weekday >= 0 && weekday <= 6 ? weekday : null,
    dayOfMonth: dayOfMonth !== null && dayOfMonth >= 1 && dayOfMonth <= 31 ? dayOfMonth : null,
    onDate: isCalendarDate(data.onDate) ? data.onDate : null,
    time: typeof data.time === 'string' && isValidTime(data.time) ? data.time : DEFAULT_REMINDER_TIME,
    enabled: data.enabled !== false,
    lastFiredAt: data.lastFiredAt ?? null,
  };
}

export function watchReminders(
  uid: string,
  onChange: (reminders: Reminder[]) => void,
  onError: (error: Error) => void,
): () => void {
  const db = getDb();
  if (!db) {
    onChange([]);
    return () => {};
  }
  return onSnapshot(
    query(remindersCollection(db, uid), orderBy('time', 'asc')),
    (snapshot) => onChange(snapshot.docs.map((entry) => fromDoc(entry.id, entry.data()))),
    (error) => onError(error),
  );
}
