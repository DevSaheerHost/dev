/**
 * Add or edit a shop.
 *
 * The opening balance is the one genuinely confusing field, so it is asked as a
 * direction plus a magnitude rather than as a signed number: "the shop owes me"
 * or "I owe the shop". A minus sign in a money field is a reliable source of
 * sign errors, and this is the figure every later balance is built on.
 */

import { useState } from 'react';
import { Archive, ArchiveRestore, Loader2 } from 'lucide-react';

import { Banner, Button, MoneyInput, Modal, Select, TextInput } from '@/components/ui';
import { today } from '@/lib/clock';
import { normalisePhone } from '@/lib/contact';
import { formatPaiseForInput, parseRupeesToPaise, paise, type Paise } from '@/lib/money';
import { isCalendarDate, type CalendarDate } from '@/lib/dates';
import {
  createShop,
  setShopStatus,
  updateShop,
  validateShopInput,
  type ShopInput,
} from '@/data/shops';
import { createIncomeConfig } from '@/data/incomeConfigs';
import type { SettlementMode, Shop } from '@/types/models';

import { useAuth } from '../auth/AuthProvider';

type Direction = 'owedToMe' | 'owedByMe';

interface Draft {
  name: string;
  description: string;
  phone: string;
  joiningDate: string;
  salaryPayDay: string;
  settlementMode: SettlementMode;
  openingAmount: string;
  openingDirection: Direction;
  openingBalanceAsOf: string;
  /** Asked here, on a new shop only, because nothing accrues without it. */
  monthlySalary: string;
  dailyFood: string;
}

function draftFromShop(shop: Shop | null): Draft {
  if (!shop) {
    const now = today();
    return {
      name: '',
      description: '',
      phone: '',
      joiningDate: now,
      salaryPayDay: '1',
      settlementMode: 'accrual',
      openingAmount: '',
      openingDirection: 'owedToMe',
      openingBalanceAsOf: now,
      monthlySalary: '',
      dailyFood: '',
    };
  }
  return {
    name: shop.name,
    description: shop.description,
    phone: shop.phone ?? '',
    joiningDate: shop.joiningDate,
    salaryPayDay: String(shop.salaryPayDay),
    settlementMode: shop.settlementMode,
    openingAmount: shop.openingBalance === 0 ? '' : formatPaiseForInput(paise(Math.abs(shop.openingBalance))),
    openingDirection: shop.openingBalance < 0 ? 'owedByMe' : 'owedToMe',
    openingBalanceAsOf: shop.openingBalanceAsOf,
    // Income is only asked on creation. Editing an existing rate has to be
    // effective-dated so last month's figures do not change retroactively,
    // which is a different screen rather than a field on this one.
    monthlySalary: '',
    dailyFood: '',
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
  // Until the user edits the balance date themselves it follows the joining
  // date. Without this, backdating a new shop to last month would silently
  // accrue nothing: the balance date governs where accrual starts, and it would
  // still be sitting on today.
  const [balanceDateTouched, setBalanceDateTouched] = useState(false);
  const [salaryError, setSalaryError] = useState<string | undefined>(undefined);
  const [foodError, setFoodError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const archived = shop?.status === 'archived';

  function toggleArchive() {
    if (!uid || !shop || busy) return;
    setArchiveError(null);
    try {
      // Not awaited: the snapshot listener reflects it at once, online or off.
      setShopStatus(uid, shop.id, archived ? 'active' : 'archived');
      onClose();
    } catch {
      setArchiveError('Could not change that. Please try again.');
    }
  }

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((previous) => {
      const next = { ...previous, [key]: value };
      if (key === 'joiningDate' && !balanceDateTouched) {
        next.openingBalanceAsOf = value as string;
      }
      return next;
    });
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
      phone: normalisePhone(draft.phone),
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

    let incomeInvalid = false;
    for (const [value, setError] of [
      [draft.monthlySalary, setSalaryError],
      [draft.dailyFood, setFoodError],
    ] as const) {
      if (value.trim() === '') {
        setError(undefined);
        continue;
      }
      const parsed = parseRupeesToPaise(value);
      if (!parsed.ok) {
        setError(parsed.error);
        incomeInvalid = true;
      } else if (parsed.value < 0) {
        setError('Enter a positive amount');
        incomeInvalid = true;
      } else {
        setError(undefined);
      }
    }
    if (incomeInvalid) return;

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
      // Not awaited: the write lands in the on-device cache immediately and the
      // listeners fire at once, so the shop is saved. Awaiting the server would
      // leave this button on "Saving..." indefinitely with no signal, which for
      // this app is an ordinary Tuesday rather than an edge case.
      if (shop) {
        updateShop(uid, shop.id, input);
        onSaved?.(shop.id);
      } else {
        const { id } = createShop(uid, input);

        // Income is created alongside the shop rather than on a separate
        // screen. Without at least one config nothing accrues, and a shop that
        // silently earns nothing is the most confusing state this app can be
        // in. Both configs start on the joining date, so the first month is
        // pro-rated correctly from day one.
        const salary = parseRupeesToPaise(draft.monthlySalary);
        if (salary.ok && salary.value > 0) {
          createIncomeConfig(uid, id, {
            kind: 'salary',
            label: 'Monthly salary',
            amount: salary.value,
            frequency: 'monthly',
            effectiveFrom: input.joiningDate,
            effectiveTo: null,
          });
        }

        const food = parseRupeesToPaise(draft.dailyFood);
        if (food.ok && food.value > 0) {
          createIncomeConfig(uid, id, {
            kind: 'allowance',
            label: 'Food money',
            amount: food.value,
            frequency: 'daily',
            effectiveFrom: input.joiningDate,
            effectiveTo: null,
          });
        }

        onSaved?.(id);
      }
      onClose();
    } catch (error) {
      setFormError(
        error instanceof Error && error.message === 'cloud-not-configured'
          ? 'This build has no Firebase configuration, so nothing can be saved.'
          : 'Could not save the shop. Check the details and try again.',
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
          label="Owner's phone (optional)"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={draft.phone}
          onChange={(value) => set('phone', value)}
          maxLength={20}
          error={fieldErrors.phone}
          placeholder="+91 98765 43210"
          hint="Used to call the shop, or to send the balance as a message. Nothing is sent without you tapping send."
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
              onChange={(value) => {
                setBalanceDateTouched(true);
                set('openingBalanceAsOf', value);
              }}
              error={fieldErrors.openingBalanceAsOf}
              hint="Entries and salary before this day are not counted, so the opening figure is never double-counted. It follows the joining date unless you change it."
            />
          </div>
        </div>

        {shop ? null : (
          <div className="rounded-xl border border-line bg-surface-2 p-4">
            <p className="mb-1 text-sm font-semibold text-ink">What this shop pays you</p>
            <p className="mb-3 text-sm text-ink-2">
              The salary builds up day by day from the date you joined, so you can see what you
              are owed at any point in the month.
            </p>
            <div className="flex flex-col gap-4">
              <MoneyInput
                label="Monthly salary"
                value={draft.monthlySalary}
                onChange={(value) => set('monthlySalary', value)}
                error={salaryError}
                hint="Leave blank if this shop pays you by the day instead."
              />
              <MoneyInput
                label="Food money per day (optional)"
                value={draft.dailyFood}
                onChange={(value) => set('dailyFood', value)}
                error={foodError}
                hint="Owed for every day you work. Tick off the days you were actually given it."
              />
            </div>
          </div>
        )}

        {formError ? <Banner tone="danger">{formError}</Banner> : null}
      </form>

      {/*
        Archiving lives here rather than on the list: it belongs with the shop's
        own settings, and a list row is the wrong place for an action that
        removes something from every total. Outside the form element, so Enter
        in a text field can never reach it.
      */}
      {shop ? (
        <div className="mt-6 border-t border-line pt-4">
          <p className="text-sm font-semibold text-ink">
            {archived ? 'This shop is archived' : 'Left this shop?'}
          </p>
          <p className="mt-0.5 text-sm text-ink-2">
            {archived
              ? 'It is hidden from your totals. Nothing was deleted — restore it to carry on.'
              : 'Archiving hides it from your dashboard and totals. Its entries, statements and history all stay.'}
          </p>
          {archiveError ? (
            <p className="mt-2 text-sm text-danger" role="alert">
              {archiveError}
            </p>
          ) : null}
          <Button
            tone={archived ? 'neutral' : 'danger'}
            onClick={toggleArchive}
            disabled={busy}
            className="mt-3"
          >
            {archived ? (
              <>
                <ArchiveRestore size={15} />
                Restore this shop
              </>
            ) : (
              <>
                <Archive size={15} />
                Archive this shop
              </>
            )}
          </Button>
        </div>
      ) : null}
    </Modal>
  );
}
