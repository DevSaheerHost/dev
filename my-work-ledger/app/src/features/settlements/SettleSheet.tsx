/**
 * Settling up: agreeing what a period came to, and freezing it.
 *
 * Two steps, deliberately separate:
 *
 *   1. Seal the statement. This records what was owed for a span of days. It
 *      is not a payment and does not pretend to be.
 *   2. Ask whether the owner handed anything over. If they did, that is a
 *      normal payment entry. If they said "next week", Skip — and the ledger
 *      still shows the money as outstanding, which is the truth.
 *
 * Conflating those two is how a ledger double-counts every settlement, so the
 * wording keeps them apart even though they usually happen in the same minute.
 */

import { useMemo, useState } from 'react';
import { CheckCheck, Loader2, Lock, WifiOff } from 'lucide-react';

import { Amount, Banner, Button, MoneyInput, Modal, TextInput } from '@/components/ui';
import { addEntry } from '@/data/transactions';
import {
  OfflineSealError,
  ConcurrentSealError,
  sealPeriod,
  type SealProgress,
} from '@/data/settlements';
import { today as todayFn } from '@/lib/clock';
import { formatDateLong, isCalendarDate, type CalendarDate } from '@/lib/dates';
import { formatPaise, parseRupeesToPaise, paise, type Paise } from '@/lib/money';
import {
  buildSnapshot,
  defaultSettlementRange,
  nextStatementNo,
} from '@/features/ledger/settlement';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import type { Settlement, Shop, Transaction } from '@/types/models';

import { useAuth } from '../auth/AuthProvider';

type Stage = 'range' | 'sealing' | 'payment' | 'done';

export function SettleSheet({
  open,
  shop,
  transactions,
  settlements,
  onClose,
}: {
  open: boolean;
  shop: Shop;
  transactions: readonly Transaction[];
  settlements: readonly Settlement[];
  onClose: () => void;
}) {
  const { uid } = useAuth();
  const online = useOnlineStatus();
  const today = todayFn();

  const suggested = useMemo(() => defaultSettlementRange(shop, today), [shop, today]);

  const [from, setFrom] = useState<string>(() => suggested?.from ?? today);
  const [to, setTo] = useState<string>(() => suggested?.to ?? today);
  const [notes, setNotes] = useState('');
  const [stage, setStage] = useState<Stage>('range');
  const [progress, setProgress] = useState<SealProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [paid, setPaid] = useState('');
  const [paidError, setPaidError] = useState<string | undefined>(undefined);
  const [sealedClosing, setSealedClosing] = useState<Paise>(paise(0));

  const preview = useMemo(() => {
    if (!isCalendarDate(from) || !isCalendarDate(to) || from > to) return null;
    try {
      return buildSnapshot({
        shop,
        transactions,
        from,
        to,
        statementNo: nextStatementNo(settlements),
        settlementDate: today,
        notes,
      });
    } catch {
      return null;
    }
  }, [shop, transactions, from, to, settlements, today, notes]);

  async function seal() {
    if (!uid || !preview) return;
    setStage('sealing');
    setError(null);
    try {
      await sealPeriod({ uid, shop, snapshot: preview, onProgress: setProgress });
      setSealedClosing(preview.body.closingBalance);
      setStage('payment');
    } catch (failure) {
      setStage('range');
      if (failure instanceof OfflineSealError) {
        setError(
          'Settling needs a connection — it has to agree a statement number with the server so two devices cannot issue the same one. Your entries are saved; try again when you are back online.',
        );
      } else if (failure instanceof ConcurrentSealError) {
        setError('These days have already been settled, probably on another device.');
      } else {
        setError('Could not settle that period. Nothing was changed; please try again.');
      }
    }
  }

  function recordPayment() {
    if (!uid) return;
    const parsed = parseRupeesToPaise(paid);
    if (!parsed.ok) {
      setPaidError(parsed.error);
      return;
    }
    if (parsed.value <= 0) {
      setPaidError('Enter an amount greater than zero');
      return;
    }
    addEntry(
      uid,
      shop,
      {
        kind: 'salary_payment_received',
        amount: parsed.value,
        transactionDate: today,
        category: 'settlement',
        description: `Paid on settling up to ${formatDateLong(to as CalendarDate)}`,
      },
      today,
    );
    setStage('done');
  }

  const title =
    stage === 'payment' ? 'Did they pay you?' : stage === 'done' ? 'Settled' : 'Settle up';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        stage === 'range' ? (
          <>
            <Button tone="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              tone="primary"
              onClick={() => void seal()}
              disabled={!preview || !online}
              className="flex-1"
            >
              <Lock size={15} />
              Settle this period
            </Button>
          </>
        ) : stage === 'payment' ? (
          <>
            <Button tone="ghost" onClick={() => setStage('done')}>
              Not yet
            </Button>
            <Button tone="primary" onClick={recordPayment} className="flex-1">
              Record the payment
            </Button>
          </>
        ) : stage === 'done' ? (
          <Button tone="primary" onClick={onClose} fullWidth>
            Done
          </Button>
        ) : undefined
      }
    >
      {stage === 'sealing' ? (
        <div className="flex flex-col items-center gap-3 py-10 text-sm text-ink-2">
          <Loader2 size={22} className="animate-spin text-accent" />
          <p>Settling the period…</p>
          {progress && progress.total > 20 ? (
            <p className="text-ink-3">
              {progress.stamped} of {progress.total} entries
            </p>
          ) : null}
        </div>
      ) : null}

      {stage === 'range' ? (
        <div className="flex flex-col gap-4">
          {!online ? (
            <Banner tone="debit" title="You are offline">
              <p className="flex gap-2">
                <WifiOff size={15} className="mt-0.5 shrink-0" />
                <span>
                  Everything else in this app works without a connection, but settling does not:
                  the statement number has to be agreed with the server so two devices cannot
                  issue the same one.
                </span>
              </p>
            </Banner>
          ) : null}

          {suggested === null ? (
            <Banner tone="neutral">
              There is nothing to settle yet. A period can be settled once the month it falls in
              has ended.
            </Banner>
          ) : null}

          <p className="text-sm text-ink-2">
            This records what {shop.name} owed you for these days and freezes it. It is a
            statement, not a payment — if they hand money over, that is recorded separately in a
            moment.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <TextInput label="From" type="date" value={from} onChange={setFrom} />
            <TextInput label="To" type="date" value={to} onChange={setTo} />
          </div>

          {preview ? (
            <div className="rounded-xl border border-line bg-surface-2 p-4">
              <dl className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-2">Brought forward</dt>
                  <dd>
                    <Amount value={preview.body.openingBalance} tone="plain" size="sm" showPaise />
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-2">Added this period</dt>
                  <dd>
                    <Amount value={preview.period.totalEarned} tone="credit" size="sm" showPaise />
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-2">Received and deducted</dt>
                  <dd>
                    <Amount value={preview.period.totalReduced} tone="debit" size="sm" showPaise />
                  </dd>
                </div>
                <div className="mt-1 flex justify-between gap-3 border-t border-line pt-2">
                  <dt className="font-semibold text-ink">Outstanding</dt>
                  <dd>
                    <Amount value={preview.body.closingBalance} tone="balance" size="md" showPaise />
                  </dd>
                </div>
              </dl>
              <p className="mt-2 text-xs text-ink-3">
                {preview.body.transactionCount} entr
                {preview.body.transactionCount === 1 ? 'y' : 'ies'} will be frozen. After this they
                cannot be edited or voided — a mistake is corrected with an adjustment in the next
                period, so the statement you hand over stays true.
              </p>
            </div>
          ) : (
            <Banner tone="debit">Pick a start date on or before the end date.</Banner>
          )}

          <TextInput
            label="Note on the statement (optional)"
            value={notes}
            onChange={setNotes}
            maxLength={1000}
            placeholder="Agreed with Rafeeq on the 2nd"
          />

          {error ? <Banner tone="danger">{error}</Banner> : null}
        </div>
      ) : null}

      {stage === 'payment' ? (
        <div className="flex flex-col gap-4">
          <Banner tone="accent" title="Statement settled">
            <p className="flex gap-2">
              <CheckCheck size={15} className="mt-0.5 shrink-0" />
              <span>
                {shop.name} {sealedClosing >= 0 ? 'owes you' : 'is owed'}{' '}
                {formatPaise(sealedClosing < 0 ? paise(-sealedClosing) : sealedClosing)} for this
                period.
              </span>
            </p>
          </Banner>

          <p className="text-sm text-ink-2">
            Did they hand you anything just now? This is recorded as a separate payment, so the
            statement above stays a record of what was owed.
          </p>

          <MoneyInput
            label="Amount they paid"
            value={paid}
            onChange={(value) => {
              setPaid(value);
              setPaidError(undefined);
            }}
            error={paidError}
            hint="Leave it and tap Not yet if they have not paid."
          />
        </div>
      ) : null}

      {stage === 'done' ? (
        <div className="flex flex-col gap-3 py-4 text-sm text-ink-2">
          <p className="font-semibold text-ink">The period is settled.</p>
          <p>
            You can download the statement from the list below and show it to the shop. Anything
            you record for these dates from now on appears on the next statement instead, and the
            one you handed over does not change.
          </p>
        </div>
      ) : null}
    </Modal>
  );
}
