/**
 * The user profile document.
 *
 * Created on first sign-in. It exists mainly to carry `schemaVersion`, so a
 * future migration can tell an old ledger from a new one instead of guessing
 * from the shape of the data.
 */

import { getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

import { SCHEMA_VERSION, type UserProfile } from '@/types/models';

import { getDb, requireDb } from './client';
import { userDoc } from './paths';
import { detach, type PendingWrite } from './writes';

export const MAX_NAME_LENGTH = 60;

/** Trims and bounds a display name. Empty names fall back to "Me". */
export function normaliseDisplayName(value: string): string {
  const trimmed = value.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
  return trimmed === '' ? 'Me' : trimmed;
}

/** Creates the profile if it is missing. Safe to call on every sign-in. */
export async function ensureProfile(uid: string, displayName: string): Promise<void> {
  const db = requireDb();
  const ref = userDoc(db, uid);
  const snapshot = await getDoc(ref);
  if (snapshot.exists()) return;
  await setDoc(ref, {
    schemaVersion: SCHEMA_VERSION,
    displayName: normaliseDisplayName(displayName),
    currency: 'INR',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** Not awaited by callers: see the note in `writes.ts` about offline writes. */
export function updateDisplayName(uid: string, displayName: string): PendingWrite {
  const db = requireDb();
  const synced = detach(
    updateDoc(userDoc(db, uid), {
      displayName: normaliseDisplayName(displayName),
      updatedAt: serverTimestamp(),
    }),
  );
  return { synced };
}

export function watchProfile(
  uid: string,
  onChange: (profile: UserProfile | null) => void,
  onError: (error: Error) => void,
): () => void {
  const db = getDb();
  if (!db) {
    onChange(null);
    return () => {};
  }
  return onSnapshot(
    userDoc(db, uid),
    (snapshot) => {
      const data = snapshot.data();
      if (!data) {
        onChange(null);
        return;
      }
      onChange({
        schemaVersion: typeof data.schemaVersion === 'number' ? data.schemaVersion : 0,
        displayName: typeof data.displayName === 'string' ? data.displayName : 'Me',
        currency: 'INR',
        createdAt: data.createdAt ?? null,
        updatedAt: data.updatedAt ?? null,
      });
    },
    (error) => onError(error),
  );
}
