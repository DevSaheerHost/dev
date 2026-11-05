/**
 * One shop: what it owes you, how much of the month you have worked, and the
 * two buttons that record everything else.
 *
 * The headline figure climbs on its own, because salary is earned day by day
 * rather than in a lump at month end. That figure is computed, never stored —
 * `computeShopFigures` derives it from the entries, the income configs and the
 * attendance records, so there is no daily job to miss and nothing to reconcile
 * if the app is not opened for a week. The line under it says what one more
 * worked day is worth, so the climb is visible rather than something you have
 * to notice by comparing yesterday's screenshot.
 *
 * The two recording buttons sit in a bar pinned above the navigation: on a
 * phone they are the reason the app is open, and they should not need scrolling
 * to.
 */

import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  CalendarDays,
  CheckCheck,
  ChevronRight,
  FileText,
  Loader2,
  Lock,
  MessageSquare,
  Minus,
  Pencil,
  Phone,
  Plus,
  TrendingUp,
  TriangleAlert,
} from 'lucide-react';

import {
  Amount,
  Avatar,
  Badge,
  Banner,
  Button,
  Card,
  SectionHeading,
  Spinner,
} from '@/components/ui';
import { postAccrual } from '@/data/transactions';
import { today as todayFn } from '@/lib/clock';
import { telHref } from '@/lib/contact';
import {
  clampDayToMonth,
  formatDateLong,
  formatPeriod,
  inclusiveDays,
  periodKeyOf,
  type PeriodKey,
} from '@/lib/dates';
import { formatPaise, paise } from '@/lib/money';
import { DayCalendar } from '@/features/attendance/DayCalendar';
import { EntryList } from '@/features/entries/EntryList';
import { EntrySheet, type SheetMode } from '@/features/entries/EntrySheet';
import { toDayMap } from '@/features/ledger/attendance';
import { describeWarning, entriesForPeriod, runningBalance } from '@/features/ledger/engine';
import { defaultSettlementRange } from '@/features/ledger/settlement';
import { buildDraftStatement } from '@/features/reports/statement';
import { SettleSheet } from '@/features/settlements/SettleSheet';
import { SettlementList } from '@/features/settlements/SettlementList';
import { computeShopFigures } from '@/features/ledger/figures';
import { useShopLedger } from '@/features/ledger/LedgerProvider';
import { AskSheet } from '@/features/shops/AskSheet';
import { ShopForm } from '@/features/shops/ShopForm';
import { useShops } from '@/features/shops/ShopsProvider';
import { TRANSACTION_KINDS, type Shop, type TransactionKind } from '@/types/models';

import { useAuth } from '@/features/auth/AuthProvider';

function MonthProgress({
  worked,
  off,
  total,
  remaining,
}: {
  worked: number;
  off: number;
  total: number;
  remaining: number;
}) {
  const percent = total === 0 ? 0 : Math.round((worked / total) * 100);
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-ink-2">
        <span className="font-semibold text-ink">
          Day {worked} of {total}
        </span>
        <span aria-hidden>·</span>
        <span>{remaining === 0 ? 'month complete' : `${remaining} to go`}</span>
        {off > 0 ? (
          <>
            <span aria-hidden>·</span>
            <span className="text-debit-strong">
              {off} day{off === 1 ? '' : 's'} off
            </span>
          </>
        ) : null}
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-bg-soft"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Days worked this month"
      >
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/** One of the three small actions over the balance card. */
function QuickAction({
  icon,
  label,
  onClick,
  href,
  busy = false,
}: {
  icon: typeof Bell;
  label: string;
  onClick?: () => void;
  href?: string;
  busy?: boolean;
}) {
  const className =
    'flex min-h-16 flex-1 flex-col items-center justify-center gap-1 rounded-xl border border-line-strong bg-surface px-2 text-xs font-semibold text-ink hover:bg-surface-2 disabled:text-ink-3';
  const Icon = icon;
  const inner = (
    <>
      {busy ? <Loader2 size={17} className="animate-spin" /> : <Icon size={17} />}
      {label}
    </>
  );

  if (href) {
    return (
      <a href={href} className={className}>
        {inner}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={busy} className={className}>
      {inner}
    </button>
  );
}

export function ShopPage({
  shop,
  onBack,
  onOpenReminders,
}: {
  shop: Shop;
  onBack: () => void;
  onOpenReminders: () => void;
}) {
  const { uid, displayName } = useAuth();
  const { selectShop } = useShops();
  const ledger = useShopLedger(shop.id);
  const [sheet, setSheet] = useState<SheetMode | null>(null);
  const [settling, setSettling] = useState(false);
  const [asking, setAsking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [posting, setPosting] = useState(false);
  const [building, setBuilding] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const today = todayFn();
  const [period, setPeriod] = useState<PeriodKey>(() => periodKeyOf(today));

  const figures = useMemo(
    () =>
      computeShopFigures({
        shop,
        transactions: ledger.transactions,
        configs: ledger.configs,
        days: ledger.days,
        today,
        period,
      }),
    [shop, ledger, today, period],
  );

  const dayMap = useMemo(() => toDayMap(ledger.days), [ledger.days]);

  if (!ledger.loaded) return <Spinner label={`Loading ${shop.name}`} />;

  const owed = figures.balance;
  const salaryDay = clampDayToMonth(periodKeyOf(today), shop.salaryPayDay);
  const daysToSalary = inclusiveDays(today, salaryDay) - 1;
  const settleable = defaultSettlementRange(shop, today);
  const call = shop.phone ? telHref(shop.phone) : null;

  function postAll() {
    if (!uid || posting) return;
    setPosting(true);
    try {
      // Every proposal for the oldest open period is posted together, so the
      // earned half and the received half of a daily allowance can never land
      // separately and leave the balance looking wrong in between.
      for (const proposal of figures.proposals) postAccrual(uid, shop, proposal);
    } finally {
      setPosting(false);
    }
  }

  /**
   * A statement for this shop as it stands today.
   *
   * Marked a draft throughout, and built from the same entries the history
   * below shows: these days have not been agreed with anyone yet, so the
   * figures are a position rather than a record. A sealed period's statement is
   * downloaded from the statement list, where the figures are frozen.
   */
  async function downloadDraft() {
    if (building) return;
    setBuilding(true);
    setPdfError(null);
    try {
      const { downloadStatementPdf } = await import('@/features/reports/statementPdf');
      const from = shop.openingBalanceAsOf;
      const entries = entriesForPeriod(ledger.transactions, from, today);

      const totals = {} as Record<TransactionKind, ReturnType<typeof paise>>;
      for (const kind of TRANSACTION_KINDS) totals[kind] = paise(0);
      for (const entry of entries) totals[entry.kind] = paise(totals[entry.kind] + entry.amount);

      await downloadStatementPdf(
        buildDraftStatement({
          shop,
          personName: displayName,
          from,
          to: today,
          openingBalance: shop.openingBalance,
          closingBalance: figures.postedBalance,
          totals,
          rows: runningBalance(shop.openingBalance, entries),
        }),
      );
    } catch {
      setPdfError('Could not build the PDF. Please try again.');
    } finally {
      setBuilding(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 pb-24 sm:pb-0">
      <header>
        <button
          type="button"
          onClick={() => {
            selectShop(shop.id);
            onBack();
          }}
          className="-ml-2 mb-2 inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-ink-3 hover:bg-surface-2 hover:text-ink"
        >
          <ArrowLeft size={15} />
          All shops
        </button>

        <div className="flex items-start gap-3">
          <Avatar name={shop.name} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-bold text-ink">{shop.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
              <Badge tone={shop.settlementMode === 'accrual' ? 'accent' : 'neutral'}>
                {shop.settlementMode === 'accrual' ? 'Monthly salary' : 'Daily wage'}
              </Badge>
              <span>pays on day {shop.salaryPayDay}</span>
            </p>
            {shop.description ? (
              <p className="mt-1 truncate text-sm text-ink-3">{shop.description}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {call ? (
              <a
                href={call}
                aria-label={`Call ${shop.name}`}
                className="grid size-11 place-items-center rounded-xl border border-line-strong text-ink-2 hover:bg-surface-2"
              >
                <Phone size={16} />
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label="Edit this shop"
              className="grid size-11 place-items-center rounded-xl border border-line-strong text-ink-2 hover:bg-surface-2"
            >
              <Pencil size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* What it owes you, right now */}
      <Card
        className={`p-5 ${
          owed > 0
            ? 'border-credit/25 bg-credit-soft/50'
            : owed < 0
              ? 'border-debit/25 bg-debit-soft/50'
              : ''
        }`}
      >
        <p className="text-sm font-semibold text-ink-2">
          {owed > 0
            ? `${shop.name} owes you`
            : owed < 0
              ? `You owe ${shop.name}`
              : 'You are square'}
        </p>
        <p className="mt-1">
          <Amount value={owed} tone="balance" size="xl" showPaise />
        </p>

        {/* The daily climb, stated rather than implied. */}
        {figures.position.nextDayValue > 0 ? (
          <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-credit-strong">
            <TrendingUp size={15} className="shrink-0" />
            {formatPaise(figures.position.nextDayValue, { paise: true })} more for each day you
            work
          </p>
        ) : null}

        {/*
          "counts", not "includes": payments already received are netted off,
          so the unconfirmed part can legitimately exceed the balance, and
          "includes" would then be arithmetic that does not add up.
        */}
        {figures.unposted !== 0 ? (
          <p className="mt-1.5 text-sm text-ink-3">
            counts {formatPaise(figures.unposted)} earned but not yet confirmed
          </p>
        ) : null}

        <div className="mt-4 border-t border-line pt-4">
          <MonthProgress
            worked={figures.position.elapsed.worked}
            off={figures.position.counts.off}
            total={figures.position.counts.total}
            remaining={figures.position.daysRemaining}
          />
        </div>

        {figures.position.lines.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
            {figures.position.lines.map((line) => (
              <li key={line.configId} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-ink-2">
                  {line.label}
                  {line.isDailySettled ? (
                    <span className="text-ink-3"> · {line.settledDayCount} days received</span>
                  ) : null}
                </span>
                <span className="shrink-0">
                  <Amount value={line.outstanding} tone="credit" size="sm" />
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      {/* Report, remind, message — the three things you do with a balance */}
      <div className="flex gap-2">
        <QuickAction
          icon={FileText}
          label={building ? 'Building…' : 'Report'}
          onClick={() => void downloadDraft()}
          busy={building}
        />
        <QuickAction icon={Bell} label="Reminders" onClick={onOpenReminders} />
        <QuickAction icon={MessageSquare} label="Ask for it" onClick={() => setAsking(true)} />
      </div>

      {pdfError ? <Banner tone="danger">{pdfError}</Banner> : null}

      {settleable ? (
        <Button tone="neutral" onClick={() => setSettling(true)} fullWidth>
          <Lock size={15} />
          Settle up to {formatPeriod(periodKeyOf(settleable.to))}
        </Button>
      ) : null}

      {/* Waiting to be confirmed */}
      {figures.proposals.length > 0 ? (
        <Card className="border-accent/30 bg-accent-soft/40 p-4">
          <div className="flex items-start gap-2">
            <CheckCheck size={17} className="mt-0.5 shrink-0 text-accent-ink" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">Ready to add to your ledger</p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {figures.proposals.map((proposal) => (
                  <li key={proposal.id} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-ink-2">
                      {proposal.label}
                      <span className="text-ink-3"> · {formatPeriod(proposal.period)}</span>
                      {proposal.isPartial ? (
                        <span className="text-ink-3">
                          {' '}
                          ({proposal.prorationNum}/{proposal.prorationDen} days)
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0">
                      <Amount
                        value={proposal.amount}
                        tone={proposal.settles === 'received' ? 'debit' : 'credit'}
                        size="sm"
                      />
                    </span>
                  </li>
                ))}
              </ul>
              <Button tone="primary" onClick={postAll} disabled={posting} className="mt-3">
                {posting ? 'Adding…' : 'Add these entries'}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {daysToSalary > 0 && daysToSalary <= 7 ? (
        <Banner tone="accent" title={`Salary day in ${daysToSalary} day${daysToSalary === 1 ? '' : 's'}`}>
          This shop normally pays on day {shop.salaryPayDay} of the month, which is{' '}
          {formatDateLong(salaryDay)}.
        </Banner>
      ) : null}

      {figures.warnings.length > 0 ? (
        <Banner tone="debit" title="Worth a look">
          <ul className="flex flex-col gap-1.5">
            {figures.warnings.map((warning, index) => (
              <li key={index} className="flex gap-2">
                <TriangleAlert size={14} className="mt-0.5 shrink-0" />
                <span>{describeWarning(warning)}</span>
              </li>
            ))}
          </ul>
        </Banner>
      ) : null}

      {/* Attendance */}
      <section>
        <SectionHeading
          title="Days"
          description="Tap a day to mark it off, or to tick the food money you were given."
          action={<Badge>{formatPeriod(period)}</Badge>}
        />
        <Card className="p-4">
          <DayCalendar
            shop={shop}
            period={period}
            days={dayMap}
            configs={ledger.configs}
            today={today}
          />
        </Card>
      </section>

      {/* Statements */}
      <section>
        <SectionHeading
          title="Statements"
          description="A settled period is frozen, so what you hand over stays true."
          action={
            <span className="flex items-center gap-1 text-xs text-ink-3">
              <FileText size={13} />
              PDF
            </span>
          }
        />
        <SettlementList
          shop={shop}
          settlements={ledger.settlements}
          transactions={ledger.transactions}
          personName={displayName}
        />
      </section>

      {/* History */}
      <section>
        <SectionHeading
          title="History"
          action={
            <span className="flex items-center gap-1 text-xs text-ink-3">
              <CalendarDays size={13} />
              running balance
            </span>
          }
        />
        <EntryList
          shop={shop}
          transactions={ledger.transactions}
          openingBalance={figures.month.openingBalance}
          period={period}
          onPeriodChange={setPeriod}
          today={today}
        />
      </section>

      {ledger.configs.length === 0 ? (
        <Banner tone="debit" title="No income set up">
          This shop has no salary or allowance recorded, so nothing accrues. Edit the shop to add
          one.
          <ChevronRight size={14} className="ml-1 inline" />
        </Banner>
      ) : null}

      {/*
        The two recording buttons, pinned above the bottom navigation on a phone
        and inline on a wider screen. Positioned clear of the navigation bar and
        of the home-bar inset, so neither covers the other.
      */}
      {/* 4.25rem clears the navigation bar: 4rem of buttons plus its border. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 px-4 pt-2 pb-[calc(4.25rem+env(safe-area-inset-bottom))] backdrop-blur-sm sm:static sm:z-auto sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        <div className="mx-auto grid max-w-3xl grid-cols-2 gap-3">
          <Button tone="primary" onClick={() => setSheet('got')} className="min-h-14 flex-col gap-0.5">
            <span className="flex items-center gap-1.5 text-base">
              <Plus size={17} />
              You got
            </span>
            <span className="text-xs font-normal opacity-80">they paid you</span>
          </Button>
          <Button tone="neutral" onClick={() => setSheet('gave')} className="min-h-14 flex-col gap-0.5">
            <span className="flex items-center gap-1.5 text-base">
              <Minus size={17} />
              You gave
            </span>
            <span className="text-xs font-normal text-ink-3">you spent for the shop</span>
          </Button>
        </div>
      </div>

      {sheet ? (
        <EntrySheet open mode={sheet} shop={shop} onClose={() => setSheet(null)} />
      ) : null}

      {asking ? (
        <AskSheet
          shop={shop}
          balance={owed}
          unconfirmed={figures.unposted}
          personName={displayName}
          today={today}
          onClose={() => setAsking(false)}
          onEditShop={() => {
            setAsking(false);
            setEditing(true);
          }}
        />
      ) : null}

      {editing ? <ShopForm open shop={shop} onClose={() => setEditing(false)} /> : null}

      {settling ? (
        <SettleSheet
          open
          shop={shop}
          transactions={ledger.transactions}
          settlements={ledger.settlements}
          onClose={() => setSettling(false)}
        />
      ) : null}
    </div>
  );
}
