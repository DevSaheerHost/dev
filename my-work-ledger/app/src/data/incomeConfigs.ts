/**
 * Income configs: what a shop owes you, and from when.
 *
 * Effective-dated rather than edited in place. Giving yourself a raise creates
 * a new config and closes the old one, so what was earned last month does not
 * change retroactively when this month's rate does — and an accrual already
 * posted is never recalculated from a config that has since moved.
 *
 * Amounts stay editable for the genuine case of a typo in a rate that has not
 * been accrued yet. Once an accrual exists it is a posted entry in its own
 * right; correcting the rate afterwards produces a signed adjustment rather
 * than rewriting history.
 */

import { onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

import { compareDates, isCalendarDate, type CalendarDate } from '@/lib/dates';
import { randomId } from '@/lib/ids';
import { isValidAmount, paise, type Paise } from '@/lib/money';
import type { IncomeConfig, IncomeFrequency, IncomeKind } from '@/types/models';

import { recordAudit } from './audit';
import { getDb, requireDb } from './client';
import { incomeConfigDoc, incomeConfigsCollection } from './paths';
import { detach, type PendingWrite, type PendingWriteWithId } from './writes';

export const MAX_LABEL = 60;

export interface IncomeConfigInput {
  readonly kind: IncomeKind;
  readonly label: string;
  readonly amount: Paise;
  readonly frequency: IncomeFrequency;
  readonly effectiveFrom: CalendarDate;
  readonly effectiveTo: CalendarDate | null;
}

export interface ConfigError {
  readonly field: keyof IncomeConfigInput;
  readonly message: string;
}

export function validateIncomeConfig(input: IncomeConfigInput): ConfigError[] {
  const errors: ConfigError[] = [];

  const label = input.label.trim();
  if (label === '') errors.push({ field: 'label', message: 'Give this a name' });
  else if (label.length > MAX_LABEL) {
    errors.push({ field: 'label', message: `Keep it under ${MAX_LABEL} characters` });
  }

  if (!isValidAmount(input.amount) || input.amount <= 0) {
    errors.push({ field: 'amount', message: 'Enter an amount greater than zero' });
  }

  if (!isCalendarDate(input.effectiveFrom)) {
    errors.push({ field: 'effectiveFrom', message: 'Pick the date this starts from' });
  }

  if (input.effectiveTo !== null) {
    if (!isCalendarDate(input.effectiveTo)) {
      errors.push({ field: 'effectiveTo', message: 'That end date is not valid' });
    } else if (
      isCalendarDate(input.effectiveFrom) &&
      compareDates(input.effectiveTo, input.effectiveFrom) < 0
    ) {
      errors.push({ field: 'effectiveTo', message: 'The end date comes before the start date' });
    }
  }

  return errors;
}

function toWriteShape(input: IncomeConfigInput) {
  return {
    kind: input.kind,
    label: input.label.trim(),
    amount: input.amount as number,
    frequency: input.frequency,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
  };
}

export function createIncomeConfig(
  uid: string,
  shopId: string,
  input: IncomeConfigInput,
): PendingWriteWithId {
  const errors = validateIncomeConfig(input);
  if (errors.length > 0) throw new Error(errors[0]?.message ?? 'Invalid income');

  const db = requireDb();
  const id = randomId('inc');
  const synced = detach(
    setDoc(incomeConfigDoc(db, uid, shopId, id), {
      ...toWriteShape(input),
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );

  void recordAudit(uid, {
    action: 'create',
    entity: 'incomeConfig',
    entityId: id,
    summary: `Added ${input.label.trim()} for shop ${shopId}`,
  });

  return { id, synced };
}

export function updateIncomeConfig(
  uid: string,
  shopId: string,
  configId: string,
  input: IncomeConfigInput,
): PendingWrite {
  const errors = validateIncomeConfig(input);
  if (errors.length > 0) throw new Error(errors[0]?.message ?? 'Invalid income');

  const db = requireDb();
  const synced = detach(
    updateDoc(incomeConfigDoc(db, uid, shopId, configId), {
      ...toWriteShape(input),
      updatedAt: serverTimestamp(),
    }),
  );

  void recordAudit(uid, {
    action: 'update',
    entity: 'incomeConfig',
    entityId: configId,
    summary: `Updated ${input.label.trim()}`,
  });

  return { synced };
}

/**
 * Closes a config as of a date, rather than deleting it.
 *
 * Deleting would orphan the accruals it produced and make a past statement
 * impossible to explain. Setting `effectiveTo` is also what makes a mid-month
 * raise work: the old rate stops, the new one starts the next day, and the two
 * pro-rated shares tile the month exactly.
 */
export function endIncomeConfig(
  uid: string,
  shopId: string,
  configId: string,
  lastDay: CalendarDate,
): PendingWrite {
  const db = requireDb();
  const synced = detach(
    updateDoc(incomeConfigDoc(db, uid, shopId, configId), {
      effectiveTo: lastDay,
      updatedAt: serverTimestamp(),
    }),
  );

  void recordAudit(uid, {
    action: 'update',
    entity: 'incomeConfig',
    entityId: configId,
    summary: `Ended on ${lastDay}`,
  });

  return { synced };
}

/** Stops a config accruing without claiming anything about dates. */
export function setIncomeConfigActive(
  uid: string,
  shopId: string,
  configId: string,
  active: boolean,
): PendingWrite {
  const db = requireDb();
  const synced = detach(
    updateDoc(incomeConfigDoc(db, uid, shopId, configId), {
      active,
      updatedAt: serverTimestamp(),
    }),
  );

  void recordAudit(uid, {
    action: 'update',
    entity: 'incomeConfig',
    entityId: configId,
    summary: active ? 'Reactivated' : 'Deactivated',
  });

  return { synced };
}

const FALLBACK_DATE = '2000-01-01' as CalendarDate;

function fromDoc(id: string, data: Record<string, unknown>): IncomeConfig {
  const amount = typeof data.amount === 'number' && isValidAmount(data.amount) ? data.amount : 0;
  const kind = data.kind;
  const frequency = data.frequency;

  return {
    id,
    kind: kind === 'allowance' || kind === 'other' ? kind : 'salary',
    label: typeof data.label === 'string' ? data.label : 'Income',
    amount: paise(amount),
    frequency:
      frequency === 'weekly' || frequency === 'daily' || frequency === 'oneTime'
        ? frequency
        : 'monthly',
    effectiveFrom: isCalendarDate(data.effectiveFrom) ? data.effectiveFrom : FALLBACK_DATE,
    effectiveTo: isCalendarDate(data.effectiveTo) ? data.effectiveTo : null,
    active: data.active !== false,
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
  };
}

export function watchIncomeConfigs(
  uid: string,
  shopId: string,
  onChange: (configs: IncomeConfig[]) => void,
  onError: (error: Error) => void,
): () => void {
  const db = getDb();
  if (!db) {
    onChange([]);
    return () => {};
  }
  return onSnapshot(
    query(incomeConfigsCollection(db, uid, shopId), orderBy('effectiveFrom', 'asc')),
    (snapshot) => onChange(snapshot.docs.map((entry) => fromDoc(entry.id, entry.data()))),
    (error) => onError(error),
  );
}
