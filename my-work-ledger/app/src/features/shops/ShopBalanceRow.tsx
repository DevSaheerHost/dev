/**
 * One shop in a list, with what it owes right now.
 *
 * Shared by the dashboard and the shop list so the two can never disagree: the
 * same component, fed the same `ShopFigures`, which both screens get from
 * `computeShopFigures`.
 *
 * The amount is tinted by direction and labelled in words. A tint alone is not
 * enough — it is invisible to a colour-blind eye and to anyone glancing — so
 * "owes you" or "you owe" is always written out beside it.
 */

import type { ReactNode } from 'react';
import { ChevronRight, MessageSquare } from 'lucide-react';

import { Amount, Avatar, Badge } from '@/components/ui';
import { formatDaysAgo, type CalendarDate } from '@/lib/dates';
import type { ShopFigures } from '@/features/ledger/figures';

export function ShopBalanceRow({
  figures,
  today,
  onOpen,
  onAsk,
}: {
  figures: ShopFigures;
  today: CalendarDate;
  onOpen: () => void;
  /** Offered only where asking makes sense — that is, when you are owed. */
  onAsk?: (() => void) | undefined;
}) {
  const { shop, balance, position, lastActivity } = figures;
  const direction = balance > 0 ? 'owes you' : balance < 0 ? 'you owe' : 'square';

  return (
    <li className="flex items-center gap-2 border-b border-line px-3 last:border-b-0">
      <button
        type="button"
        onClick={onOpen}
        className="-mx-1 flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-3 text-left hover:bg-surface-2"
      >
        <Avatar name={shop.name} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">{shop.name}</span>
          <span className="mt-0.5 block truncate text-xs text-ink-3">
            {lastActivity ? formatDaysAgo(lastActivity, today) : 'nothing recorded yet'}
            {position.counts.total > 0
              ? ` · day ${position.elapsed.worked} of ${position.counts.total}`
              : ''}
            {position.counts.off > 0 ? ` · ${position.counts.off} off` : ''}
          </span>
        </span>
      </button>

      <div className="flex shrink-0 flex-col items-end gap-1 py-2">
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open ${shop.name}`}
          className={`flex items-center gap-1 rounded-lg px-2 py-1 ${
            balance > 0
              ? 'bg-credit-soft'
              : balance < 0
                ? 'bg-debit-soft'
                : 'bg-surface-2'
          }`}
        >
          <Amount value={balance} tone="balance" size="md" />
          <ChevronRight size={14} className="text-ink-3" />
        </button>
        <span className="flex items-center gap-2 text-[0.65rem] font-semibold tracking-wide text-ink-3 uppercase">
          {direction}
          {onAsk && balance > 0 ? (
            <button
              type="button"
              onClick={onAsk}
              className="inline-flex items-center gap-1 rounded text-accent-ink hover:underline"
            >
              <MessageSquare size={11} />
              Ask
            </button>
          ) : null}
        </span>
      </div>
    </li>
  );
}

/** The same row for an archived shop, where there is no live ledger to read. */
export function ArchivedShopRow({
  name,
  children,
}: {
  name: string;
  children?: ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 border-b border-line px-3 py-3 last:border-b-0 opacity-70">
      <Avatar name={name} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">{name}</span>
        <span className="mt-0.5 block truncate text-xs text-ink-3">
          <Badge>archived</Badge>
        </span>
      </span>
      {children}
    </li>
  );
}
