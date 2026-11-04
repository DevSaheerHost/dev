/**
 * The history: every entry, in the order it happened, with the balance after
 * each one.
 *
 * The running balance is the point. A list of amounts tells you what happened;
 * a running balance tells you whether the figure you are arguing about is
 * right, and which entry it went wrong at.
 *
 * Voided entries are kept and shown struck through behind a toggle, because the
 * question "why did this change?" is exactly what a ledger exists to answer.
 */

import { useMemo, useState } from 'react';
import { Ban, ChevronLeft, ChevronRight, Search, Undo2 } from 'lucide-react';

import { Amount, Badge, Button, Card, EmptyState, Modal, TextInput } from '@/components/ui';
import { voidEntry } from '@/data/transactions';
import {
  addMonths,
  formatDateShort,
  formatPeriod,
  periodKeyOf,
  type CalendarDate,
  type PeriodKey,
} from '@/lib/dates';
import {
  entriesForPeriod,
  runningBalance,
  transactionEffect,
  type RunningRow,
} from '@/features/ledger/engine';
import { periodEnd, periodStart } from '@/lib/dates';
import type { Paise } from '@/lib/money';
import { KIND_LABEL, type Shop, type Transaction, type TransactionKind } from '@/types/models';

import { useAuth } from '../auth/AuthProvider';

type Filter = 'all' | 'in' | 'out';

const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'in', label: 'You got' },
  { value: 'out', label: 'You gave' },
];

/** Kinds that represent money arriving in your hand. */
const INCOMING: ReadonlySet<TransactionKind> = new Set([
  'advance_received',
  'salary_payment_received',
  'reimbursement_received',
]);

function matchesFilter(transaction: Transaction, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'in') return INCOMING.has(transaction.kind);
  return transaction.kind === 'expense_paid';
}

function matchesSearch(transaction: Transaction, needle: string): boolean {
  if (needle === '') return true;
  const haystack =
    `${transaction.description} ${transaction.category} ${KIND_LABEL[transaction.kind]}`.toLowerCase();
  return haystack.includes(needle);
}

function EntryRow({
  row,
  onVoid,
}: {
  row: RunningRow;
  onVoid: (transaction: Transaction) => void;
}) {
  const { transaction, effect, balanceAfter } = row;
  const voided = transaction.voidedAt != null;

  return (
    <li className="border-b border-line px-4 py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`truncate text-sm font-semibold ${voided ? 'text-ink-3 line-through' : 'text-ink'}`}>
            {transaction.description || KIND_LABEL[transaction.kind]}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
            <span>{formatDateShort(transaction.transactionDate)}</span>
            <span aria-hidden>·</span>
            <span>{KIND_LABEL[transaction.kind]}</span>
            {transaction.category ? <Badge>{transaction.category}</Badge> : null}
            {transaction.kind === 'expense_paid' && effect === 0 ? (
              <Badge>not owed back</Badge>
            ) : null}
            {transaction.isPriorPeriodAdjustment ? <Badge tone="debit">late entry</Badge> : null}
          </p>
          {voided && transaction.voidReason ? (
            <p className="mt-1 text-xs text-ink-3">Voided: {transaction.voidReason}</p>
          ) : null}
        </div>

        <div className="shrink-0 text-right">
          <p className={voided ? 'line-through opacity-60' : ''}>
            <Amount value={effect} tone={effect < 0 ? 'debit' : 'credit'} size="md" signed />
          </p>
          <p className="mt-0.5 text-xs text-ink-3">
            balance <Amount value={balanceAfter} tone="muted" size="sm" />
          </p>
        </div>
      </div>

      {!voided ? (
        <button
          type="button"
          onClick={() => onVoid(transaction)}
          className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-ink-3 hover:bg-surface-2 hover:text-danger"
        >
          <Ban size={13} />
          Void this
        </button>
      ) : null}
    </li>
  );
}

export function EntryList({
  shop,
  transactions,
  openingBalance,
  period,
  onPeriodChange,
  today,
}: {
  shop: Shop;
  transactions: readonly Transaction[];
  /** The balance carried into this period, so the running total is meaningful. */
  openingBalance: Paise;
  period: PeriodKey;
  onPeriodChange: (period: PeriodKey) => void;
  today: CalendarDate;
}) {
  const { uid } = useAuth();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [showVoided, setShowVoided] = useState(false);
  const [voiding, setVoiding] = useState<Transaction | null>(null);
  const [reason, setReason] = useState('');

  const currentPeriod = periodKeyOf(today);

  const rows = useMemo(() => {
    // The running balance is computed over every live entry in the period, then
    // filtered for display — so hiding a row with the search box never changes
    // the balance shown beside the rows that remain.
    const inPeriod = entriesForPeriod(transactions, periodStart(period), periodEnd(period));
    const live = runningBalance(openingBalance, inPeriod);

    const voided = transactions
      .filter(
        (transaction) =>
          transaction.voidedAt != null &&
          transaction.recognitionDate >= periodStart(period) &&
          transaction.recognitionDate <= periodEnd(period),
      )
      .map((transaction) => ({
        transaction,
        effect: transactionEffect(transaction),
        balanceAfter: openingBalance,
      }));

    const all = showVoided ? [...live, ...voided] : live;
    const needle = search.trim().toLowerCase();
    return all.filter(
      (row) => matchesFilter(row.transaction, filter) && matchesSearch(row.transaction, needle),
    );
  }, [transactions, openingBalance, period, filter, search, showVoided]);

  const voidedCount = transactions.filter(
    (transaction) =>
      transaction.voidedAt != null &&
      transaction.recognitionDate >= periodStart(period) &&
      transaction.recognitionDate <= periodEnd(period),
  ).length;

  function confirmVoid() {
    if (!uid || !voiding) return;
    voidEntry(uid, shop.id, voiding.id, reason);
    setVoiding(null);
    setReason('');
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onPeriodChange(addMonths(period, -1))}
          aria-label="Previous month"
          className="grid size-11 place-items-center rounded-xl border border-line-strong text-ink-2 hover:bg-surface-2"
        >
          <ChevronLeft size={17} />
        </button>
        <p className="text-sm font-semibold text-ink">{formatPeriod(period)}</p>
        <button
          type="button"
          onClick={() => onPeriodChange(addMonths(period, 1))}
          disabled={period >= currentPeriod}
          aria-label="Next month"
          className="grid size-11 place-items-center rounded-xl border border-line-strong text-ink-2 hover:bg-surface-2 disabled:opacity-40"
        >
          <ChevronRight size={17} />
        </button>
      </div>

      <div className="relative">
        <Search
          size={15}
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3"
        />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search notes and categories"
          aria-label="Search entries"
          className="min-h-11 w-full rounded-xl border border-line-strong bg-surface pr-3 pl-9 text-base text-ink placeholder:text-ink-3 focus:border-accent"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setFilter(option.value)}
            aria-pressed={filter === option.value}
            className={`min-h-9 rounded-lg border px-3 text-xs font-semibold ${
              filter === option.value
                ? 'border-accent bg-accent-soft text-accent-ink'
                : 'border-line-strong text-ink-2 hover:bg-surface-2'
            }`}
          >
            {option.label}
          </button>
        ))}
        {voidedCount > 0 ? (
          <button
            type="button"
            onClick={() => setShowVoided((previous) => !previous)}
            aria-pressed={showVoided}
            className={`min-h-9 rounded-lg border px-3 text-xs font-semibold ${
              showVoided
                ? 'border-accent bg-accent-soft text-accent-ink'
                : 'border-line-strong text-ink-2 hover:bg-surface-2'
            }`}
          >
            <Undo2 size={12} className="mr-1 inline" />
            {voidedCount} voided
          </button>
        ) : null}
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState title={search || filter !== 'all' ? 'Nothing matches' : 'No entries yet'}>
            {search || filter !== 'all'
              ? 'Try a different search or filter.'
              : `Use "You got" or "You gave" to record what happened at ${shop.name}.`}
          </EmptyState>
        ) : (
          <ul>
            {rows.map((row) => (
              <EntryRow key={row.transaction.id} row={row} onVoid={setVoiding} />
            ))}
          </ul>
        )}
      </Card>

      {voiding ? (
        <Modal
          open
          onClose={() => setVoiding(null)}
          title="Void this entry"
          footer={
            <>
              <Button tone="ghost" onClick={() => setVoiding(null)}>
                Keep it
              </Button>
              <Button tone="danger" onClick={confirmVoid} className="flex-1">
                Void the entry
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm text-ink-2">
              The entry stays in the history, struck through, with your reason beside it. Nothing
              is deleted — that is what makes a past balance explainable.
            </p>
            <p className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm">
              <span className="font-semibold text-ink">
                {voiding.description || KIND_LABEL[voiding.kind]}
              </span>
              <br />
              <span className="text-ink-3">{formatDateShort(voiding.transactionDate)} · </span>
              <Amount value={transactionEffect(voiding)} tone="plain" size="sm" signed />
            </p>
            <TextInput
              label="Why"
              value={reason}
              onChange={setReason}
              maxLength={300}
              placeholder="Entered twice"
            />
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
