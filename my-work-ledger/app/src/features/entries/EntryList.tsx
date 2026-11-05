/**
 * The history: every entry, in the order it happened, with the balance after
 * each one.
 *
 * Laid out the way a shop ledger is kept on paper — a heading for each day,
 * then two money columns, one for what was added to what you are owed and one
 * for what you were paid — because that is the shape the people using this
 * already read. The balance after each entry sits beside it as a chip.
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
  dateOfMs,
  formatClockTime,
  formatDateShort,
  formatDaysAgo,
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
import { absPaise, formatPaise, type Paise } from '@/lib/money';
import { KIND_LABEL, type Shop, type Transaction } from '@/types/models';

import { useAuth } from '../auth/AuthProvider';
import { groupEntriesByDay, groupTotals, type EntryGroup, type GroupedRow } from './grouping';

type Filter = 'all' | 'credit' | 'debit';

const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'credit', label: 'Owed to you' },
  { value: 'debit', label: 'You got' },
];

/** The two money columns, shared by the header, every row and the footer. */
const COLUMNS = 'grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-2 sm:gap-4';
const MONEY_CELL = 'min-w-[4.25rem] shrink-0 text-right sm:min-w-[6rem]';

function matchesFilter(row: RunningRow, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'credit') return row.effect > 0;
  return row.effect < 0;
}

function matchesSearch(transaction: Transaction, needle: string): boolean {
  if (needle === '') return true;
  const haystack =
    `${transaction.description} ${transaction.category} ${KIND_LABEL[transaction.kind]}`.toLowerCase();
  return haystack.includes(needle);
}

/**
 * The clock time an entry was written, but only when it was written on the day
 * it is dated. For a backdated entry the two are different days and showing the
 * time would suggest a precision the record does not have.
 */
function timeOfEntry(transaction: Transaction): string | null {
  if (dateOfMs(transaction.clientCreatedAtMs) !== transaction.transactionDate) return null;
  return formatClockTime(transaction.clientCreatedAtMs);
}

/**
 * The running balance after an entry, as a chip.
 *
 * The magnitude only: the direction is carried by the colour and by the column
 * the amount sits in, and a minus sign inside "Bal." reads as a negative debt
 * rather than as "you owe them".
 */
function BalanceChip({ value }: { value: Paise }) {
  const tone =
    value > 0
      ? 'bg-credit-soft text-credit-strong'
      : value < 0
        ? 'bg-debit-soft text-debit-strong'
        : 'bg-surface-2 text-ink-3';
  return (
    <span
      className={`wl-amount inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.7rem] font-semibold ${tone}`}
    >
      Bal. {formatPaise(absPaise(value))}
      {/* Written out, because a tint alone does not say which way it goes. */}
      {value < 0 ? <span className="font-normal">you owe</span> : null}
    </span>
  );
}

function EntryRow({ row, onOpen }: { row: GroupedRow; onOpen: (row: GroupedRow) => void }) {
  const { transaction, effect, balanceAfter, side } = row;
  const voided = transaction.voidedAt != null;
  const time = timeOfEntry(transaction);
  const struck = voided ? 'line-through opacity-60' : '';

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(row)}
        aria-label={`${transaction.description || KIND_LABEL[transaction.kind]}, open details`}
        className={`${COLUMNS} w-full px-4 py-2.5 text-left hover:bg-surface-2`}
      >
        <span className="min-w-0">
          <span className={`block truncate text-sm font-semibold text-ink ${struck}`}>
            {transaction.description || KIND_LABEL[transaction.kind]}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
            {voided ? <Badge tone="danger">voided</Badge> : <BalanceChip value={balanceAfter} />}
            {time ? <span>{time}</span> : null}
            {/* Only when it is not already standing in as the title. */}
            {transaction.description ? (
              <span className="truncate">{KIND_LABEL[transaction.kind]}</span>
            ) : null}
            {transaction.isPriorPeriodAdjustment ? <Badge tone="debit">late entry</Badge> : null}
          </span>
        </span>

        {/* Owed to you */}
        <span className={MONEY_CELL}>
          {side === 'credit' ? (
            <span className={struck}>
              <Amount value={effect} tone="credit" size="md" />
            </span>
          ) : side === 'none' ? (
            <span className="text-xs text-ink-3">not owed back</span>
          ) : null}
        </span>

        {/* You got */}
        <span className={MONEY_CELL}>
          {side === 'debit' ? (
            <span className={struck}>
              <Amount value={absPaise(effect)} tone="debit" size="md" />
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

function DayGroup({
  group,
  today,
  onOpen,
}: {
  group: EntryGroup;
  today: CalendarDate;
  onOpen: (row: GroupedRow) => void;
}) {
  return (
    <section>
      <h3 className="flex flex-wrap items-baseline gap-x-2 border-y border-line bg-surface-2 px-4 py-1.5 text-xs font-semibold text-ink-2">
        {formatDateShort(group.date)}
        <span className="font-normal text-ink-3">· {formatDaysAgo(group.date, today)}</span>
      </h3>
      <ul className="divide-y divide-line/70">
        {group.rows.map((row) => (
          <EntryRow key={row.transaction.id} row={row} onOpen={onOpen} />
        ))}
      </ul>
    </section>
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
  const [opened, setOpened] = useState<GroupedRow | null>(null);
  const [voiding, setVoiding] = useState<Transaction | null>(null);
  const [reason, setReason] = useState('');

  const currentPeriod = periodKeyOf(today);

  const groups = useMemo(() => {
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
    const visible = all.filter(
      (row) => matchesFilter(row, filter) && matchesSearch(row.transaction, needle),
    );
    return groupEntriesByDay(visible, 'newest');
  }, [transactions, openingBalance, period, filter, search, showVoided]);

  const totals = useMemo(() => groupTotals(groups), [groups]);
  const rowCount = groups.reduce((count, group) => count + group.rows.length, 0);

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
    setOpened(null);
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

      <Card className="overflow-hidden">
        {rowCount === 0 ? (
          <EmptyState title={search || filter !== 'all' ? 'Nothing matches' : 'No entries yet'}>
            {search || filter !== 'all'
              ? 'Try a different search or filter.'
              : `Use "You got" or "You gave" to record what happened at ${shop.name}.`}
          </EmptyState>
        ) : (
          <>
            <div
              className={`${COLUMNS} px-4 pt-3 pb-2 text-[0.65rem] font-bold tracking-wide text-ink-3 uppercase`}
            >
              <span>Entries</span>
              <span className={MONEY_CELL}>Owed to you</span>
              <span className={MONEY_CELL}>You got</span>
            </div>

            {groups.map((group) => (
              <DayGroup key={group.date} group={group} today={today} onOpen={setOpened} />
            ))}

            <div
              className={`${COLUMNS} border-t-2 border-line-strong px-4 py-3 text-sm font-semibold text-ink`}
            >
              <span>{formatPeriod(period)} total</span>
              <span className={MONEY_CELL}>
                <Amount value={totals.credit} tone="credit" size="md" />
              </span>
              <span className={MONEY_CELL}>
                <Amount value={totals.debit} tone="debit" size="md" />
              </span>
            </div>
          </>
        )}
      </Card>

      {opened ? (
        <Modal
          open
          onClose={() => setOpened(null)}
          title={opened.transaction.description || KIND_LABEL[opened.transaction.kind]}
          footer={
            <>
              <Button tone="ghost" onClick={() => setOpened(null)} className="flex-1">
                Close
              </Button>
              {opened.transaction.voidedAt == null ? (
                <Button tone="danger" onClick={() => setVoiding(opened.transaction)}>
                  <Ban size={14} />
                  Void this
                </Button>
              ) : null}
            </>
          }
        >
          <EntryDetail row={opened} today={today} />
        </Modal>
      ) : null}

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

/** Everything stored about one entry, for the sheet a tap on a row opens. */
function EntryDetail({ row, today }: { row: GroupedRow; today: CalendarDate }) {
  const { transaction, effect, balanceAfter, side } = row;
  const time = timeOfEntry(transaction);

  const facts: readonly (readonly [string, string] | null)[] = [
    ['Kind', KIND_LABEL[transaction.kind]],
    [
      'Date',
      `${formatDateShort(transaction.transactionDate)} (${formatDaysAgo(
        transaction.transactionDate,
        today,
      )})${time ? ` · entered ${time}` : ''}`,
    ],
    transaction.recognitionDate !== transaction.transactionDate
      ? ['Counted in', formatDateShort(transaction.recognitionDate)]
      : null,
    transaction.category ? ['Category', transaction.category] : null,
    transaction.fundedFrom
      ? ['Paid from', transaction.fundedFrom === 'own' ? 'Your own money' : "The shop's float"]
      : null,
    transaction.reimbursable === false ? ['Owed back', 'No — your own cost'] : null,
    transaction.settlementId ? ['Settled', 'Part of a sealed statement'] : null,
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-line bg-surface-2 px-4 py-3">
        <p className="text-xs font-semibold tracking-wide text-ink-3 uppercase">
          {side === 'credit' ? 'Added to what you are owed' : side === 'debit' ? 'You got' : 'Recorded, nothing owed'}
        </p>
        <p className="mt-1">
          <Amount
            value={absPaise(effect)}
            tone={side === 'credit' ? 'credit' : side === 'debit' ? 'debit' : 'muted'}
            size="lg"
            showPaise
          />
        </p>
        <p className="mt-1 text-sm text-ink-2">
          Balance after this entry: <Amount value={balanceAfter} tone="balance" size="sm" showPaise />
        </p>
      </div>

      <dl className="flex flex-col gap-2 text-sm">
        {facts.map((fact) =>
          fact ? (
            <div key={fact[0]} className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
              <dt className="text-ink-3">{fact[0]}</dt>
              <dd className="font-medium text-ink">{fact[1]}</dd>
            </div>
          ) : null,
        )}
      </dl>

      {transaction.voidedAt != null ? (
        <p className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          Voided{transaction.voidReason ? `: ${transaction.voidReason}` : ''}
        </p>
      ) : null}
    </div>
  );
}
