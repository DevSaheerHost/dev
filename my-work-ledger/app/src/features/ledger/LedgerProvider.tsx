/**
 * One place that subscribes to everything the ledger screens need.
 *
 * Four listeners per active shop — entries, income configs, day records and
 * statements — opened once here rather than per screen. The dashboard needs all shops at
 * once and the shop page needs one; both read from the same snapshots, so they
 * can never disagree about a balance.
 *
 * Firestore serves the first result from its on-device cache, so this paints
 * immediately and works offline. Nothing here computes money: the figures come
 * from `engine.ts` and `attendance.ts`, which are pure and tested.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { watchIncomeConfigs } from '@/data/incomeConfigs';
import { watchDaysFrom } from '@/data/days';
import { watchSettlements } from '@/data/settlements';
import { watchShopTransactions } from '@/data/transactions';
import { maxDate, type CalendarDate } from '@/lib/dates';
import type { DayRecord, IncomeConfig, Settlement, Shop, Transaction } from '@/types/models';

import { useAuth } from '../auth/AuthProvider';
import { useShops } from '../shops/ShopsProvider';

export interface ShopLedger {
  readonly transactions: readonly Transaction[];
  readonly configs: readonly IncomeConfig[];
  readonly days: readonly DayRecord[];
  readonly settlements: readonly Settlement[];
  readonly loaded: boolean;
}

const EMPTY: ShopLedger = {
  transactions: [],
  configs: [],
  days: [],
  settlements: [],
  loaded: false,
};

interface LedgerState {
  readonly ledgers: ReadonlyMap<string, ShopLedger>;
  readonly error: string | null;
}

const LedgerContext = createContext<LedgerState | null>(null);

/** The first day that can carry an entry for a shop. */
export function shopStartDate(shop: Shop): CalendarDate {
  return maxDate(shop.joiningDate, shop.openingBalanceAsOf);
}

type Part = 'transactions' | 'configs' | 'days' | 'settlements';
const PART_COUNT = 4;

export function LedgerProvider({ children }: { children: ReactNode }) {
  const { uid } = useAuth();
  const { activeShops } = useShops();
  const [ledgers, setLedgers] = useState<ReadonlyMap<string, ShopLedger>>(new Map());
  const [error, setError] = useState<string | null>(null);

  /**
   * Keyed on a plain string rather than on `activeShops` itself.
   *
   * Any edit to a shop document — a rename, an archive, moving the seal date —
   * gives `activeShops` a new identity. Depending on that directly tore down
   * and rebuilt every listener on each such edit, which flashed the loading
   * spinner and, because the spinner replaces the page, unmounted whatever
   * dialog was open and threw away its state. Sealing a period did exactly
   * that to the settle dialog, mid-flow.
   *
   * Only the shop ids and their start dates actually affect the queries, so
   * that is what the effect depends on.
   */
  const descriptor = activeShops.map((shop) => `${shop.id}@${shopStartDate(shop)}`).join('|');

  useEffect(() => {
    if (!uid || descriptor === '') return;
    const shops = descriptor.split('|').map((part) => {
      const [id = '', start = ''] = part.split('@');
      return { id, start: start as CalendarDate };
    });

    const loadedParts = new Map<string, Set<Part>>();

    const apply = (shopId: string, part: Part, patch: Partial<ShopLedger>) => {
      const parts = loadedParts.get(shopId) ?? new Set<Part>();
      parts.add(part);
      loadedParts.set(shopId, parts);

      setLedgers((previous) => {
        const next = new Map(previous);
        const current = next.get(shopId) ?? EMPTY;
        next.set(shopId, {
          ...current,
          ...patch,
          // Latches. Once a shop's data has been seen, a later resubscribe must
          // not drop the screen back to a spinner and unmount what is on it.
          loaded: current.loaded || parts.size === PART_COUNT,
        });
        return next;
      });
    };

    const onError = (failure: Error) => {
      setError(
        failure.message.includes('permission')
          ? 'This account is not allowed to read that ledger.'
          : 'Could not load entries. They will appear once the connection returns.',
      );
    };

    const unsubscribes = shops.flatMap((shop) => [
      watchShopTransactions(
        uid,
        shop.id,
        (transactions) => apply(shop.id, 'transactions', { transactions }),
        onError,
      ),
      watchIncomeConfigs(uid, shop.id, (configs) => apply(shop.id, 'configs', { configs }), onError),
      watchDaysFrom(
        uid,
        shop.id,
        shop.start,
        (days) => apply(shop.id, 'days', { days }),
        onError,
      ),
      watchSettlements(
        uid,
        shop.id,
        (settlements) => apply(shop.id, 'settlements', { settlements }),
        onError,
      ),
    ]);

    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [uid, descriptor]);

  const value = useMemo<LedgerState>(() => ({ ledgers, error }), [ledgers, error]);

  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>;
}

function useLedgerState(): LedgerState {
  const value = useContext(LedgerContext);
  if (!value) throw new Error('useLedger must be used inside LedgerProvider');
  return value;
}

/** Everything loaded for one shop. Empty until its first snapshot arrives. */
export function useShopLedger(shopId: string | null): ShopLedger {
  const { ledgers } = useLedgerState();
  return (shopId ? ledgers.get(shopId) : undefined) ?? EMPTY;
}

/** Every shop's ledger, for the cross-shop dashboard. */
export function useAllLedgers(): { ledgers: ReadonlyMap<string, ShopLedger>; error: string | null } {
  return useLedgerState();
}
