/**
 * Firebase client bootstrap.
 *
 * Configuration comes from `VITE_FIREBASE_*` environment variables, which are
 * baked into the bundle and are public by design. They identify the project;
 * they do not authorise anything. The only thing standing between one user's
 * ledger and another's is `firebase/firestore.rules`, which scopes every
 * document to `request.auth.uid`.
 *
 * Only the client SDK appears here. Admin SDK credentials have no place in a
 * browser bundle and are never referenced anywhere in this project.
 *
 * Initialisation is lazy and failure is non-fatal: a build with no
 * configuration still loads, and reports `cloud-not-configured` rather than
 * throwing an opaque SDK error on first use.
 */

import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';

interface FirebaseEnv {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

function readEnv(): FirebaseEnv | null {
  const env = import.meta.env;
  const apiKey = env.VITE_FIREBASE_API_KEY;
  const projectId = env.VITE_FIREBASE_PROJECT_ID;
  if (!apiKey || !projectId) return null;

  return {
    apiKey,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? `${projectId}.firebaseapp.com`,
    projectId,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? `${projectId}.firebasestorage.app`,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
    appId: env.VITE_FIREBASE_APP_ID ?? '',
  };
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let firestore: Firestore | null = null;
let initialised = false;

function init(): void {
  if (initialised) return;
  initialised = true;

  const config = readEnv();
  if (!config) return;

  try {
    app = initializeApp(config);
    auth = getAuth(app);
    // A ledger has to open and accept entries on a phone with no signal, so the
    // on-device cache is the primary store and the network is a synchroniser.
    // The multi-tab manager keeps two open tabs from fighting over the lease.
    firestore = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });

    // Local emulators, for developing and for testing the security rules
    // against the real rules engine. Guarded by `import.meta.env.DEV` so the
    // whole branch is removed from a production bundle: a shipped build that
    // could be pointed at an unauthenticated emulator would be a hole, not a
    // convenience, and an environment variable alone is too easy to set.
    if (import.meta.env.DEV && import.meta.env.VITE_FIREBASE_EMULATOR === '1') {
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      connectFirestoreEmulator(firestore, '127.0.0.1', 8080);
      console.warn('[work-ledger] connected to local Firebase emulators');
    }
  } catch (error) {
    if (import.meta.env.DEV) console.error('[work-ledger] firebase init failed', error);
    app = null;
    auth = null;
    firestore = null;
  }
}

/** True when this build can reach a backend at all. */
export function isCloudConfigured(): boolean {
  init();
  return auth !== null && firestore !== null;
}

/** The Auth instance, or null when the build carries no configuration. */
export function getAuthClient(): Auth | null {
  init();
  return auth;
}

/** The Firestore instance, or null when the build carries no configuration. */
export function getDb(): Firestore | null {
  init();
  return firestore;
}

export class CloudUnavailableError extends Error {
  constructor() {
    super('cloud-not-configured');
    this.name = 'CloudUnavailableError';
  }
}

/** Use where a caller cannot proceed without a backend. */
export function requireDb(): Firestore {
  const db = getDb();
  if (!db) throw new CloudUnavailableError();
  return db;
}

export function requireAuth(): Auth {
  const client = getAuthClient();
  if (!client) throw new CloudUnavailableError();
  return client;
}
