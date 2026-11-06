/**
 * Actually telling the user.
 *
 * What this can and cannot do, plainly:
 *
 *   A web notification only fires while the app is open in a tab. There is no
 *   reliable way to wake a closed website on a phone — background push needs a
 *   server and an installed PWA, and periodic background sync is Chrome-only
 *   and unreliable. So on the web these are nudges you see when you look, not
 *   alarms that reach you.
 *
 * The Android build wires the same derived reminders to Capacitor's local
 * notifications, which do fire with the app closed. Until then the Reminders
 * screen says so, because a reminder you believe in and that silently never
 * arrives is worse than no reminder.
 */

import { useCallback, useEffect, useState } from 'react';

import { today as todayFn } from '@/lib/clock';

import type { DerivedReminder } from './derived';

export type PermissionState = 'unsupported' | 'default' | 'granted' | 'denied';

export function notificationSupport(): PermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission as PermissionState;
}

/** Which reminders have already been shown today, so reopening does not repeat them. */
const STORAGE_KEY = 'work-ledger:notified';

function readNotified(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return new Set();
    const { day, ids } = parsed as { day?: unknown; ids?: unknown };
    // Yesterday's record is irrelevant; everything is due again today.
    if (day !== todayFn() || !Array.isArray(ids)) return new Set();
    return new Set(ids.filter((id): id is string => typeof id === 'string'));
  } catch {
    // Private windows and locked-down WebViews throw on storage access. The
    // worst case is a reminder shown twice, so this is swallowed.
    return new Set();
  }
}

function writeNotified(ids: Set<string>): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ day: todayFn(), ids: [...ids].slice(-200) }),
    );
  } catch {
    // See readNotified.
  }
}

/** Shows one notification. Returns false when the browser would not. */
export function showNotification(reminder: DerivedReminder): boolean {
  if (notificationSupport() !== 'granted') return false;
  try {
    // `tag` collapses repeats of the same reminder into one entry rather than
    // stacking them up in the tray.
    new Notification(reminder.title, {
      body: reminder.body,
      tag: reminder.id,
      icon: './icon-192.png',
    });
    return true;
  } catch {
    return false;
  }
}

/** How often the open app re-checks whether anything has come due. */
const CHECK_INTERVAL_MS = 60_000;

export interface Notifier {
  readonly permission: PermissionState;
  readonly request: () => Promise<PermissionState>;
  /** Reminders shown as notifications in this session. */
  readonly notifiedCount: number;
}

/**
 * Fires notifications for reminders that have come due, while the app is open.
 *
 * `due` is recomputed by the caller from the ledger, so this only has to decide
 * what is new. Each reminder's id already encodes its day, so a stable id
 * notified once stays notified.
 */
export function useNotifier(due: readonly DerivedReminder[]): Notifier {
  const [permission, setPermission] = useState<PermissionState>(notificationSupport);
  const [notifiedCount, setNotifiedCount] = useState(0);

  const request = useCallback(async (): Promise<PermissionState> => {
    if (notificationSupport() === 'unsupported') return 'unsupported';
    const result = (await Notification.requestPermission()) as PermissionState;
    setPermission(result);
    return result;
  }, []);

  // The ids are joined into a string so the effect re-runs when the set of due
  // reminders genuinely changes, rather than on every render.
  const dueKey = due.map((reminder) => reminder.id).join('|');

  useEffect(() => {
    if (permission !== 'granted' || dueKey === '') return;

    const fire = () => {
      const already = readNotified();
      let shown = 0;
      for (const id of dueKey.split('|')) {
        if (already.has(id)) continue;
        const reminder = due.find((entry) => entry.id === id);
        if (!reminder) continue;
        if (showNotification(reminder)) {
          already.add(id);
          shown += 1;
        }
      }
      if (shown > 0) {
        writeNotified(already);
        setNotifiedCount((previous) => previous + shown);
      }
    };

    fire();
    const timer = window.setInterval(fire, CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
    // `due` is intentionally not a dependency: `dueKey` is its identity, and
    // depending on the array itself would restart the interval every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission, dueKey]);

  return { permission, request, notifiedCount };
}

/**
 * What to tell the user about where reminders will and will not reach them.
 *
 * The two platforms differ in the one way that matters, so they are not given
 * the same sentence: on Android these are alarms held by the phone, on the web
 * they are prompts that only exist while a tab is open.
 */
export function describeDelivery(permission: PermissionState, native: boolean): string {
  if (native) {
    switch (permission) {
      case 'unsupported':
        return 'This phone will not let the app post notifications. Reminders still appear in the app whenever you open it.';
      case 'denied':
        return 'Notifications are turned off for this app. Turn them back on in Android settings → Apps → My Work Ledger → Notifications.';
      case 'default':
        return 'Android has not been asked yet whether this app may notify you.';
      case 'granted':
        return 'Reminders are set with Android itself, so they arrive with the app closed and survive a restart. Android may hold one back a few minutes while the phone is asleep.';
    }
  }

  switch (permission) {
    case 'unsupported':
      return 'This browser cannot show notifications. Reminders still appear in the app whenever you open it.';
    case 'denied':
      return 'Notifications are blocked for this site. You can turn them back on in your browser settings; reminders still appear in the app.';
    case 'default':
      return 'Notifications are not switched on yet.';
    case 'granted':
      return 'Notifications are on — but a web page can only show them while the app is open. For reminders that reach you with the app closed, install the Android build.';
  }
}
