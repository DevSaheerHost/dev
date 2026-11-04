/**
 * Shops: the accounts money is owed by.
 *
 * Reads go through `onSnapshot`, so the UI is driven by Firestore's on-device
 * cache and shows a write the instant it is queued, online or off. Writes mint
 * their own document id, so a retried create cannot produce a second shop.
 *
 * Every field written here is also validated by the security rules. The checks
 * in this file exist to give a useful message, not to provide the guarantee —
 * client-side validation is a courtesy, the rules are the boundary.
 */

import { onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

import { isCalendarDate, type CalendarDate } from '@/lib/dates';
import { isValidAmount, paise, type Paise } from '@/lib/money';
import { randomId } from '@/lib/ids';
import type { SettlementMode, Shop, ShopStatus } from '@/types/models';

import { recordAudit } from './audit';
import { getDb, requireDb } from './client';
import { shopDoc, shopsCollection } from './paths';
import { detach, type PendingWrite, type PendingWriteWithId } from './writes';

export const MAX_SHOP_NAME = 60;
export const MAX_SHOP_DESCRIPTION = 240;

export interface ShopInput {
  readonly name: string;
  readonly description: string;
  readonly joiningDate: CalendarDate;
  readonly salaryPayDay: number;
  readonly settlementMode: SettlementMode;
  readonly openingBalance: Paise;
  readonly openingBalanceAsOf: CalendarDate;
}

export type ValidationError = { readonly field: keyof ShopInput; readonly message: string };

/** Collects every problem rather than stopping at the first, so the form can show them all. */
export function validateShopInput(input: ShopInput): ValidationError[] {
  const errors: ValidationError[] = [];

  const name = input.name.trim();
  if (name === '') errors.push({ field: 'name', message: 'Give the shop a name' });
  else if (name.length > MAX_SHOP_NAME) {
    errors.push({ field: 'name', message: `Keep the name under ${MAX_SHOP_NAME} characters` });
  }

  if (input.description.length > MAX_SHOP_DESCRIPTION) {
    errors.push({
      field: 'description',
      message: `Keep the note under ${MAX_SHOP_DESCRIPTION} characters`,
    });
  }

  if (!isCalendarDate(input.joiningDate)) {
    errors.push({ field: 'joiningDate', message: 'Pick the date you started here' });
  }

  if (!Number.isInteger(input.salaryPayDay) || input.salaryPayDay < 1 || input.salaryPayDay > 31) {
    errors.push({ field: 'salaryPayDay', message: 'Pick a day between 1 and 31' });
  }

  if (!isValidAmount(input.openingBalance)) {
    errors.push({ field: 'openingBalance', message: 'That opening balance is out of range' });
  }

  if (!isCalendarDate(input.openingBalanceAsOf)) {
    errors.push({ field: 'openingBalanceAsOf', message: 'Pick the date the balance applies from' });
  } else if (isCalendarDate(input.joiningDate) && input.openingBalanceAsOf < input.joiningDate) {
    errors.push({
      field: 'openingBalanceAsOf',
      message: 'The opening balance cannot start before you joined',
    });
  }

  return errors;
}

function toWriteShape(input: ShopInput) {
  return {
    name: input.name.trim(),
    description: input.description.trim(),
    joiningDate: input.joiningDate,
    salaryPayDay: input.salaryPayDay,
    settlementMode: input.settlementMode,
    openingBalance: input.openingBalance as number,
    openingBalanceAsOf: input.openingBalanceAsOf,
  };
}

/**
 * Creates a shop and returns its id immediately.
 *
 * Deliberately not awaiting the server: a Firestore write promise resolves on
 * server acknowledgement, so offline it stays pending indefinitely and a form
 * that awaits it sits on "Saving..." forever. The write reaches the local cache
 * at once and every listener fires, so the shop is genuinely saved. See
 * `writes.ts`.
 */
export function createShop(uid: string, input: ShopInput): PendingWriteWithId {
  const errors = validateShopInput(input);
  if (errors.length > 0) throw new Error(errors[0]?.message ?? 'Invalid shop');

  const db = requireDb();
  const id = randomId('shop');

  const synced = detach(setDoc(shopDoc(db, uid, id), {
    ...toWriteShape(input),
    sealedThroughDate: null,
    status: 'active' satisfies ShopStatus,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));

  void recordAudit(uid, {
    action: 'create',
    entity: 'shop',
    entityId: id,
    summary: `Created shop ${input.name.trim()}`,
  });

  return { id, synced };
}

export function updateShop(uid: string, shopId: string, input: ShopInput): PendingWrite {
  const errors = validateShopInput(input);
  if (errors.length > 0) throw new Error(errors[0]?.message ?? 'Invalid shop');

  const db = requireDb();
  const synced = detach(updateDoc(shopDoc(db, uid, shopId), {
    ...toWriteShape(input),
    updatedAt: serverTimestamp(),
  }));

  void recordAudit(uid, {
    action: 'update',
    entity: 'shop',
    entityId: shopId,
    summary: `Updated shop ${input.name.trim()}`,
  });

  return { synced };
}

/**
 * Archiving, never deleting. A shop's transactions are the evidence behind past
 * settlements; removing the shop would orphan them and quietly change history.
 */
export function setShopStatus(uid: string, shopId: string, status: ShopStatus): PendingWrite {
  const db = requireDb();
  const synced = detach(
    updateDoc(shopDoc(db, uid, shopId), { status, updatedAt: serverTimestamp() }),
  );
  void recordAudit(uid, {
    action: 'update',
    entity: 'shop',
    entityId: shopId,
    summary: status === 'archived' ? 'Archived shop' : 'Restored shop',
  });
  return { synced };
}

const FALLBACK_DATE = '2000-01-01' as CalendarDate;

/**
 * Reads a stored document defensively. A field that is missing or the wrong
 * type is replaced with a safe default rather than allowed to propagate as
 * `NaN` into a balance, where it would turn every total into `NaN`.
 */
function fromDoc(id: string, data: Record<string, unknown>): Shop {
  const amount = typeof data.openingBalance === 'number' ? data.openingBalance : 0;
  const payDay = typeof data.salaryPayDay === 'number' ? data.salaryPayDay : 1;
  const sealed = data.sealedThroughDate;

  return {
    id,
    name: typeof data.name === 'string' ? data.name : 'Untitled shop',
    description: typeof data.description === 'string' ? data.description : '',
    joiningDate: isCalendarDate(data.joiningDate) ? data.joiningDate : FALLBACK_DATE,
    salaryPayDay: Number.isInteger(payDay) && payDay >= 1 && payDay <= 31 ? payDay : 1,
    settlementMode: data.settlementMode === 'cashOnly' ? 'cashOnly' : 'accrual',
    openingBalance: isValidAmount(amount) ? paise(amount) : paise(0),
    openingBalanceAsOf: isCalendarDate(data.openingBalanceAsOf)
      ? data.openingBalanceAsOf
      : FALLBACK_DATE,
    sealedThroughDate: isCalendarDate(sealed) ? sealed : null,
    status: data.status === 'archived' ? 'archived' : 'active',
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
  };
}

/** Live list of every shop, active and archived, ordered by name. */
export function watchShops(
  uid: string,
  onChange: (shops: Shop[]) => void,
  onError: (error: Error) => void,
): () => void {
  const db = getDb();
  if (!db) {
    onChange([]);
    return () => {};
  }

  return onSnapshot(
    query(shopsCollection(db, uid), orderBy('name')),
    (snapshot) => {
      onChange(snapshot.docs.map((entry) => fromDoc(entry.id, entry.data())));
    },
    (error) => onError(error),
  );
}
