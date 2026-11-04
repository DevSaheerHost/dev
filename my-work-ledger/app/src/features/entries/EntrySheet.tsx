/**
 * Recording what happened, in two taps.
 *
 * There are nine kinds of ledger entry, but nobody standing in a shop thinks in
 * those terms. They think "they gave me money" or "I paid for something". So
 * the sheet opens on one of those two, and the accounting kind is a chip inside
 * it with a sensible default.
 *
 * The two questions an expense must answer — does it come back to you, and
 * whose money was it — are asked plainly, because getting either wrong is how a
 * balance quietly goes wrong. Both default to the common case: yes, and yours.
 */

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Banner, Button, ChipGroup, MoneyInput, Modal, TextInput, Toggle } from '@/components/ui';
import { EntryValidationError, addEntry } from '@/data/transactions';
import { today as todayFn } from '@/lib/clock';
import { isCalendarDate, type CalendarDate } from '@/lib/dates';
import { parseRupeesToPaise, type Paise } from '@/lib/money';
import type { EntryField, EntryInput } from '@/features/ledger/posting';
import type { FundedFrom, Shop, TransactionKind } from '@/types/models';

import { useAuth } from '../auth/AuthProvider';

export type SheetMode = 'got' | 'gave';

/** What "they gave me money" can mean. All three reduce what is outstanding. */
const RECEIVED_KINDS: readonly { value: TransactionKind; label: string; hint: string }[] = [
  {
    value: 'salary_payment_received',
    label: 'Salary',
    hint: 'Pay for work done. Reduces what the shop owes you.',
  },
  {
    value: 'advance_received',
    label: 'Advance',
    hint: 'Money taken before it is earned. It is not income — it reduces what the shop still owes.',
  },
  {
    value: 'reimbursement_received',
    label: 'Reimbursement',
    hint: 'Paying you back for something you bought for the shop.',
  },
];

const EXPENSE_CATEGORIES = [
  'Stock',
  'Transport',
  'Food',
  'Repairs',
  'Bills',
  'Other',
] as const;

const FUNDING: readonly { value: FundedFrom; label: string }[] = [
  { value: 'own', label: 'My money' },
  { value: 'shopFloat', label: "Shop's cash" },
];

export function EntrySheet({
  open,
  mode,
  shop,
  onClose,
}: {
  open: boolean;
  mode: SheetMode;
  shop: Shop;
  onClose: () => void;
}) {
  const { uid } = useAuth();
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState<string>(() => todayFn());
  const [note, setNote] = useState('');
  const [kind, setKind] = useState<TransactionKind>('salary_payment_received');
  const [category, setCategory] = useState<string>('Stock');
  const [comesBack, setComesBack] = useState(true);
  const [fundedFrom, setFundedFrom] = useState<FundedFrom>('own');
  const [errors, setErrors] = useState<Partial<Record<EntryField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isGave = mode === 'gave';

  function build(): EntryInput | null {
    const parsed = parseRupeesToPaise(amount);
    if (!parsed.ok) {
      setErrors({ amount: parsed.error });
      return null;
    }
    if (parsed.value <= 0) {
      setErrors({ amount: 'Enter an amount greater than zero' });
      return null;
    }

    const transactionDate = (isCalendarDate(date) ? date : '') as CalendarDate;

    return isGave
      ? {
          kind: 'expense_paid',
          amount: parsed.value as Paise,
          transactionDate,
          category,
          description: note,
          reimbursable: comesBack,
          fundedFrom,
        }
      : {
          kind,
          amount: parsed.value as Paise,
          transactionDate,
          category: '',
          description: note,
        };
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !uid) return;

    const input = build();
    if (!input) return;

    setBusy(true);
    setFormError(null);
    try {
      // Not awaited: the entry reaches the on-device cache immediately and the
      // listeners fire at once, so it is saved even with no signal. See
      // `data/writes.ts`.
      addEntry(uid, shop, input, todayFn());
      onClose();
    } catch (error) {
      if (error instanceof EntryValidationError) {
        const next: Partial<Record<EntryField, string>> = {};
        for (const problem of error.errors) next[problem.field] = problem.message;
        setErrors(next);
      } else {
        setFormError(
          error instanceof Error && error.message === 'cloud-not-configured'
            ? 'This build has no Firebase configuration, so nothing can be saved.'
            : 'Could not save that. Please check the details and try again.',
        );
      }
    } finally {
      setBusy(false);
    }
  }

  const selectedKind = RECEIVED_KINDS.find((entry) => entry.value === kind);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isGave ? 'You gave' : 'You got'}
      footer={
        <>
          <Button tone="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button tone="primary" type="submit" form="entry-form" disabled={busy} className="flex-1">
            {busy ? <Loader2 size={16} className="animate-spin" /> : null}
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <form id="entry-form" onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm text-ink-2">
          {isGave
            ? `Money you spent for ${shop.name}.`
            : `Money ${shop.name} handed to you.`}
        </p>

        <MoneyInput
          label="Amount"
          value={amount}
          onChange={(value) => {
            setAmount(value);
            setErrors((previous) => ({ ...previous, amount: undefined }));
          }}
          error={errors.amount}
        />

        {isGave ? (
          <>
            <ChipGroup
              label="What for"
              value={category}
              onChange={setCategory}
              options={EXPENSE_CATEGORIES.map((value) => ({ value, label: value }))}
            />

            <Toggle
              label="Comes back to me"
              description={
                comesBack
                  ? 'The shop owes you this back, so it is added to your balance.'
                  : 'Recorded as your own cost. It does not change what the shop owes.'
              }
              checked={comesBack}
              onChange={setComesBack}
            />

            <ChipGroup
              label="Whose money"
              value={fundedFrom}
              onChange={setFundedFrom}
              options={FUNDING}
              hint={
                fundedFrom === 'own'
                  ? undefined
                  : "Paid from the shop's own cash, so nothing of yours left your pocket and nothing is owed back."
              }
            />
          </>
        ) : (
          <ChipGroup
            label="What was it"
            value={kind}
            onChange={setKind}
            options={RECEIVED_KINDS.map((entry) => ({ value: entry.value, label: entry.label }))}
            hint={selectedKind?.hint}
          />
        )}

        <TextInput
          label="Date"
          type="date"
          value={date}
          onChange={(value) => {
            setDate(value);
            setErrors((previous) => ({ ...previous, transactionDate: undefined }));
          }}
          error={errors.transactionDate}
        />

        <TextInput
          label="Note"
          value={note}
          onChange={setNote}
          maxLength={500}
          error={errors.description}
          placeholder={isGave ? 'Two boxes of packing tape' : 'Handed over in the evening'}
          hint="Worth writing. In three months this is all you will have to go on."
        />

        {formError ? <Banner tone="danger">{formError}</Banner> : null}
      </form>
    </Modal>
  );
}
