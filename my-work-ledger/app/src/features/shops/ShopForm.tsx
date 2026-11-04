/**
 * Add or edit a shop.
 *
 * The opening balance is the one genuinely confusing field, so it is asked as a
 * direction plus a magnitude rather than as a signed number: "the shop owes me"
 * or "I owe the shop". A minus sign in a money field is a reliable source of
 * sign errors, and this is the figure every later balance is built on.
 */

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Banner, Button, MoneyInput, Modal, Select, TextInput } from '@/components/ui';
import { today } from '@/lib/clock';
import { formatPaiseForInput, parseRupeesToPaise, paise, type Paise } from '@/lib/money';
import { isCalendarDate, type CalendarDate } from '@/lib/dates';
import { createShop, updateShop, validateShopInput, type ShopInput } from '@/data/shops';
import type { SettlementMode, Shop } from '@/types/models';

import { useAuth } from '../auth/AuthProvider';

type Direction = 'owedToMe' | 'owedByMe';

interface Draft {
  name: string;
  description: string;
  joiningDate: string;
  salaryPayDay: string;
  settlementMode: SettlementMode;
  openingAmount: string;
  openingDirection: Direction;
  openingBalanceAsOf: string;
}

function draftFromShop(shop: Shop | null): Draft {
  if (!shop) {
    const now = today();
    return {
      name: '',
      description: '',
      joiningDate: now,
      salaryPayDay: '1',
      settlementMode: 'accrual',
      openingAmount: '',
      openingDirection: 'owedToMe',
      openingBalanceAsOf: now,
    };
  }
  return {
    name: shop.name,
    description: shop.description,
    joiningDate: shop.joiningDate,
    salaryPayDay: String(shop.salaryPayDay),
    settlementMode: shop.settlementMode,
    openingAmount: shop.openingBalance === 0 ? '' : formatPaiseForInput(paise(Math.abs(shop.openingBalance))),
    openingDirection: shop.openingBalance < 0 ? 'owedByMe' : 'owedToMe',
    openingBalanceAsOf: shop.openingBalanceAsOf,
  };
}

const PAY_DAY_OPTIONS = Array.from({ length: 31 }, (_, index) => ({
  value: String(index + 1),
  label: index + 1 === 31 ? '31st (last day in short months)' : `${index + 1}`,
}));

const MODE_OPTIONS: readonly { value: SettlementMode; label: string }[] = [
  { value: 'accrual', label: 'Monthly salary — unpaid months build up as owed' },
  { value: 'cashOnly', label: 'Daily wage — only record what is actually paid' },
];

const DIRECTION_OPTIONS: readonly { value: Direction; label: string }[] = [
  { value: 'owedToMe', label: 'The shop owes me' },
  { value: 'owedByMe', label: 'I owe the shop' },
];

export function ShopForm({
  open,
  shop,
  onClose,
  onSaved,
}: {
  open: boolean;
  shop: Shop | null;
  onClose: () => void;
  onSaved?: (shopId: string) => void;
}) {
  const { uid } = useAuth();
  // Remounting on open (see the `key` where this is rendered) is what resets the
  // draft, so there is no effect syncing props into state.
  const [draft, setDraft] = useState<Draft>(() => draftFromShop(shop));
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof ShopInput, string>>>({});
  const [amountError, setAmountError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((previous) => ({ ...previous, [key]: value }));
  }

  function buildInput(): ShopInput | null {
    let amount: Paise = paise(0);
    if (draft.openingAmount.trim() !== '') {
      const parsed = parseRupeesToPaise(draft.openingAmount);
      if (!parsed.ok) {
        setAmountError(parsed.error);
        return null;
      }
      if (parsed.value < 0) {
        setAmountError('Enter the amount without a minus; choose the direction below');
        return null;
      }
      amount = parsed.value;
    }
    setAmountError(undefined);

    const signed = draft.openingDirection === 'owedByMe' ? paise(-amount) : amount;

    return {
      name: draft.name,
      description: draft.description,
      joiningDate: (isCalendarDate(draft.joiningDate) ? draft.joiningDate : '') as CalendarDate,
      salaryPayDay: Number(draft.salaryPayDay),
      settlementMode: draft.settlementMode,
      openingBalance: signed,
      openingBalanceAsOf: (isCalendarDate(draft.openingBalanceAsOf)
        ? draft.openingBalanceAsOf
        : '') as CalendarDate,
    };
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !uid) return;

    const input = buildInput();
    if (!input) return;

    const problems = validateShopInput(input);
    if (problems.length > 0) {
      const next: Partial<Record<keyof ShopInput, string>> = {};
      for (const problem of problems) next[problem.field] = problem.message;
      setFieldErrors(next);
      return;
    }
    setFieldErrors({});

    setBusy(true);
    setFormError(null);
    try {
      if (shop) {
        await updateShop(uid, shop.id, input);
        onSaved?.(shop.id);
      } else {
        const id = await createShop(uid, input);
        onSaved?.(id);
      }
      onClose();
    } catch (error) {
      setFormError(
        error instanceof Error && error.message === 'cloud-not-configured'
          ? 'This build has no Firebase configuration, so nothing can be saved.'
          : 'Could not save the shop. Check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={shop ? 'Edit shop' : 'Add a shop'}
      footer={
        <>
          <Button tone="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button tone="primary" type="submit" form="shop-form" disabled={busy} className="flex-1">
            {busy ? <Loader2 size={16} className="animate-spin" /> : null}
            {busy ? 'Saving…' : shop ? 'Save changes' : 'Add shop'}
          </Button>
        </>
      }
    >
      <form id="shop-form" onSubmit={submit} className="flex flex-col gap-4">
        <TextInput
          label="Shop name"
          value={draft.name}
          onChange={(value) => set('name', value)}
          maxLength={60}
          error={fieldErrors.name}
          placeholder="Blue Mart"
        />

        <TextInput
          label="Note (optional)"
          value={draft.description}
          onChange={(value) => set('description', value)}
          maxLength={240}
          error={fieldErrors.description}
          placeholder="Evening shift, owner Rafeeq"
        />

        <TextInput
          label="Date you started here"
          type="date"
          value={draft.joiningDate}
          onChange={(value) => set('joiningDate', value)}
          error={fieldErrors.joiningDate}
        />

        <Select
          label="How this shop pays"
          value={draft.settlementMode}
          onChange={(value) => set('settlementMode', value)}
          options={MODE_OPTIONS}
          hint={
            draft.settlementMode === 'accrual'
              ? 'Salary is earned each month whether or not it is paid.'
              : 'Nothing accrues; an unpaid day is not counted as owed.'
          }
        />

        <Select
          label="Salary day of the month"
          value={draft.salaryPayDay}
          onChange={(value) => set('salaryPayDay', value)}
          options={PAY_DAY_OPTIONS}
          error={fieldErrors.salaryPayDay}
          hint="Used to offer the month's salary entry for confirmation. Nothing is ever posted on its own."
        />

        <div className="rounded-xl border border-line bg-surface-2 p-4">
          <p className="mb-3 text-sm font-semibold text-ink">Starting balance</p>
          <p className="mb-3 text-sm text-ink-2">
            What was already outstanding before you started using this app? Leave it blank if the
            two of you were square.
          </p>
          <div className="flex flex-col gap-4">
            <MoneyInput
              label="Amount"
              value={draft.openingAmount}
              onChange={(value) => set('openingAmount', value)}
              error={amountError ?? fieldErrors.openingBalance}
            />
            <Select
              label="Direction"
              value={draft.openingDirection}
              onChange={(value) => set('openingDirection', value)}
              options={DIRECTION_OPTIONS}
            />
            <TextInput
              label="Balance applies from"
              type="date"
              value={draft.openingBalanceAsOf}
              onChange={(value) => set('openingBalanceAsOf', value)}
              error={fieldErrors.openingBalanceAsOf}
              hint="Entries dated before this day are refused, so the opening figure is never double-counted."
            />
          </div>
        </div>

        {formError ? <Banner tone="danger">{formError}</Banner> : null}
      </form>
    </Modal>
  );
}
