/**
 * The one place reminders are worked out and delivered.
 *
 * Mounted once, inside the ledger provider, and renders only its children. It
 * does three things:
 *
 *  1. Derives what needs doing right now from the ledger, so the dashboard and
 *     the reminders screen read the same list rather than each computing their
 *     own.
 *  2. On the web, fires a notification for anything newly due **while the app
 *     is open, on any screen**. Before this lived here it ran inside the
 *     Reminders tab, which meant a reminder only ever fired if you happened to
 *     be looking at the Reminders tab — the one screen where you would have
 *     seen it anyway.
 *  3. On Android, keeps the operating system's alarms in step with the plan, so
 *     reminders arrive with the app closed. Rebuilt whenever the plan changes
 *     and whenever the app returns to the foreground, which is what stops an
 *     alarm firing for something already dealt with.
 *
 * Web notifications are suppressed on Android: the alarms are the real ones
 * there, and both would show the same thing twice.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { nowTime, today as todayFn } from '@/lib/clock';
import { isDailySettled } from '@/features/ledger/attendance';
import { useAllLedgers, useReminders } from '@/features/ledger/LedgerProvider';
import { useShops } from '@/features/shops/ShopsProvider';

import { deriveReminders, type DerivedKind, type DerivedReminder, type ReminderPrefs } from './derived';
import {
  isNativeApp,
  nativePermission,
  requestNativePermission,
  syncNotifications,
  type NativeSyncResult,
} from './native';
import { useNotifier, type PermissionState } from './notifier';
import {
  planFingerprint,
  planNotifications,
  type PlanShop,
  type PlannedNotification,
} from './plan';

export interface ReminderRuntime {
  /** What needs doing right now, across every active shop. */
  readonly derived: readonly DerivedReminder[];
  /** True in the Android app, false in a browser. */
  readonly native: boolean;
  /** Alarms this app would like the phone to hold. Empty on the web. */
  readonly plan: readonly PlannedNotification[];
  /** The last sync with the phone's scheduler, or null on the web. */
  readonly sync: NativeSyncResult | null;
  /** Whether notifications may be shown, on whichever platform this is. */
  readonly permission: PermissionState;
  readonly requestPermission: () => Promise<PermissionState>;
  /** Web notifications fired in this session. Always 0 on Android. */
  readonly notifiedCount: number;
}

const EMPTY: ReminderRuntime = {
  derived: [],
  native: false,
  plan: [],
  sync: null,
  permission: 'unsupported',
  requestPermission: async () => 'unsupported',
  notifiedCount: 0,
};

/** How often an open app re-reads the clock. Slow: nothing here is urgent. */
const CLOCK_REFRESH_MS = 15 * 60_000;

const Context = createContext<ReminderRuntime>(EMPTY);

export function useReminderRuntime(): ReminderRuntime {
  return useContext(Context);
}

export function ReminderRuntimeProvider({ children }: { children: ReactNode }) {
  const { activeShops } = useShops();
  const { ledgers } = useAllLedgers();
  const stored = useReminders();

  // null until the platform check resolves. Starting at `false` would let the
  // web notifier fire once on Android before we knew better, which is a
  // notification the phone's own alarm is also going to show.
  const [native, setNative] = useState<boolean | null>(null);
  const [androidPermission, setAndroidPermission] = useState<PermissionState>('unsupported');
  const [sync, setSync] = useState<NativeSyncResult | null>(null);
  // Bumped whenever the app comes back to the foreground, so the alarms are
  // re-registered even when the plan itself works out identical.
  const [resumes, setResumes] = useState(0);

  /**
   * The clock, read deliberately rather than on every render.
   *
   * Everything here — what is due, and what the phone is asked to hold — is a
   * function of "now", so "now" is a value that changes at known moments: when
   * the app comes back to the foreground, and on a slow timer while it is
   * open. An app left open past a reminder's hour would otherwise still be
   * holding a plan built before it, and re-registering that plan would
   * schedule an alarm for a moment already gone, which fires immediately.
   */
  const [clock, setClock] = useState(() => ({ date: todayFn(), time: nowTime() }));
  const today = clock.date;

  useEffect(() => {
    const timer = window.setInterval(
      () => setClock({ date: todayFn(), time: nowTime() }),
      CLOCK_REFRESH_MS,
    );
    return () => window.clearInterval(timer);
  }, []);

  /* ---- what needs doing right now ---------------------------------------- */

  const prefs = useMemo<ReminderPrefs>(() => {
    const map = new Map<DerivedKind, { enabled: boolean; time: string }>();
    for (const reminder of stored) {
      if (reminder.kind === 'custom') continue;
      map.set(reminder.kind as DerivedKind, {
        enabled: reminder.enabled,
        time: reminder.time,
      });
    }
    return map;
  }, [stored]);

  const snapshots = useMemo(
    () =>
      activeShops.map((shop) => {
        const ledger = ledgers.get(shop.id);
        return {
          shop,
          transactions: ledger?.transactions ?? [],
          configs: ledger?.configs ?? [],
          days: ledger?.days ?? [],
        };
      }),
    [activeShops, ledgers],
  );

  const derived = useMemo(
    () => deriveReminders({ shops: snapshots, prefs, today }),
    [snapshots, prefs, today],
  );

  /* ---- the web: while the app is open, on any screen ---------------------- */

  const notifier = useNotifier(native === false ? derived : []);

  /* ---- Android: real alarms ----------------------------------------------- */

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const isNative = await isNativeApp();
      if (cancelled) return;
      setNative(isNative);
      if (isNative) setAndroidPermission(await nativePermission());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-plan when the app comes back to the foreground.
  useEffect(() => {
    if (native !== true) return;
    let detach: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      const { App } = await import('@capacitor/app');
      const handle = await App.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) return;
        setClock({ date: todayFn(), time: nowTime() });
        setResumes((count) => count + 1);
      });
      if (cancelled) void handle.remove();
      else detach = () => void handle.remove();
    })();

    return () => {
      cancelled = true;
      detach?.();
    };
  }, [native]);

  const planShops = useMemo<PlanShop[]>(
    () =>
      activeShops.map((shop) => ({
        id: shop.id,
        name: shop.name,
        status: shop.status,
        settlementMode: shop.settlementMode,
        salaryPayDay: shop.salaryPayDay,
        hasDailyAllowance: (ledgers.get(shop.id)?.configs ?? []).some(
          (config) => config.active && isDailySettled(config),
        ),
      })),
    [activeShops, ledgers],
  );

  const plan = useMemo(
    () =>
      native === true
        ? planNotifications({
            reminders: stored,
            shops: planShops,
            now: clock,
          })
        : [],
    [native, stored, planShops, clock],
  );

  // The fingerprint, not the array: a new array on every render would have the
  // phone rescheduling continuously.
  const fingerprint = planFingerprint(plan);

  useEffect(() => {
    if (native !== true || androidPermission !== 'granted') return;
    let cancelled = false;
    void (async () => {
      const result = await syncNotifications(plan);
      if (!cancelled) setSync(result);
    })();
    return () => {
      cancelled = true;
    };
    // `plan` is intentionally absent: `fingerprint` is its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native, androidPermission, fingerprint, resumes]);

  const value = useMemo<ReminderRuntime>(
    () => ({
      derived,
      native: native === true,
      plan,
      sync,
      permission: native === true ? androidPermission : notifier.permission,
      requestPermission: async () => {
        if (native !== true) return notifier.request();
        const result = await requestNativePermission();
        setAndroidPermission(result);
        return result;
      },
      notifiedCount: native === true ? 0 : notifier.notifiedCount,
    }),
    [derived, native, plan, sync, androidPermission, notifier],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
