/**
 * The dashboard: what every shop owes you right now, added up.
 *
 * Every figure here comes from `computeShopFigures`, the same function the shop
 * page uses. That is deliberate: a dashboard that totals things its own way
 * will eventually disagree with the detail screen, and then neither can be
 * trusted. One function, one answer.
 */

import { useMemo, useState } from 'react';
import {
  Bell,
  ChevronRight,
  FileText,
  Info,
  Loader2,
  Store,
  TriangleAlert,
  Wallet,
} from 'lucide-react';

import {
  Amount,
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  SectionHeading,
  Spinner,
} from '@/components/ui';
import { today as todayFn } from '@/lib/clock';
import { formatDateLong } from '@/lib/dates';
import { formatPaise, paise } from '@/lib/money';
import { buildDraftStatement } from '@/features/reports/statement';
import { runningBalance, entriesForPeriod } from '@/features/ledger/engine';
import { useAuth } from '@/features/auth/AuthProvider';
import { TRANSACTION_KINDS, type TransactionKind } from '@/types/models';
import { describeWarning } from '@/features/ledger/engine';
import { combineFigures, computeShopFigures } from '@/features/ledger/figures';
import { useAllLedgers } from '@/features/ledger/LedgerProvider';
import { useReminderRuntime } from '@/features/reminders/ReminderRuntime';
import { AskSheet } from '@/features/shops/AskSheet';
import { ShopBalanceRow } from '@/features/shops/ShopBalanceRow';
import { ShopForm } from '@/features/shops/ShopForm';
import { useShops } from '@/features/shops/ShopsProvider';

export function DashboardPage({ onOpenShop }: { onOpenShop: (shopId: string) => void }) {
  const { activeShops, loading, error } = useShops();
  const { ledgers, error: ledgerError } = useAllLedgers();
  const { displayName } = useAuth();
  const [adding, setAdding] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const today = todayFn();

  const figures = useMemo(
    () =>
      activeShops.map((shop) => {
        const ledger = ledgers.get(shop.id);
        return computeShopFigures({
          shop,
          transactions: ledger?.transactions ?? [],
          configs: ledger?.configs ?? [],
          days: ledger?.days ?? [],
          today,
        });
      }),
    [activeShops, ledgers, today],
  );

  const combined = useMemo(() => combineFigures(figures), [figures]);
  const askingFigures = asking ? figures.find((entry) => entry.shop.id === asking) : undefined;

  // The same list the Reminders screen shows, derived once above both.
  const needsYou = useReminderRuntime().derived;
  const warnings = figures.flatMap((shop) =>
    shop.warnings.map((warning) => ({ shop: shop.shop.name, warning })),
  );
  const pending = figures.reduce((count, shop) => count + shop.proposals.length, 0);
  const everyLedgerLoaded = activeShops.every((shop) => ledgers.get(shop.id)?.loaded);

  /**
   * One document covering every shop, as it stands today.
   *
   * Marked a draft throughout: these days have not been agreed with anyone, so
   * the figures are a position rather than a record. Sealed statements are
   * downloaded from the shop they belong to.
   */
  async function downloadCombined() {
    setBuilding(true);
    setPdfError(null);
    try {
      const { downloadCombinedPdf } = await import('@/features/reports/statementPdf');
      const statements = figures.map((shopFigures) => {
        const ledger = ledgers.get(shopFigures.shop.id);
        const transactions = ledger?.transactions ?? [];
        const from = shopFigures.shop.openingBalanceAsOf;
        const entries = entriesForPeriod(transactions, from, today);

        const totals = {} as Record<TransactionKind, ReturnType<typeof paise>>;
        for (const kind of TRANSACTION_KINDS) totals[kind] = paise(0);
        for (const entry of entries) totals[entry.kind] = paise(totals[entry.kind] + entry.amount);

        return buildDraftStatement({
          shop: shopFigures.shop,
          personName: displayName,
          from,
          to: today,
          openingBalance: shopFigures.shop.openingBalance,
          closingBalance: shopFigures.postedBalance,
          totals,
          rows: runningBalance(shopFigures.shop.openingBalance, entries),
        });
      });

      await downloadCombinedPdf({
        statements,
        personName: displayName,
        dateLabel: formatDateLong(today),
        unconfirmed: combined.unposted,
      });
    } catch {
      setPdfError('Could not build the PDF. Please try again.');
    } finally {
      setBuilding(false);
    }
  }

  const form = adding ? (
    <ShopForm open shop={null} onClose={() => setAdding(false)} onSaved={onOpenShop} />
  ) : null;

  if (loading) return <Spinner label="Loading your ledger" />;

  if (activeShops.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        {error ? <Banner tone="debit">{error}</Banner> : null}
        <Card>
          <EmptyState
            icon={<Store size={28} />}
            title="Add a shop to begin"
            action={
              <Button tone="primary" onClick={() => setAdding(true)}>
                Add your first shop
              </Button>
            }
          >
            Tell it your monthly salary and it starts counting what you are owed from day one.
          </EmptyState>
        </Card>
        {form}
      </div>
    );
  }

  if (!everyLedgerLoaded) return <Spinner label="Loading your ledger" />;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-bold text-ink">Dashboard</h1>
        <p className="mt-0.5 text-sm text-ink-2">
          {activeShops.length === 1 ? '1 active shop' : `${activeShops.length} active shops`}
        </p>
      </header>

      {error ? <Banner tone="debit">{error}</Banner> : null}
      {ledgerError ? <Banner tone="debit">{ledgerError}</Banner> : null}

      {/*
        The two sides first, then the net. Which way round a balance goes is the
        thing people get wrong, so each side is tinted, labelled and kept in its
        own half rather than folded into one signed figure.
      */}
      <Card className="overflow-hidden">
        <dl className="grid grid-cols-2 divide-x divide-line">
          <div className="bg-credit-soft/40 px-4 py-4">
            <dt className="text-xs font-semibold tracking-wide text-credit-strong uppercase">
              You will get
            </dt>
            <dd className="mt-1.5">
              <Amount value={combined.owedToYou} tone="credit" size="lg" />
            </dd>
          </div>
          <div className="bg-debit-soft/40 px-4 py-4">
            <dt className="text-xs font-semibold tracking-wide text-debit-strong uppercase">
              You will give
            </dt>
            <dd className="mt-1.5">
              <Amount value={combined.owedByYou} tone="debit" size="lg" />
            </dd>
          </div>
        </dl>

        <div className="border-t border-line px-4 py-4">
          <div className="flex items-center gap-2">
            <Wallet size={15} className="text-ink-3" />
            <p className="text-sm font-semibold text-ink-2">
              {combined.net > 0
                ? 'Owed to you, across every active shop'
                : combined.net < 0
                  ? 'You owe, across every active shop'
                  : 'Square across every active shop'}
            </p>
          </div>
          <p className="mt-1.5">
            <Amount value={combined.net} tone="balance" size="xl" showPaise />
          </p>
          {combined.unposted !== 0 ? (
            <p className="mt-1 text-sm text-ink-3">
              counting {formatPaise(combined.unposted)} earned but not yet confirmed
            </p>
          ) : null}

          <button
            type="button"
            onClick={() => void downloadCombined()}
            disabled={building}
            className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-line-strong px-3 text-sm font-semibold text-ink hover:bg-surface-2 disabled:text-ink-3"
          >
            {building ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <FileText size={15} />
            )}
            {building ? 'Building…' : 'View a report for every shop'}
          </button>
        </div>
      </Card>

      {needsYou.length > 0 ? (
        <section>
          <SectionHeading
            title="Needs you"
            action={
              <span className="flex items-center gap-1 text-xs text-ink-3">
                <Bell size={13} />
                {needsYou.length}
              </span>
            }
          />
          <Card>
            <ul>
              {needsYou.map((reminder) => (
                <li key={reminder.id} className="border-b border-line last:border-b-0">
                  <button
                    type="button"
                    onClick={() => onOpenShop(reminder.shopId)}
                    className="flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left hover:bg-surface-2"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink">
                        {reminder.title}
                      </span>
                      <span className="mt-0.5 block text-sm text-ink-2">{reminder.body}</span>
                    </span>
                    <ChevronRight size={16} className="mt-0.5 shrink-0 text-ink-3" />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : pending > 0 ? (
        <Banner tone="accent" title={`${pending} entr${pending === 1 ? 'y' : 'ies'} ready to confirm`}>
          A finished month is waiting to be added to the ledger. Open the shop to check the figures
          and confirm.
        </Banner>
      ) : null}

      <section>
        <SectionHeading title="By shop" action={<Badge>tap to open</Badge>} />
        <Card>
          <ul>
            {figures.map((shop) => (
              <ShopBalanceRow
                key={shop.shop.id}
                figures={shop}
                today={today}
                onOpen={() => onOpenShop(shop.shop.id)}
                onAsk={() => setAsking(shop.shop.id)}
              />
            ))}
          </ul>
        </Card>
      </section>

      {pdfError ? <Banner tone="danger">{pdfError}</Banner> : null}

      {warnings.length > 0 ? (
        <Banner tone="debit" title="Worth a look">
          <ul className="flex flex-col gap-1.5">
            {warnings.map((entry, index) => (
              <li key={index} className="flex gap-2">
                <TriangleAlert size={14} className="mt-0.5 shrink-0" />
                <span>
                  <span className="font-semibold">{entry.shop}:</span>{' '}
                  {describeWarning(entry.warning)}
                </span>
              </li>
            ))}
          </ul>
        </Banner>
      ) : null}

      <Banner tone="neutral">
        <p className="flex gap-2">
          <Info size={15} className="mt-0.5 shrink-0" />
          <span>
            Salary builds up day by day, so this figure climbs on its own. A month is added to the
            ledger properly once you confirm it. Settlements and printed statements come next.
          </span>
        </p>
      </Banner>

      {askingFigures ? (
        <AskSheet
          shop={askingFigures.shop}
          balance={askingFigures.balance}
          unconfirmed={askingFigures.unposted}
          personName={displayName}
          today={today}
          onClose={() => setAsking(null)}
        />
      ) : null}

      {form}
    </div>
  );
}
