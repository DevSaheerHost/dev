/**
 * Ledger entries: reads, writes, and the soft delete.
 *
 * Writes return immediately with a client-minted id rather than awaiting the
 * server — see `writes.ts` for why that matters on a phone with no signal.
 * Every write uses `setDoc` with an id the client chose, so a retry lands on
 * the same document instead of creating a second salary.
 *
 * Nothing in this module deletes. A mistake is voided, which keeps the entry
 * and the reason, because the history of a disputed balance has to outlive the
 * correction.
 */

import {
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Query,
} from 'firebase/firestore';

import { nowMs } from '@/lib/clock';
import { isCalendarDate, type CalendarDate, type PeriodKey } from '@/lib/dates';
import { randomId } from '@/lib/ids';
import { isValidAmount, paise } from '@/lib/money';
import type { AccrualProposal } from '@/features/ledger/accrual';
import {
  buildEntryDocument,
  validateEntry,
  type EntryError,
  type EntryInput,
} from '@/features/ledger/posting';
import {
  TRANSACTION_KINDS,
  type FundedFrom,
  type Shop,
  type Transaction,
  type TransactionKind,
} from '@/types/models';

import { recordAudit } from './audit';
import { getDb, requireDb } from './client';
import { transactionDoc, transactionsCollection } from './paths';
import { detach, type PendingWriteWithId } from './writes';

/** Entries loaded at once for one shop. Beyond this the UI pages by month. */
export const TRANSACTION_PAGE_LIMIT = 500;

export class EntryValidationError extends Error {
  readonly errors: readonly EntryError[];
  constructor(errors: readonly EntryError[]) {
    super(errors[0]?.message ?? 'Invalid entry');
    this.name = 'EntryValidationError';
    this.errors = errors;
  }
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/** Adds one entry. Throws only on validation; the network never blocks it. */
export function addEntry(
  uid: string,
  shop: Shop,
  input: EntryInput,
  today: CalendarDate,
): PendingWriteWithId {
  const errors = validateEntry(shop, input, today);
  if (errors.length > 0) throw new EntryValidationError(errors);

  const db = requireDb();
  const id = randomId('txn');
  const body = buildEntryDocument({ id, uid, shop, input, clientCreatedAtMs: nowMs() });

  const synced = detach(
    setDoc(transactionDoc(db, uid, shop.id, id), {
      ...body,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );

  void recordAudit(uid, {
    action: 'create',
    entity: 'transaction',
    entityId: id,
    summary: `${input.kind} ${input.amount} on ${input.transactionDate}`,
  });

  return { id, synced };
}

/**
 * Writes the two halves of a cash bonus together.
 *
 * Not a Firestore transaction: `runTransaction` needs a server round trip and
 * fails outright offline, which is precisely when entries get made. Two
 * independent `setDoc` calls both land in the local cache immediately and sync
 * independently; the shared `pairId` is what ties them together, and the engine
 * nets them to zero whether one or both have reached the server.
 */
export function addEntryPair(
  uid: string,
  shop: Shop,
  inputs: readonly [EntryInput, EntryInput],
  today: CalendarDate,
): { ids: [string, string]; synced: Promise<void> } {
  const first = addEntry(uid, shop, inputs[0], today);
  const second = addEntry(uid, shop, inputs[1], today);
  return {
    ids: [first.id, second.id],
    synced: Promise.all([first.synced, second.synced]).then(() => undefined),
  };
}

/**
 * Posts a confirmed accrual.
 *
 * The id is deterministic, so confirming the same month twice — from two
 * devices, or on a double tap — addresses the *same* document rather than
 * creating a second salary. The rules then refuse the second write outright,
 * because it would have to change an immutable `createdAt`.
 *
 * So a duplicate is impossible in two independent ways: the id collides, and
 * the collision is rejected rather than overwriting what is already there.
 * Callers do not normally reach this point anyway — `proposeOutstanding`
 * filters out any period whose accrual key already exists.
 */
export function postAccrual(uid: string, shop: Shop, proposal: AccrualProposal): PendingWriteWithId {
  const db = requireDb();
  const body = buildEntryDocument({
    id: proposal.id,
    uid,
    shop,
    clientCreatedAtMs: nowMs(),
    input: {
      kind: proposal.kind,
      amount: proposal.amount,
      transactionDate: proposal.transactionDate,
      category: 'accrual',
      description: proposal.isPartial
        ? `${proposal.label} (${proposal.prorationNum}/${proposal.prorationDen} days)`
        : proposal.label,
      accrualKey: proposal.accrualKey,
    },
  });

  const synced = detach(
    setDoc(transactionDoc(db, uid, shop.id, proposal.id), {
      ...body,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );

  void recordAudit(uid, {
    action: 'create',
    entity: 'transaction',
    entityId: proposal.id,
    summary: `Posted ${proposal.label} for ${proposal.period}`,
  });

  return { id: proposal.id, synced };
}

/**
 * Voids an entry. The document stays, with the reason and the time.
 *
 * An entry already claimed by a sealed settlement cannot be voided — the rules
 * refuse it. Correct one of those with a signed adjustment in the open period
 * instead, so the sealed statement keeps saying what it said when it was
 * handed over.
 */
export function voidEntry(
  uid: string,
  shopId: string,
  transactionId: string,
  reason: string,
): Promise<void> {
  const db = requireDb();
  const synced = detach(
    updateDoc(transactionDoc(db, uid, shopId, transactionId), {
      voidedAt: serverTimestamp(),
      voidReason: reason.trim().slice(0, 300),
      updatedAt: serverTimestamp(),
    }),
  );

  void recordAudit(uid, {
    action: 'void',
    entity: 'transaction',
    entityId: transactionId,
    summary: reason.trim().slice(0, 200),
  });

  return synced;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

const KIND_SET = new Set<string>(TRANSACTION_KINDS);
const FALLBACK_DATE = '2000-01-01' as CalendarDate;

/**
 * Reads a stored document defensively.
 *
 * A corrupted or partially-written field must not become `NaN` in an amount: a
 * single `NaN` turns every total on the screen into `NaN`, which is both
 * useless and alarming. An unreadable field falls back to something harmless
 * and the entry stays visible so the user can see and fix it.
 */
export function transactionFromDoc(id: string, data: Record<string, unknown>): Transaction {
  const amount = typeof data.amount === 'number' && isValidAmount(data.amount) ? data.amount : 0;
  const kind = (typeof data.kind === 'string' && KIND_SET.has(data.kind)
    ? data.kind
    : 'adjustment') as TransactionKind;
  const transactionDate = isCalendarDate(data.transactionDate)
    ? data.transactionDate
    : FALLBACK_DATE;
  const recognitionDate = isCalendarDate(data.recognitionDate)
    ? data.recognitionDate
    : transactionDate;

  return {
    id,
    uid: typeof data.uid === 'string' ? data.uid : '',
    shopId: typeof data.shopId === 'string' ? data.shopId : '',
    kind,
    amount: paise(amount),
    direction: data.direction === 'debit' ? 'debit' : 'credit',
    category: typeof data.category === 'string' ? data.category : '',
    description: typeof data.description === 'string' ? data.description : '',
    transactionDate,
    recognitionDate,
    periodKey: (typeof data.periodKey === 'string'
      ? data.periodKey
      : recognitionDate.slice(0, 7)) as PeriodKey,
    sortKey: typeof data.sortKey === 'string' ? data.sortKey : `${transactionDate}#0#${id}`,
    clientCreatedAtMs: typeof data.clientCreatedAtMs === 'number' ? data.clientCreatedAtMs : 0,
    reimbursable: typeof data.reimbursable === 'boolean' ? data.reimbursable : null,
    fundedFrom:
      data.fundedFrom === 'own' || data.fundedFrom === 'shopFloat'
        ? (data.fundedFrom as FundedFrom)
        : null,
    accrualKey: typeof data.accrualKey === 'string' ? data.accrualKey : null,
    settlesExpenseIds: Array.isArray(data.settlesExpenseIds)
      ? data.settlesExpenseIds.filter((value): value is string => typeof value === 'string')
      : null,
    recoversTransactionId:
      typeof data.recoversTransactionId === 'string' ? data.recoversTransactionId : null,
    pairId: typeof data.pairId === 'string' ? data.pairId : null,
    settlementId: typeof data.settlementId === 'string' ? data.settlementId : null,
    isPriorPeriodAdjustment: data.isPriorPeriodAdjustment === true,
    adjustsSettlementId:
      typeof data.adjustsSettlementId === 'string' ? data.adjustsSettlementId : null,
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
    voidedAt: data.voidedAt ?? null,
    voidReason: typeof data.voidReason === 'string' ? data.voidReason : null,
  };
}

function subscribe(
  source: Query,
  onChange: (transactions: Transaction[]) => void,
  onError: (error: Error) => void,
): () => void {
  return onSnapshot(
    source,
    (snapshot) => onChange(snapshot.docs.map((entry) => transactionFromDoc(entry.id, entry.data()))),
    (error) => onError(error),
  );
}

/**
 * Every entry for one shop, newest first, voided ones included.
 *
 * Voided entries are fetched rather than filtered out in the query so the
 * history view can show them struck through. The engine excludes them from
 * every calculation, so including them here costs nothing but a little
 * bandwidth and avoids a second listener.
 */
export function watchShopTransactions(
  uid: string,
  shopId: string,
  onChange: (transactions: Transaction[]) => void,
  onError: (error: Error) => void,
): () => void {
  const db = getDb();
  if (!db) {
    onChange([]);
    return () => {};
  }
  return subscribe(
    query(
      transactionsCollection(db, uid, shopId),
      orderBy('sortKey', 'desc'),
      fsLimit(TRANSACTION_PAGE_LIMIT),
    ),
    onChange,
    onError,
  );
}

/** One month of a shop's ledger — what the engine needs for a statement. */
export function watchPeriodTransactions(
  uid: string,
  shopId: string,
  period: PeriodKey,
  onChange: (transactions: Transaction[]) => void,
  onError: (error: Error) => void,
): () => void {
  const db = getDb();
  if (!db) {
    onChange([]);
    return () => {};
  }
  return subscribe(
    query(
      transactionsCollection(db, uid, shopId),
      where('periodKey', '==', period),
      orderBy('sortKey', 'desc'),
    ),
    onChange,
    onError,
  );
}
