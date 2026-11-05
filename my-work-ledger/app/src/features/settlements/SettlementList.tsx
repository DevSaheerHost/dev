/**
 * Past statements, and getting one onto paper.
 *
 * A reprint is built from the **stored snapshot**, not recomputed. A statement
 * agreed in October must still say what it said in October, even if entries
 * behind it were later voided or the engine changed. Recomputing would quietly
 * rewrite history, which is the one thing sealing exists to prevent.
 */

import { useState } from 'react';
import { Download, FileText, Loader2, TriangleAlert } from 'lucide-react';

import { Amount, Badge, Banner, Button, Card, EmptyState, Modal } from '@/components/ui';
import { formatDateShort, type CalendarDate } from '@/lib/dates';
import { entriesForPeriod, runningBalance } from '@/features/ledger/engine';
import { disturbedBy, sortStatements } from '@/features/ledger/settlement';
import { buildStatementDocument } from '@/features/reports/statement';
import { KIND_LABEL, type Settlement, type Shop, type Transaction } from '@/types/models';

export function SettlementList({
  shop,
  settlements,
  transactions,
  personName,
}: {
  shop: Shop;
  settlements: readonly Settlement[];
  transactions: readonly Transaction[];
  personName: string;
}) {
  const [open, setOpen] = useState<Settlement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ordered = sortStatements(settlements);

  function documentFor(settlement: Settlement) {
    // The rows come from the entries this statement claimed, replayed in the
    // order they happened. The *figures* come from the snapshot.
    const claimed = transactions.filter((entry) => entry.settlementId === settlement.id);
    const rows = runningBalance(
      settlement.openingBalance,
      claimed.length > 0
        ? claimed
        : entriesForPeriod(transactions, settlement.periodStart, settlement.periodEnd),
    );
    return buildStatementDocument({
      settlement,
      shop,
      personName,
      rows,
      disturbedCount: disturbedBy(settlement, transactions).length,
    });
  }

  async function download(settlement: Settlement) {
    setBusy(true);
    setError(null);
    try {
      // Loaded on demand so jsPDF and the embedded font never reach the
      // dashboard's bundle.
      const { downloadStatementPdf } = await import('@/features/reports/statementPdf');
      await downloadStatementPdf(documentFor(settlement));
    } catch {
      setError('Could not build the PDF. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (ordered.length === 0) {
    return (
      <Card>
        <EmptyState icon={<FileText size={26} />} title="No statements yet">
          Settle a period to produce a statement you can show the shop.
        </EmptyState>
      </Card>
    );
  }

  return (
    <>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Card>
        <ul>
          {ordered.map((settlement) => {
            const late = disturbedBy(settlement, transactions);
            return (
              <li key={settlement.id} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  onClick={() => setOpen(settlement)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-surface-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink">
                      Statement {settlement.statementNo}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
                      <span>
                        {formatDateShort(settlement.periodStart)} &ndash;{' '}
                        {formatDateShort(settlement.periodEnd)}
                      </span>
                      {settlement.sealState === 'stamping' ? (
                        <Badge tone="debit">unfinished</Badge>
                      ) : null}
                      {late.length > 0 ? (
                        <Badge tone="debit">{late.length} late</Badge>
                      ) : null}
                    </span>
                  </span>
                  <Amount value={settlement.closingBalance} tone="balance" size="md" />
                </button>
              </li>
            );
          })}
        </ul>
      </Card>

      {open ? (
        <Modal
          open
          onClose={() => setOpen(null)}
          title={`Statement ${open.statementNo}`}
          footer={
            <>
              <Button tone="ghost" onClick={() => setOpen(null)}>
                Close
              </Button>
              <Button
                tone="primary"
                onClick={() => void download(open)}
                disabled={busy}
                className="flex-1"
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                {busy ? 'Building…' : 'Download PDF'}
              </Button>
            </>
          }
        >
          <StatementDetail
            settlement={open}
            shop={shop}
            late={disturbedBy(open, transactions)}
          />
        </Modal>
      ) : null}
    </>
  );
}

function StatementDetail({
  settlement,
  shop,
  late,
}: {
  settlement: Settlement;
  shop: Shop;
  late: readonly Transaction[];
}) {
  const lines = (Object.entries(settlement.totals) as [keyof typeof KIND_LABEL, number][]).filter(
    ([, amount]) => amount !== 0,
  );

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-2">
        {formatDateShort(settlement.periodStart)} to {formatDateShort(settlement.periodEnd)} ·{' '}
        {settlement.transactionCount} entr{settlement.transactionCount === 1 ? 'y' : 'ies'}
      </p>

      <dl className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2 p-4 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-ink-2">Brought forward</dt>
          <dd>
            <Amount value={settlement.openingBalance} tone="plain" size="sm" showPaise />
          </dd>
        </div>
        {lines.map(([kind, amount]) => (
          <div key={kind} className="flex justify-between gap-3">
            <dt className="text-ink-2">{KIND_LABEL[kind]}</dt>
            <dd>
              <Amount value={amount as never} tone="plain" size="sm" showPaise />
            </dd>
          </div>
        ))}
        <div className="mt-1 flex justify-between gap-3 border-t border-line pt-2">
          <dt className="font-semibold text-ink">Outstanding</dt>
          <dd>
            <Amount value={settlement.closingBalance} tone="balance" size="md" showPaise />
          </dd>
        </div>
      </dl>

      <p className="text-sm text-ink-2">
        {settlement.closingBalance > 0
          ? `${shop.name} owed you this at the end of the period.`
          : settlement.closingBalance < 0
            ? `You owed ${shop.name} this at the end of the period.`
            : 'Nothing was outstanding at the end of the period.'}
      </p>

      {settlement.notes ? (
        <p className="rounded-xl border border-line px-4 py-3 text-sm text-ink-2">
          {settlement.notes}
        </p>
      ) : null}

      {late.length > 0 ? (
        <Banner tone="debit" title="Entries arrived after this was issued">
          <p className="flex gap-2">
            <TriangleAlert size={15} className="mt-0.5 shrink-0" />
            <span>
              These are dated inside this period but were recorded later, so they count on the
              next statement. The figures above have not changed.
            </span>
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {late.map((entry) => (
              <li key={entry.id} className="flex justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  {formatDateShort(entry.transactionDate)} ·{' '}
                  {entry.description || KIND_LABEL[entry.kind]}
                </span>
                <Amount value={entry.amount} tone="plain" size="sm" />
              </li>
            ))}
          </ul>
        </Banner>
      ) : null}

      {settlement.sealState === 'stamping' ? (
        <Banner tone="debit" title="This statement was not finished">
          Sealing was interrupted part-way. Open Settle up again to finish it — no figures will
          change.
        </Banner>
      ) : null}
    </div>
  );
}

export type { CalendarDate };
