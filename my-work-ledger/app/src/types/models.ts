/**
 * The stored data model.
 *
 * These types describe exactly what lives in Firestore. They are the contract
 * that `firebase/firestore.rules` enforces on the server side — when a field is
 * added here it must be added there too, because the rules whitelist fields and
 * reject anything unknown.
 */

import type { CalendarDate, PeriodKey } from '@/lib/dates';
import type { Paise } from '@/lib/money';

/** Bumped when a migration is needed; stored on the user document. */
export const SCHEMA_VERSION = 1;

export interface UserProfile {
  readonly schemaVersion: number;
  readonly displayName: string;
  /** ISO 4217. Only INR is implemented; stored so a future currency is explicit. */
  readonly currency: 'INR';
  readonly createdAt: unknown;
  readonly updatedAt: unknown;
}

export type ShopStatus = 'active' | 'archived';

/**
 * How a shop settles up.
 *
 * `accrual` is the normal case: salary is earned monthly and the balance shows
 * what is outstanding. `cashOnly` suits a daily-wage shop where nothing accrues
 * and only actual payments are recorded, so an unpaid day is not a receivable.
 */
export type SettlementMode = 'accrual' | 'cashOnly';

export interface Shop {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly joiningDate: CalendarDate;
  /** Day of month salary is due; clamped into short months when used. */
  readonly salaryPayDay: number;
  readonly settlementMode: SettlementMode;
  /** Balance carried in on `openingBalanceAsOf`; positive means the shop owes you. */
  readonly openingBalance: Paise;
  readonly openingBalanceAsOf: CalendarDate;
  /**
   * The last day covered by a sealed settlement. Entries dated on or before it
   * are recognised in the current open period instead, so sealed statements are
   * never rewritten.
   */
  readonly sealedThroughDate: CalendarDate | null;
  readonly status: ShopStatus;
  readonly createdAt: unknown;
  readonly updatedAt: unknown;
}

export type IncomeKind = 'salary' | 'allowance' | 'other';

export type IncomeFrequency = 'monthly' | 'weekly' | 'daily' | 'oneTime';

/**
 * A recurring entitlement. Effective-dated rather than edited in place, so a
 * raise does not silently rewrite what was earned last month.
 */
export interface IncomeConfig {
  readonly id: string;
  readonly kind: IncomeKind;
  readonly label: string;
  readonly amount: Paise;
  readonly frequency: IncomeFrequency;
  readonly effectiveFrom: CalendarDate;
  readonly effectiveTo: CalendarDate | null;
  readonly active: boolean;
  readonly createdAt: unknown;
  readonly updatedAt: unknown;
}

/**
 * The nine kinds of ledger entry. The kind alone decides the sign, so no entry
 * carries a signed amount except `adjustment`, which is a correction by
 * definition.
 */
export type TransactionKind =
  | 'salary_earned'
  | 'allowance_earned'
  | 'other_income_earned'
  | 'expense_paid'
  | 'advance_received'
  | 'salary_payment_received'
  | 'reimbursement_received'
  | 'deduction'
  | 'adjustment';

export const TRANSACTION_KINDS: readonly TransactionKind[] = [
  'salary_earned',
  'allowance_earned',
  'other_income_earned',
  'expense_paid',
  'advance_received',
  'salary_payment_received',
  'reimbursement_received',
  'deduction',
  'adjustment',
];

/** `credit` increases what the shop owes you; `debit` reduces it. */
export type Direction = 'credit' | 'debit';

/**
 * Where the money for an expense came from.
 *
 * Only `own` creates a receivable. An expense paid out of the shop's own petty
 * cash is a record of spending, not of the shop owing you — treating it as one
 * is how a float silently inflates a balance.
 */
export type FundedFrom = 'own' | 'shopFloat';

export interface Transaction {
  readonly id: string;
  /**
   * Denormalised owner. Redundant inside `users/{uid}/...` but required for the
   * collection-group query the cross-shop dashboard runs, and asserted by the
   * rules so it cannot be forged.
   */
  readonly uid: string;
  readonly shopId: string;
  readonly kind: TransactionKind;
  /** Always positive except for `adjustment`, which may be signed. */
  readonly amount: Paise;
  readonly direction: Direction;
  readonly category: string;
  readonly description: string;

  /** The day it really happened. Never changed, not even by a reconciliation. */
  readonly transactionDate: CalendarDate;
  /**
   * The day the ledger counts it. Equal to `transactionDate` except for an
   * entry backdated into a sealed period, where it moves to the first open day.
   */
  readonly recognitionDate: CalendarDate;
  /** `recognitionDate`'s month — what month queries filter on. */
  readonly periodKey: PeriodKey;
  /**
   * `transactionDate#clientCreatedAtMs#id`. Sorting on this is stable the
   * instant a write is queued, whereas `createdAt` reads back as null until the
   * server acknowledges it, which offline may be hours later.
   */
  readonly sortKey: string;
  readonly clientCreatedAtMs: number;

  readonly reimbursable: boolean | null;
  readonly fundedFrom: FundedFrom | null;

  /** `configId:periodKey` for a posted accrual, so duplicates are detectable. */
  readonly accrualKey: string | null;
  /** Expenses this reimbursement clears, for the double-count warning. */
  readonly settlesExpenseIds: readonly string[] | null;
  /** An advance or expense this deduction recovers. */
  readonly recoversTransactionId: string | null;
  /** Links the two halves of a cash bonus (earned + received on the same day). */
  readonly pairId: string | null;

  /** Set when a sealing run has claimed this entry. */
  readonly settlementId: string | null;
  readonly isPriorPeriodAdjustment: boolean;
  /** The sealed settlement a backdated entry disturbed. */
  readonly adjustsSettlementId: string | null;

  readonly createdAt: unknown;
  readonly updatedAt: unknown;
  readonly voidedAt: unknown | null;
  readonly voidReason: string | null;
}

/** The sign each kind contributes to the balance. */
export const KIND_SIGN: Readonly<Record<TransactionKind, 1 | -1 | 0>> = {
  salary_earned: 1,
  allowance_earned: 1,
  other_income_earned: 1,
  expense_paid: 1, // reduced to 0 when non-reimbursable or shop-funded
  advance_received: -1,
  salary_payment_received: -1,
  reimbursement_received: -1,
  deduction: -1,
  adjustment: 1, // the stored amount is already signed
};

export const KIND_DIRECTION: Readonly<Record<TransactionKind, Direction>> = {
  salary_earned: 'credit',
  allowance_earned: 'credit',
  other_income_earned: 'credit',
  expense_paid: 'credit',
  advance_received: 'debit',
  salary_payment_received: 'debit',
  reimbursement_received: 'debit',
  deduction: 'debit',
  adjustment: 'credit',
};

export const KIND_LABEL: Readonly<Record<TransactionKind, string>> = {
  salary_earned: 'Salary earned',
  allowance_earned: 'Allowance earned',
  other_income_earned: 'Other income',
  expense_paid: 'Expense paid',
  advance_received: 'Advance received',
  salary_payment_received: 'Salary paid to you',
  reimbursement_received: 'Reimbursement received',
  deduction: 'Deduction',
  adjustment: 'Adjustment',
};

export type SealState = 'stamping' | 'sealed';

export type SettlementStatus = 'sealed' | 'needs_reconciliation';

/**
 * A statement, not a money movement. Cash handed over at settlement time is an
 * ordinary `salary_payment_received`; conflating the two double-counts every
 * settlement.
 */
export interface Settlement {
  readonly id: string;
  readonly shopId: string;
  readonly periodStart: CalendarDate;
  readonly periodEnd: CalendarDate;
  readonly settlementDate: CalendarDate;
  readonly openingBalance: Paise;
  readonly closingBalance: Paise;
  readonly totals: Readonly<Record<TransactionKind, Paise>>;
  readonly transactionCount: number;
  readonly statementNo: number;
  readonly sealState: SealState;
  readonly status: SettlementStatus;
  readonly notes: string;
  readonly sealedAt: unknown | null;
  readonly createdAt: unknown;
}

/**
 * One day at one shop — stored only when it differs from the ordinary case.
 *
 * A date with no document means "worked, and no daily allowance was handed
 * over". So a year of normal attendance costs nothing, and the collection only
 * holds the exceptions: days off, and days the food money actually arrived.
 *
 * The document id is the date itself, which makes every write idempotent: two
 * taps, or two devices, address the same document instead of creating a second
 * record of the same day.
 */
export interface DayRecord {
  readonly date: CalendarDate;
  /** True when the day was not worked. A day off does not accrue salary. */
  readonly off: boolean;
  /** Ids of the daily allowance configs actually received on this day. */
  readonly allowancesReceived: readonly string[];
  readonly note: string;
  /**
   * No `createdAt`: the document is an upsert addressed by its own date, so
   * every write is a merge and an immutable creation stamp would make the
   * second write to a day illegal. `updatedAt` is all this record needs.
   */
  readonly updatedAt: unknown;
}

export type ReminderType = 'daily' | 'weekly' | 'monthly' | 'oneTime';

/**
 * What a reminder is for.
 *
 * The four automatic kinds work out what to say from the ledger every time
 * they are shown, so their wording and figures cannot go stale. Only the
 * schedule — whether they are on, and at what time — is stored, under a
 * deterministic id so creating them on first run is idempotent.
 */
export type ReminderKind =
  | 'custom'
  | 'salaryDueSoon'
  | 'monthEnded'
  | 'dailyTick'
  | 'settleReady';

export const AUTO_REMINDER_KINDS: readonly ReminderKind[] = [
  'salaryDueSoon',
  'monthEnded',
  'dailyTick',
  'settleReady',
];

/** The stored id for an automatic reminder. Deterministic, so writes are upserts. */
export const AUTO_REMINDER_IDS: Readonly<Record<string, string>> = {
  salaryDueSoon: 'auto_salary_due',
  monthEnded: 'auto_month_ended',
  dailyTick: 'auto_daily_tick',
  settleReady: 'auto_settle_ready',
};

export interface Reminder {
  readonly id: string;
  readonly kind: ReminderKind;
  /** The shop it concerns, or null when it is not about one shop. */
  readonly shopId: string | null;
  readonly type: ReminderType;
  readonly title: string;
  readonly body: string;
  /** 0-6, Sunday first, for a weekly reminder. */
  readonly weekday: number | null;
  /** 1-31 for a monthly reminder, clamped into short months when it fires. */
  readonly dayOfMonth: number | null;
  /** The single day a one-time reminder falls on. */
  readonly onDate: CalendarDate | null;
  /** `HH:MM` in the device's own timezone. */
  readonly time: string;
  readonly enabled: boolean;
  readonly lastFiredAt: unknown | null;
  /**
   * No `createdAt`. The automatic reminders are addressed by a deterministic
   * id, so switching one on is an upsert — and an immutable creation stamp
   * would make the second write to the same document illegal. A reminder has
   * no audit value to protect, unlike every other record here.
   */
}

export type AuditAction = 'create' | 'update' | 'void' | 'seal' | 'reconcile';

export interface AuditLog {
  readonly id: string;
  readonly action: AuditAction;
  readonly entity: 'shop' | 'incomeConfig' | 'transaction' | 'settlement' | 'profile';
  readonly entityId: string;
  readonly summary: string;
  readonly at: unknown;
}
