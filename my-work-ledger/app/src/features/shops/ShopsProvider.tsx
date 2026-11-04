/**
 * The shop list, shared by every screen.
 *
 * One `onSnapshot` subscription feeds the whole app: the switcher, the
 * dashboard and the shop screens all read from here rather than each opening
 * their own listener. Firestore serves it from the on-device cache first, so
 * the list paints immediately and offline.
 *
 * The selected shop is *derived*, not stored in an effect. A stored selection
 * that no longer exists (archived on another device, say) would need an effect
 * to repair it, and that effect would fight the user's next tap.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { watchShops } from '@/data/shops';
import type { Shop } from '@/types/models';

import { useAuth } from '../auth/AuthProvider';

const SELECTION_KEY = 'work-ledger:selected-shop';

export interface ShopsState {
  readonly shops: readonly Shop[];
  readonly activeShops: readonly Shop[];
  readonly archivedShops: readonly Shop[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly selectedShop: Shop | null;
  readonly selectShop: (shopId: string | null) => void;
}

const ShopsContext = createContext<ShopsState | null>(null);

function readStoredSelection(): string | null {
  try {
    return window.localStorage.getItem(SELECTION_KEY);
  } catch {
    // Private browsing and locked-down WebViews throw on storage access. A
    // forgotten selection is a cosmetic loss, so it is swallowed.
    return null;
  }
}

/**
 * What one subscription has delivered so far. It carries the uid it belongs to,
 * so a result left over from a previous account is discarded during render
 * rather than cleared by a second effect — one less render, and no window in
 * which the wrong person's shop names are on screen.
 */
interface Snapshot {
  readonly uid: string;
  readonly shops: readonly Shop[];
  readonly error: string | null;
}

export function ShopsProvider({ children }: { children: ReactNode }) {
  const { uid } = useAuth();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [requestedId, setRequestedId] = useState<string | null>(readStoredSelection);

  useEffect(() => {
    if (!uid) return;
    return watchShops(
      uid,
      (next) => setSnapshot({ uid, shops: next, error: null }),
      (snapshotError) =>
        setSnapshot({
          uid,
          shops: [],
          error: snapshotError.message.includes('permission')
            ? 'This account is not allowed to read that ledger.'
            : 'Could not load your shops. They will appear once the connection returns.',
        }),
    );
  }, [uid]);

  const selectShop = useCallback((shopId: string | null) => {
    setRequestedId(shopId);
    try {
      if (shopId) window.localStorage.setItem(SELECTION_KEY, shopId);
      else window.localStorage.removeItem(SELECTION_KEY);
    } catch {
      // See readStoredSelection.
    }
  }, []);

  const value = useMemo<ShopsState>(() => {
    // Anything from another account is ignored; `loading` then simply means
    // "this account's first snapshot has not arrived yet".
    const current = snapshot && snapshot.uid === uid ? snapshot : null;
    const shops = current?.shops ?? [];
    const activeShops = shops.filter((shop) => shop.status === 'active');
    const archivedShops = shops.filter((shop) => shop.status === 'archived');
    const requested = requestedId ? shops.find((shop) => shop.id === requestedId) : undefined;
    // Fall back to the first active shop so a stale or archived selection never
    // leaves the user on an empty screen.
    const selectedShop = requested ?? activeShops[0] ?? null;

    return {
      shops,
      activeShops,
      archivedShops,
      loading: uid !== null && current === null,
      error: current?.error ?? null,
      selectedShop,
      selectShop,
    };
  }, [snapshot, uid, requestedId, selectShop]);

  return <ShopsContext.Provider value={value}>{children}</ShopsContext.Provider>;
}

export function useShops(): ShopsState {
  const value = useContext(ShopsContext);
  if (!value) throw new Error('useShops must be used inside ShopsProvider');
  return value;
}
