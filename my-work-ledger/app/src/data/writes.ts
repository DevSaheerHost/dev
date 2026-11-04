/**
 * How writes behave offline.
 *
 * A Firestore write promise resolves when the **server** acknowledges it. With
 * no connection it simply stays pending — not rejected, pending — potentially
 * for hours. So `await setDoc(...)` in a form handler leaves the button stuck
 * on "Saving…" forever on a phone with no signal, which for this app is the
 * normal case rather than the edge case.
 *
 * What actually happens on a write is that the local cache is updated
 * immediately and every `onSnapshot` listener fires at once. The entry is
 * saved, on the device, and will sync. That is the moment the user should be
 * told it worked.
 *
 * So every mutation here returns straight away and hands back a `synced`
 * promise for callers that genuinely need server confirmation (nothing in the
 * UI does). The promise is pre-attached to a no-op catch so an eventual
 * rejection — a rules denial, say — can never surface as an unhandled
 * rejection, while still being observable by anyone who awaits it.
 */

export interface PendingWrite {
  /** Resolves when the server has acknowledged the write. Never offline. */
  readonly synced: Promise<void>;
}

export interface PendingWriteWithId extends PendingWrite {
  /** The client-minted document id. Valid immediately, before any round trip. */
  readonly id: string;
}

/**
 * Wraps a write so it is observable but never unhandled.
 *
 * `onError` runs for a genuine failure, which in practice means a rules
 * rejection or a malformed document — not being offline.
 */
export function detach(write: Promise<unknown>, onError?: (error: unknown) => void): Promise<void> {
  const synced = write.then(() => undefined);
  synced.catch((error) => {
    if (onError) onError(error);
    else if (import.meta.env.DEV) console.error('[work-ledger] write failed', error);
  });
  return synced;
}
