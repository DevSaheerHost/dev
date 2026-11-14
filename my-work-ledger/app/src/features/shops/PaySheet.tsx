/**
 * Changing what a shop pays you.
 *
 * This did not exist before, which made the app a dead end: your pay was asked
 * for once, when you added the shop, and could never be changed. Type ₹2,000
 * instead of ₹20,000 and every figure after it was wrong forever. Get a raise
 * and there was nowhere to say so.
 *
 * The two reasons for changing a number are genuinely different, and the
 * difference matters to every past figure, so the user is asked which one it
 * is in plain words rather than being given a date field and left to work it
 * out:
 *
 *   "I typed it wrong"  the old number was never true, so it is corrected
 *                       from the start and past months are recomputed.
 *   "My pay changed"    the old number was true until a date and the new one
 *                       is true after it. The old rate is closed the day
 *                       before and the new one opens, so last month's figures
 *                       stay exactly as they were.
 *
 * The second is what the ledger engine's effective dating is for; this screen
 * is the plain-language front of it.
 */

import { useState } from 'react';
import { Loader2, Plus, Utensils, Wallet } from 'lucide-react';

import { Banner, Button, ChipGroup, Disclosure, MoneyInput, Modal, TextInput } from '@/components/ui';
import {
  createIncomeConfig,
  endIncomeConfig,
  updateIncomeConfig,
} from '@/data/incomeConfigs';
import { today as todayFn } from '@/lib/clock';
import { addDays, formatDateShort, isCalendarDate, type CalendarDate } from '@/lib/dates';
import { formatPaise, formatPaiseForInput, parseRupeesToPaise } from '@/lib/money';
import type { IncomeConfig, Shop } from '@/types/models';

import { useAuth } from '../auth/AuthProvider';

type Reason = 'mistake' | 'changed';

const REASONS: readonly { value: Reason; label: string }[] = [
  { value: 'mistake', label: 'I typed it wrong' },
  { value: 'changed', label: 'My pay changed' },
];

/** The live monthly pay and daily food money, if either is set up. */
export function currentRates(configs: readonly IncomeConfig[], today: CalendarDate) {
  const live = configs.filter(
    (config) =>
      config.active &&
      config.effectiveFrom <= today &&
      (config.effectiveTo === null || config.effectiveTo >= today),
  );
  return {
    salary: live.find((config) => config.frequency === 'monthly') ?? null,
    food: live.find((config) => config.frequency === 'daily') ?? null,
  };
}

export function PaySheet({
  shop,
  configs,
  onClose,
}: {
  shop: Shop;
  configs: readonly IncomeConfig[];
  onClose: () => void;
}) {
  const { uid } = useAuth();
  const today = todayFn();
  const rates = currentRates(configs, today);

  const [salary, setSalary] = useState(
    rates.salary ? formatPaiseForInput(rates.salary.amount) : '',
  );
  const [food, setFood] = useState(rates.food ? formatPaiseForInput(rates.food.amount) : '');
  const [reason, setReason] = useState<Reason>('mistake');
  const [from, setFrom] = useState<string>(today);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const salaryChanged =
    salary.trim() !== (rates.salary ? formatPaiseForInput(rates.salary.amount) : '');
  const foodChanged = food.trim() !== (rates.food ? formatPaiseForInput(rates.food.amount) : '');
  const anythingChanged = salaryChanged || foodChanged;

  /**
   * Applies one rate change.
   *
   * A correction rewrites the rate in place, because the old figure was never
   * true. A real change closes the old rate the day before the new one starts,
   * which is what keeps already-confirmed months untouched.
   */
  function apply(
    existing: IncomeConfig | null,
    amountText: string,
    spec: { kind: 'salary' | 'allowance'; label: string; frequency: 'monthly' | 'daily' },
    effectiveFrom: CalendarDate,
  ): string | null {
    if (!uid) return 'You are not signed in.';

    const trimmed = amountText.trim();

    // Cleared: stop the rate rather than delete it, so the months it already
    // produced can still be explained.
    if (trimmed === '') {
      if (existing) endIncomeConfig(uid, shop.id, existing.id, addDays(today, -1));
      return null;
    }

    const parsed = parseRupeesToPaise(trimmed);
    if (!parsed.ok) return parsed.error;
    if (parsed.value <= 0) return 'Enter an amount greater than zero.';

    if (existing && reason === 'mistake') {
      updateIncomeConfig(uid, shop.id, existing.id, {
        kind: spec.kind,
        label: spec.label,
        amount: parsed.value,
        frequency: spec.frequency,
        effectiveFrom: existing.effectiveFrom,
        effectiveTo: existing.effectiveTo,
      });
      return null;
    }

    if (existing) endIncomeConfig(uid, shop.id, existing.id, addDays(effectiveFrom, -1));

    createIncomeConfig(uid, shop.id, {
      kind: spec.kind,
      label: spec.label,
      amount: parsed.value,
      frequency: spec.frequency,
      effectiveFrom,
      effectiveTo: null,
    });
    return null;
  }

  function save() {
    if (busy || !uid) return;

    const start = (isCalendarDate(from) ? from : today) as CalendarDate;
    if (reason === 'changed' && start < shop.joiningDate) {
      setError('That is before you started at this shop.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (salaryChanged) {
        const problem = apply(
          rates.salary,
          salary,
          { kind: 'salary', label: 'Monthly salary', frequency: 'monthly' },
          start,
        );
        if (problem) {
          setError(problem);
          return;
        }
      }
      if (foodChanged) {
        const problem = apply(
          rates.food,
          food,
          { kind: 'allowance', label: 'Food money', frequency: 'daily' },
          start,
        );
        if (problem) {
          setError(problem);
          return;
        }
      }
      onClose();
    } catch {
      setError('Could not save that. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="What this shop pays you"
      footer={
        <>
          <Button tone="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            tone="primary"
            onClick={save}
            disabled={busy || !anythingChanged}
            className="flex-1"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : null}
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-2">
          Change these and {shop.name}&apos;s figures follow. You only ever enter them here —
          there is nothing to type in each month.
        </p>

        <MoneyInput
          label="Pay for a full month"
          value={salary}
          onChange={setSalary}
          hint="Leave empty if this shop pays you by the day instead."
        />

        <MoneyInput
          label="Food money for each day you work"
          value={food}
          onChange={setFood}
          hint="Leave empty if you do not get it."
        />

        {anythingChanged ? (
          <div className="rounded-xl border border-accent/30 bg-accent-soft/40 p-4">
            <ChipGroup
              label="Why is it changing?"
              value={reason}
              onChange={setReason}
              options={REASONS}
            />
            <p className="mt-2 text-sm text-ink-2">
              {reason === 'mistake'
                ? 'The old amount was never right, so every month is worked out again with the new one.'
                : 'Months before the date below keep the old amount, so anything you have already agreed stays as it was.'}
            </p>
            {reason === 'changed' ? (
              <div className="mt-3">
                <TextInput
                  label="New amount starts from"
                  type="date"
                  value={from}
                  onChange={setFrom}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {error ? <Banner tone="danger">{error}</Banner> : null}

        <Disclosure title="What is set up now" description="The rates these figures come from">
          <ul className="flex flex-col gap-2 text-sm">
            {rates.salary ? (
              <li className="flex items-baseline justify-between gap-3">
                <span className="flex items-center gap-2 text-ink-2">
                  <Wallet size={14} aria-hidden />
                  Monthly pay since {formatDateShort(rates.salary.effectiveFrom)}
                </span>
                <span className="font-semibold text-ink">{formatPaise(rates.salary.amount)}</span>
              </li>
            ) : (
              <li className="text-ink-3">No monthly pay set up.</li>
            )}
            {rates.food ? (
              <li className="flex items-baseline justify-between gap-3">
                <span className="flex items-center gap-2 text-ink-2">
                  <Utensils size={14} aria-hidden />
                  Food money since {formatDateShort(rates.food.effectiveFrom)}
                </span>
                <span className="font-semibold text-ink">
                  {formatPaise(rates.food.amount)} a day
                </span>
              </li>
            ) : (
              <li className="flex items-center gap-2 text-ink-3">
                <Plus size={14} aria-hidden />
                No food money set up. Type an amount above to add it.
              </li>
            )}
          </ul>
        </Disclosure>
      </div>
    </Modal>
  );
}
