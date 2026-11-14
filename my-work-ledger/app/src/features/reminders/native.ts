/**
 * Android local notifications: the one thing the web build cannot do.
 *
 * A notification registered here is an alarm held by the operating system. It
 * fires with the app closed, survives a reboot (the plugin re-registers its
 * alarms on `BOOT_COMPLETED`), and does not need a server, a push service or an
 * account anywhere.
 *
 * Everything platform-specific is in this file. The rest of the app works with
 * `PlannedNotification`, which is decided by a pure function and tested without
 * a device. On the web every function here is a no-op that reports
 * `unsupported`, so nothing has to branch at the call site.
 *
 * Two honest limits, stated here and on the Reminders screen:
 *
 *  - Android 14 and later refuse *exact* alarms to an app that is not a clock
 *    or calendar. The plugin falls back to an inexact alarm, so a reminder set
 *    for 8pm can arrive a few minutes late. It does arrive.
 *  - The text is fixed when the alarm is set. See `plan.ts` for what that means
 *    for what a scheduled reminder is allowed to say.
 */

import { atLocalTime } from '@/lib/dates';

import type { PlannedNotification } from './plan';
import type { PermissionState } from './notifier';

/** The Android notification channel. Named for what the user sees in settings. */
const CHANNEL_ID = 'work-ledger-reminders';

export interface NativeSyncResult {
  readonly supported: boolean;
  readonly permission: PermissionState;
  /** Alarms registered with the operating system after this sync. */
  readonly scheduled: number;
  /** Alarms withdrawn because they are no longer in the plan. */
  readonly cancelled: number;
  readonly error?: string;
}

const UNSUPPORTED: NativeSyncResult = {
  supported: false,
  permission: 'unsupported',
  scheduled: 0,
  cancelled: 0,
};

/**
 * Is this the Android app rather than a browser?
 *
 * Imported lazily throughout: `@capacitor/core` is small, but the notification
 * plugin is not, and a browser should never download it.
 */
export async function isNativeApp(): Promise<boolean> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

async function plugin() {
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  return LocalNotifications;
}

export async function nativePermission(): Promise<PermissionState> {
  if (!(await isNativeApp())) return 'unsupported';
  try {
    const { display } = await (await plugin()).checkPermissions();
    return display === 'granted' ? 'granted' : display === 'denied' ? 'denied' : 'default';
  } catch {
    return 'unsupported';
  }
}

/** Asks Android for permission to post notifications (required from Android 13). */
export async function requestNativePermission(): Promise<PermissionState> {
  if (!(await isNativeApp())) return 'unsupported';
  try {
    const { display } = await (await plugin()).requestPermissions();
    return display === 'granted' ? 'granted' : display === 'denied' ? 'denied' : 'default';
  } catch {
    return 'unsupported';
  }
}

/**
 * Creates the channel the reminders post to.
 *
 * From Android 8 every notification belongs to a channel, and the *user* owns
 * its importance, sound and whether it may interrupt. Creating it up front is
 * what puts "Reminders" in the app's notification settings, so they can turn
 * the sound off without turning the reminders off.
 */
async function ensureChannel(): Promise<void> {
  try {
    await (
      await plugin()
    ).createChannel({
      id: CHANNEL_ID,
      name: 'Reminders',
      description: 'Food money, month end, salary day and your own reminders.',
      importance: 4,
      visibility: 1,
      vibration: true,
    });
  } catch {
    // Channels only exist on Android 8+; older versions reject this and post
    // the notification without one, which is correct behaviour there.
  }
}

/**
 * Makes the phone's registered alarms match the plan.
 *
 * Everything previously registered by this app is cancelled first. The ids are
 * deterministic, so the alarms that survive are re-registered at the same ids
 * and the user sees no churn — but a reminder that has dropped out of the plan
 * (shop archived, month confirmed, reminder switched off) is genuinely gone
 * rather than left waiting to fire something untrue.
 */
export async function syncNotifications(
  plan: readonly PlannedNotification[],
): Promise<NativeSyncResult> {
  if (!(await isNativeApp())) return UNSUPPORTED;

  const permission = await nativePermission();
  if (permission !== 'granted') {
    return { supported: true, permission, scheduled: 0, cancelled: 0 };
  }

  try {
    const notifications = await plugin();
    await ensureChannel();

    const { notifications: pending } = await notifications.getPending();
    if (pending.length > 0) {
      await notifications.cancel({ notifications: pending.map(({ id }) => ({ id })) });
    }

    const toSchedule = plan.flatMap((entry) => {
      const at = atLocalTime(entry.date, entry.time);
      // A date the scheduler cannot read is dropped rather than scheduled at
      // the epoch, which would fire the moment it is registered.
      if (!at) return [];
      return [
        {
          id: entry.id,
          title: entry.title,
          body: entry.body,
          channelId: CHANNEL_ID,
          smallIcon: 'ic_stat_notify',
          schedule: { at, allowWhileIdle: true },
          extra: { key: entry.key },
        },
      ];
    });

    if (toSchedule.length > 0) {
      await notifications.schedule({ notifications: toSchedule });
    }

    return {
      supported: true,
      permission,
      scheduled: toSchedule.length,
      cancelled: pending.length,
    };
  } catch (error) {
    return {
      supported: true,
      permission,
      scheduled: 0,
      cancelled: 0,
      error: error instanceof Error ? error.message : 'Could not set the reminders',
    };
  }
}

/** Withdraws every alarm this app has registered. */
export async function cancelAllNotifications(): Promise<number> {
  if (!(await isNativeApp())) return 0;
  try {
    const notifications = await plugin();
    const { notifications: pending } = await notifications.getPending();
    if (pending.length === 0) return 0;
    await notifications.cancel({ notifications: pending.map(({ id }) => ({ id })) });
    return pending.length;
  } catch {
    return 0;
  }
}
