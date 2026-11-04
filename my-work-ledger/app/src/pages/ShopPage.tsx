/**
 * One shop: what it owes you, how much of the month you have worked, and the
 * two buttons that record everything else.
 *
 * The headline figure climbs on its own, because salary is earned day by day
 * rather than in a lump at month end. That figure is computed, never stored —
 * `computeShopFigures` derives it from the entries, the income configs and the
 * attendance records, so there is no daily job to miss and nothing to reconcile
 * if the app is not opened for a week.
 */

import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  CalendarDays,
  CheckCheck,
  ChevronRight,
  Minus,
  Plus,
  TriangleAlert,
} from 'lucide-react';

import {
  Amount,
  Badge,
  Banner,
  Button,
  Card,
  SectionHeading,
  Spinner,
} from '@/components/ui';
import { postAccrual } from '@/data/transactions';
import { today as todayFn } from '@/lib/clock';
import {
  clampDayToMonth,
  formatPeriod,
  inclusiveDays,
  periodKeyOf,
  type PeriodKey,
} from '@/lib/dates';
import { formatPaise } from '@/lib/money';
import { DayCalendar } from '@/features/attendance/DayCalendar';
import { EntryList } from '@/features/entries/EntryList';
import { EntrySheet, type SheetMode } from '@/features/entries/EntrySheet';
import { toDayMap } from '@/features/ledger/attendance';
import { describeWarning } from '@/features/ledger/engine';
import { computeShopFigures } from '@/features/ledger/figures';
import { useShopLedger } from '@/features/ledger/LedgerProvider';
import { useShops } from '@/features/shops/ShopsProvider';
import type { Shop } from '@/types/models';

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

export function ShopPage({ shop, onBack }: { shop: Shop; onBack: () => void }) {
  const { uid } = useAuth();
  const { selectShop } = useShops();
  const ledger = useShopLedger(shop.id);
  const [sheet, setSheet] = useState<SheetMode | null>(null);
  const [posting, setPosting] = useState(false);

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

  return (
    <div className="flex flex-col gap-6">
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
        <h1 className="text-xl font-bold text-ink">{shop.name}</h1>
        {shop.description ? (
          <p className="mt-0.5 text-sm text-ink-3">{shop.description}</p>
        ) : null}
      </header>

      {/* What it owes you, right now */}
      <Card className="p-5">
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

        {figures.unposted !== 0 ? (
          <p className="mt-1.5 text-sm text-ink-3">
            includes {formatPaise(figures.unposted)} earned but not yet confirmed
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

      {/* The two buttons everything else hangs off */}
      <div className="grid grid-cols-2 gap-3">
        <Button tone="primary" onClick={() => setSheet('got')} className="min-h-16 flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-base">
            <Plus size={17} />
            You got
          </span>
          <span className="text-xs font-normal opacity-80">they paid you</span>
        </Button>
        <Button tone="neutral" onClick={() => setSheet('gave')} className="min-h-16 flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-base">
            <Minus size={17} />
            You gave
          </span>
          <span className="text-xs font-normal text-ink-3">you spent for the shop</span>
        </Button>
      </div>

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

      {/* Salary timing, in app. Real notifications arrive in a later phase. */}
      {daysToSalary > 0 && daysToSalary <= 7 ? (
        <Banner tone="accent" title={`Salary day in ${daysToSalary} day${daysToSalary === 1 ? '' : 's'}`}>
          This shop normally pays on day {shop.salaryPayDay} of the month.
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

      {sheet ? (
        <EntrySheet open mode={sheet} shop={shop} onClose={() => setSheet(null)} />
      ) : null}
    </div>
  );
}
