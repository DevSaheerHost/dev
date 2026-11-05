/**
 * Sealing a period, and reading past statements.
 *
 * This is the one place in the app that genuinely needs the network, and the
 * code is explicit about it. Everything else is offline-first: a write lands in
 * the on-device cache and syncs later. Sealing cannot work that way, because
 * `runTransaction` needs a server round trip and a statement number allocated
 * on one device while another is offline would collide.
 *
 * So sealing is awaited, refuses to start without a connection, and is built to
 * survive being interrupted half-way:
 *
 *   1. create the statement as `stamping`, inside a transaction that checks no
 *      other device has sealed these days already
 *   2. stamp the entries with the statement's id, in batches of 400
 *   3. flip the statement to `sealed`
 *   4. move the shop's seal date forward
 *
 * If it stops after step 1 or 2, the statement is left as `stamping` and the
 * app offers to finish it. A period is never left half-closed with no way back.
 */

import {
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

import { isCalendarDate, type CalendarDate } from '@/lib/dates';
import { isValidAmount, paise, type Paise } from '@/lib/money';
import { randomId } from '@/lib/ids';
import type { SettlementSnapshot } from '@/features/ledger/settlement';
import {
  TRANSACTION_KINDS,
  type SealState,
  type Settlement,
  type SettlementStatus,
  type Shop,
  type TransactionKind,
} from '@/types/models';

import { recordAudit } from './audit';
import { getDb, requireDb } from './client';
import { settlementDoc, settlementsCollection, shopDoc, transactionDoc } from './paths';

/**
 * A Firestore batch is capped at 500 operations. 400 leaves room and keeps each
 * round trip small; a long period simply takes a few of them.
 */
export const STAMP_BATCH_SIZE = 400;

export class OfflineSealError extends Error {
  constructor() {
    super('seal-needs-connection');
    this.name = 'OfflineSealError';
  }
}

export class ConcurrentSealError extends Error {
  constructor() {
    super('seal-already-done-elsewhere');
    this.name = 'ConcurrentSealError';
  }
}

function assertOnline(): void {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new OfflineSealError();
  }
}

export interface SealProgress {
  readonly stamped: number;
  readonly total: number;
}

/**
 * Stamps every included entry with the statement's id, in chunks.
 *
 * Re-stamping an entry that already carries this id is harmless — the rules
 * permit exactly this change — which is what makes an interrupted seal safe to
 * resume rather than needing to know how far it got.
 */
async function stampEntries(
  uid: string,
  shopId: string,
  settlementId: string,
  entryIds: readonly string[],
  onProgress?: (progress: SealProgress) => void,
): Promise<void> {
  const db = requireDb();

  for (let offset = 0; offset < entryIds.length; offset += STAMP_BATCH_SIZE) {
    const chunk = entryIds.slice(offset, offset + STAMP_BATCH_SIZE);
    const batch = writeBatch(db);
    for (const entryId of chunk) {
      batch.update(transactionDoc(db, uid, shopId, entryId), {
        settlementId,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
    onProgress?.({ stamped: Math.min(offset + chunk.length, entryIds.length), total: entryIds.length });
  }
}

/**
 * Seals a period and returns the statement's id.
 *
 * Awaited throughout, unlike every other write in this app, because the caller
 * genuinely cannot proceed until the server has agreed.
 */
export async function sealPeriod(args: {
  readonly uid: string;
  readonly shop: Shop;
  readonly snapshot: SettlementSnapshot;
  readonly onProgress?: (progress: SealProgress) => void;
}): Promise<string> {
  const { uid, shop, snapshot, onProgress } = args;
  assertOnline();

  const db = requireDb();
  const settlementId = randomId('set');
  const periodEndDate = snapshot.body.periodEnd;

  // One transaction, for one reason: to be certain no other device has already
  // sealed these days. Without it two phones could both seal October and the
  // same entries would end up claimed by two statements.
  await runTransaction(db, async (transaction) => {
    const shopRef = shopDoc(db, uid, shop.id);
    const current = await transaction.get(shopRef);
    const sealedThrough = current.data()?.sealedThroughDate ?? null;

    if (sealedThrough !== null && sealedThrough >= snapshot.body.periodStart) {
      throw new ConcurrentSealError();
    }

    transaction.set(settlementDoc(db, uid, shop.id, settlementId), {
      ...snapshot.body,
      sealedAt: null,
      createdAt: serverTimestamp(),
    });
  });

  await stampEntries(uid, shop.id, settlementId, snapshot.includedIds, onProgress);

  // Only now is the statement final. A reader that arrives between the two
  // writes sees `stamping` and knows not to trust it yet.
  await updateDoc(settlementDoc(db, uid, shop.id, settlementId), {
    sealState: 'sealed' satisfies SealState,
    sealedAt: serverTimestamp(),
  });

  // The seal date is what pushes later backdated entries into the open period.
  await updateDoc(shopDoc(db, uid, shop.id), {
    sealedThroughDate: periodEndDate,
    updatedAt: serverTimestamp(),
  });

  void recordAudit(uid, {
    action: 'seal',
    entity: 'settlement',
    entityId: settlementId,
    summary: `Statement ${snapshot.body.statementNo}: ${snapshot.body.periodStart} to ${periodEndDate}`,
  });

  return settlementId;
}

/**
 * Finishes a seal that was interrupted.
 *
 * The entry ids are recomputed from the same range rather than stored, so a
 * resume claims exactly what a fresh seal of those days would claim.
 */
export async function resumeSeal(args: {
  readonly uid: string;
  readonly shop: Shop;
  readonly settlement: Settlement;
  readonly entryIds: readonly string[];
  readonly onProgress?: (progress: SealProgress) => void;
}): Promise<void> {
  const { uid, shop, settlement, entryIds, onProgress } = args;
  assertOnline();

  const db = requireDb();
  await stampEntries(uid, shop.id, settlement.id, entryIds, onProgress);

  await updateDoc(settlementDoc(db, uid, shop.id, settlement.id), {
    sealState: 'sealed' satisfies SealState,
    sealedAt: serverTimestamp(),
  });

  if (shop.sealedThroughDate === null || shop.sealedThroughDate < settlement.periodEnd) {
    await updateDoc(shopDoc(db, uid, shop.id), {
      sealedThroughDate: settlement.periodEnd,
      updatedAt: serverTimestamp(),
    });
  }

  void recordAudit(uid, {
    action: 'seal',
    entity: 'settlement',
    entityId: settlement.id,
    summary: `Finished an interrupted seal for statement ${settlement.statementNo}`,
  });
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

const KIND_SET = new Set<string>(TRANSACTION_KINDS);
const FALLBACK_DATE = '2000-01-01' as CalendarDate;

function readTotals(value: unknown): Record<TransactionKind, Paise> {
  const totals = {} as Record<TransactionKind, Paise>;
  for (const kind of TRANSACTION_KINDS) totals[kind] = paise(0);
  if (value && typeof value === 'object') {
    for (const [key, amount] of Object.entries(value as Record<string, unknown>)) {
      if (KIND_SET.has(key) && typeof amount === 'number' && isValidAmount(amount)) {
        totals[key as TransactionKind] = paise(amount);
      }
    }
  }
  return totals;
}

function fromDoc(id: string, data: Record<string, unknown>): Settlement {
  const money = (value: unknown) =>
    typeof value === 'number' && isValidAmount(value) ? paise(value) : paise(0);
  const day = (value: unknown) => (isCalendarDate(value) ? value : FALLBACK_DATE);
  const count = typeof data.transactionCount === 'number' ? data.transactionCount : 0;
  const statementNo = typeof data.statementNo === 'number' ? data.statementNo : 0;

  return {
    id,
    shopId: typeof data.shopId === 'string' ? data.shopId : '',
    periodStart: day(data.periodStart),
    periodEnd: day(data.periodEnd),
    settlementDate: day(data.settlementDate),
    openingBalance: money(data.openingBalance),
    closingBalance: money(data.closingBalance),
    totals: readTotals(data.totals),
    transactionCount: Number.isInteger(count) && count >= 0 ? count : 0,
    statementNo: Number.isInteger(statementNo) && statementNo >= 1 ? statementNo : 0,
    sealState: data.sealState === 'stamping' ? 'stamping' : ('sealed' satisfies SealState),
    status:
      data.status === 'needs_reconciliation'
        ? 'needs_reconciliation'
        : ('sealed' satisfies SettlementStatus),
    notes: typeof data.notes === 'string' ? data.notes : '',
    sealedAt: data.sealedAt ?? null,
    createdAt: data.createdAt ?? null,
  };
}

export function watchSettlements(
  uid: string,
  shopId: string,
  onChange: (settlements: Settlement[]) => void,
  onError: (error: Error) => void,
): () => void {
  const db = getDb();
  if (!db) {
    onChange([]);
    return () => {};
  }
  return onSnapshot(
    query(settlementsCollection(db, uid, shopId), orderBy('periodEnd', 'desc')),
    (snapshot) => onChange(snapshot.docs.map((entry) => fromDoc(entry.id, entry.data()))),
    (error) => onError(error),
  );
}
