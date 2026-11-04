/**
 * Turning what the user typed into a ledger entry.
 *
 * Pure: no Firestore, no React, no clock. `today` arrives as an argument, and
 * the result is a plain object the data layer writes. Keeping it here rather
 * than inside the write call means the rules that decide *which period an entry
 * lands in* can be tested directly, which matters because getting that wrong
 * silently rewrites a statement someone has already been handed.
 */

import {
  addDays,
  compareDates,
  isCalendarDate,
  periodKeyOf,
  type CalendarDate,
  type PeriodKey,
} from '@/lib/dates';
import { isValidAmount, type Paise } from '@/lib/money';
import type {
  Direction,
  FundedFrom,
  Shop,
  Transaction,
  TransactionKind,
} from '@/types/models';
import { KIND_DIRECTION, KIND_LABEL } from '@/types/models';

export const MAX_DESCRIPTION = 500;
export const MAX_CATEGORY = 40;

export interface EntryInput {
  readonly kind: TransactionKind;
  /** Positive for every kind except `adjustment`, which carries its own sign. */
  readonly amount: Paise;
  readonly transactionDate: CalendarDate;
  readonly category: string;
  readonly description: string;
  readonly reimbursable?: boolean | null;
  readonly fundedFrom?: FundedFrom | null;
  readonly settlesExpenseIds?: readonly string[] | null;
  readonly recoversTransactionId?: string | null;
  readonly pairId?: string | null;
  readonly accrualKey?: string | null;
}

export type EntryField = keyof EntryInput;

export interface EntryError {
  readonly field: EntryField;
  readonly message: string;
}

/** Exactly what is stored, with no `id` and no timestamps. */
export type EntryDocument = Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * The fields a stored entry may have, in the order the rules list them.
 * Kept here beside the builder so the two cannot drift apart.
 */
export const ENTRY_DOCUMENT_FIELDS: readonly (keyof EntryDocument)[] = [
  'uid',
  'shopId',
  'kind',
  'amount',
  'direction',
  'category',
  'description',
  'transactionDate',
  'recognitionDate',
  'periodKey',
  'sortKey',
  'clientCreatedAtMs',
  'reimbursable',
  'fundedFrom',
  'accrualKey',
  'settlesExpenseIds',
  'recoversTransactionId',
  'pairId',
  'settlementId',
  'isPriorPeriodAdjustment',
  'adjustsSettlementId',
  'voidedAt',
  'voidReason',
];

export function directionFor(kind: TransactionKind): Direction {
  return KIND_DIRECTION[kind];
}

/**
 * Where an entry is *recognised*, as opposed to when it happened.
 *
 * These differ in exactly one case: the entry is dated inside a period that has
 * already been sealed. The entry keeps its true date — that is the record of
 * what happened — but it is recognised on the first open day, so it appears in
 * the current statement rather than altering a sealed one. The sealed statement
 * is flagged for reconciliation separately; its figures are never touched.
 */
export function recognitionFor(
  shop: Pick<Shop, 'sealedThroughDate'>,
  transactionDate: CalendarDate,
): {
  recognitionDate: CalendarDate;
  periodKey: PeriodKey;
  isPriorPeriodAdjustment: boolean;
} {
  const sealed = shop.sealedThroughDate;
  if (sealed && compareDates(transactionDate, sealed) <= 0) {
    const recognitionDate = addDays(sealed, 1);
    return {
      recognitionDate,
      periodKey: periodKeyOf(recognitionDate),
      isPriorPeriodAdjustment: true,
    };
  }
  return {
    recognitionDate: transactionDate,
    periodKey: periodKeyOf(transactionDate),
    isPriorPeriodAdjustment: false,
  };
}

/**
 * The ordering key. Not `createdAt`: `serverTimestamp()` reads back as null
 * until the server acknowledges the write, so an entry added offline would have
 * no position in a sorted list — sometimes for hours — and would jump when it
 * finally synced. This key is final the moment the write is queued.
 */
export function buildSortKey(
  transactionDate: CalendarDate,
  clientCreatedAtMs: number,
  id: string,
): string {
  return `${transactionDate}#${String(clientCreatedAtMs).padStart(15, '0')}#${id}`;
}

function isExpense(kind: TransactionKind): boolean {
  return kind === 'expense_paid';
}

/**
 * Validates an entry against the shop it is going into.
 *
 * Returns every problem rather than stopping at the first, so a form can show
 * them all at once. The security rules repeat these checks server-side; this
 * exists to give a useful message, not to provide the guarantee.
 */
export function validateEntry(
  shop: Pick<Shop, 'openingBalanceAsOf' | 'joiningDate'>,
  input: EntryInput,
  today: CalendarDate,
): EntryError[] {
  const errors: EntryError[] = [];

  if (!isValidAmount(input.amount)) {
    errors.push({ field: 'amount', message: 'That amount is out of range' });
  } else if (input.amount === 0) {
    errors.push({ field: 'amount', message: 'Enter an amount' });
  } else if (input.kind !== 'adjustment' && input.amount < 0) {
    errors.push({
      field: 'amount',
      message: `${KIND_LABEL[input.kind]} must be a positive amount`,
    });
  }

  if (!isCalendarDate(input.transactionDate)) {
    errors.push({ field: 'transactionDate', message: 'Pick a date' });
  } else {
    if (compareDates(input.transactionDate, today) > 0) {
      // This is a record of what has happened, not a plan.
      errors.push({ field: 'transactionDate', message: 'That date is in the future' });
    }
    if (compareDates(input.transactionDate, shop.openingBalanceAsOf) < 0) {
      // Anything earlier is already inside the opening figure, so recording it
      // again would count the same money twice.
      errors.push({
        field: 'transactionDate',
        message: 'That is before this shop’s opening balance date',
      });
    }
  }

  if (input.category.length > MAX_CATEGORY) {
    errors.push({ field: 'category', message: 'That category name is too long' });
  }
  if (input.description.length > MAX_DESCRIPTION) {
    errors.push({ field: 'description', message: 'Keep the note shorter' });
  }

  if (isExpense(input.kind)) {
    if (input.reimbursable !== true && input.reimbursable !== false) {
      errors.push({ field: 'reimbursable', message: 'Say whether this comes back to you' });
    }
    if (input.fundedFrom !== 'own' && input.fundedFrom !== 'shopFloat') {
      errors.push({ field: 'fundedFrom', message: 'Say whose money paid for this' });
    }
  } else if (input.reimbursable != null || input.fundedFrom != null) {
    errors.push({
      field: 'reimbursable',
      message: 'Only an expense can be reimbursable',
    });
  }

  if (input.settlesExpenseIds && input.settlesExpenseIds.length > 50) {
    errors.push({ field: 'settlesExpenseIds', message: 'Too many linked expenses' });
  }

  return errors;
}

/**
 * The document body for a new entry.
 *
 * Note what is NOT in it: `id`. The id is the document's key, so repeating it
 * inside the document is redundant — and the security rules whitelist fields
 * exactly, so an extra one is rejected outright. It still arrives as an
 * argument because the sort key is built from it.
 *
 * `createdAt` and `updatedAt` are left to the caller, which supplies the server
 * timestamp sentinel; everything else is decided here so a write cannot be
 * assembled two different ways in two different places.
 */
export function buildEntryDocument(args: {
  readonly id: string;
  readonly uid: string;
  readonly shop: Pick<Shop, 'id' | 'sealedThroughDate'>;
  readonly input: EntryInput;
  readonly clientCreatedAtMs: number;
}): EntryDocument {
  const { id, uid, shop, input, clientCreatedAtMs } = args;
  const { recognitionDate, periodKey, isPriorPeriodAdjustment } = recognitionFor(
    shop,
    input.transactionDate,
  );

  return {
    uid,
    shopId: shop.id,
    kind: input.kind,
    amount: input.amount,
    direction: directionFor(input.kind),
    category: input.category.trim(),
    description: input.description.trim(),
    transactionDate: input.transactionDate,
    recognitionDate,
    periodKey,
    sortKey: buildSortKey(input.transactionDate, clientCreatedAtMs, id),
    clientCreatedAtMs,
    reimbursable: isExpense(input.kind) ? (input.reimbursable ?? null) : null,
    fundedFrom: isExpense(input.kind) ? (input.fundedFrom ?? null) : null,
    accrualKey: input.accrualKey ?? null,
    settlesExpenseIds: input.settlesExpenseIds ? [...input.settlesExpenseIds] : null,
    recoversTransactionId: input.recoversTransactionId ?? null,
    pairId: input.pairId ?? null,
    settlementId: null,
    isPriorPeriodAdjustment,
    // Set by the sealing run when it detects the disturbed statement; the entry
    // itself does not know which settlement it landed behind.
    adjustsSettlementId: null,
    voidedAt: null,
    voidReason: null,
  };
}

/**
 * The two entries for a cash bonus or tip: earned and received on the same day.
 *
 * Recording only the cash would make it look like a payment against an existing
 * balance, quietly reducing what the shop still owes. Recording only the
 * earning would leave a balance that is never settled. Both, sharing a
 * `pairId`, net to zero and show up correctly in the month's income.
 */
export function buildCashBonusPair(input: {
  readonly amount: Paise;
  readonly transactionDate: CalendarDate;
  readonly description: string;
  readonly category: string;
  readonly pairId: string;
}): [EntryInput, EntryInput] {
  const shared = {
    amount: input.amount,
    transactionDate: input.transactionDate,
    category: input.category,
    pairId: input.pairId,
  };
  return [
    { ...shared, kind: 'other_income_earned', description: input.description },
    {
      ...shared,
      kind: 'salary_payment_received',
      description: `${input.description} (paid in cash)`,
    },
  ];
}
