/**
 * Firestore document paths.
 *
 * Every id that becomes a path segment is validated first. An id containing a
 * slash would address a different document than the caller intended, and an id
 * that arrives from a URL, a QR code or a corrupted cache is not trustworthy
 * just because it reached this far.
 *
 * Collection names live here once so a typo cannot create a parallel,
 * rule-less collection by accident — the rules only cover the names below.
 */

import { collection, doc, type CollectionReference, type DocumentReference, type Firestore } from 'firebase/firestore';

import { assertId } from '@/lib/ids';

export const COLLECTIONS = {
  users: 'users',
  shops: 'shops',
  incomeConfigs: 'incomeConfigs',
  transactions: 'transactions',
  days: 'days',
  settlements: 'settlements',
  reminders: 'reminders',
  auditLogs: 'auditLogs',
} as const;

/** A Firebase uid: 1-128 characters, no path separators. */
export function assertUid(uid: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new Error('Invalid uid');
  return uid;
}

export function userDoc(db: Firestore, uid: string): DocumentReference {
  return doc(db, COLLECTIONS.users, assertUid(uid));
}

export function shopsCollection(db: Firestore, uid: string): CollectionReference {
  return collection(userDoc(db, uid), COLLECTIONS.shops);
}

export function shopDoc(db: Firestore, uid: string, shopId: string): DocumentReference {
  return doc(shopsCollection(db, uid), assertId('shop', shopId));
}

export function incomeConfigsCollection(
  db: Firestore,
  uid: string,
  shopId: string,
): CollectionReference {
  return collection(shopDoc(db, uid, shopId), COLLECTIONS.incomeConfigs);
}

export function incomeConfigDoc(
  db: Firestore,
  uid: string,
  shopId: string,
  configId: string,
): DocumentReference {
  return doc(incomeConfigsCollection(db, uid, shopId), assertId('income config', configId));
}

export function transactionsCollection(
  db: Firestore,
  uid: string,
  shopId: string,
): CollectionReference {
  return collection(shopDoc(db, uid, shopId), COLLECTIONS.transactions);
}

export function transactionDoc(
  db: Firestore,
  uid: string,
  shopId: string,
  txnId: string,
): DocumentReference {
  return doc(transactionsCollection(db, uid, shopId), assertId('transaction', txnId));
}

export function daysCollection(db: Firestore, uid: string, shopId: string): CollectionReference {
  return collection(shopDoc(db, uid, shopId), COLLECTIONS.days);
}

/**
 * A day document, addressed by the date it describes. The date is validated
 * before it becomes a path segment, so a malformed value cannot address a
 * document other than the one intended.
 */
export function dayDoc(
  db: Firestore,
  uid: string,
  shopId: string,
  date: string,
): DocumentReference {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid day id');
  return doc(daysCollection(db, uid, shopId), date);
}

export function settlementsCollection(
  db: Firestore,
  uid: string,
  shopId: string,
): CollectionReference {
  return collection(shopDoc(db, uid, shopId), COLLECTIONS.settlements);
}

export function settlementDoc(
  db: Firestore,
  uid: string,
  shopId: string,
  settlementId: string,
): DocumentReference {
  return doc(settlementsCollection(db, uid, shopId), assertId('settlement', settlementId));
}

export function remindersCollection(db: Firestore, uid: string): CollectionReference {
  return collection(userDoc(db, uid), COLLECTIONS.reminders);
}

export function reminderDoc(db: Firestore, uid: string, reminderId: string): DocumentReference {
  return doc(remindersCollection(db, uid), assertId('reminder', reminderId));
}

export function auditLogsCollection(db: Firestore, uid: string): CollectionReference {
  return collection(userDoc(db, uid), COLLECTIONS.auditLogs);
}

export function auditLogDoc(db: Firestore, uid: string, logId: string): DocumentReference {
  return doc(auditLogsCollection(db, uid), assertId('audit log', logId));
}
