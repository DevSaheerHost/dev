/**
 * Firebase client bootstrap.
 *
 * Configuration comes from environment variables only. If the build has no
 * configuration the app still runs — QR and direct transfer work without any
 * backend — and every cloud call reports `cloud-not-configured` instead of
 * throwing an opaque SDK error.
 *
 * Only the client SDK is used here. Admin credentials have no place in a
 * browser bundle and are never referenced.
 */

import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getDatabase, type Database } from 'firebase/database';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

interface FirebaseEnv {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  databaseURL: string;
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
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? `${projectId}.appspot.com`,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
    appId: env.VITE_FIREBASE_APP_ID ?? '',
    databaseURL:
      env.VITE_FIREBASE_DATABASE_URL ?? `https://${projectId}-default-rtdb.firebaseio.com`,
  };
}

let app: FirebaseApp | null = null;
let database: Database | null = null;
let storage: FirebaseStorage | null = null;
let initialised = false;

function init(): void {
  if (initialised) return;
  initialised = true;
  const config = readEnv();
  if (!config) return;
  try {
    app = initializeApp(config);
    database = getDatabase(app);
    storage = getStorage(app);
  } catch (error) {
    if (import.meta.env.DEV) console.error('[transferbox] firebase init failed', error);
    app = null;
    database = null;
    storage = null;
  }
}

/** True when this build can reach a backend at all. */
export function isCloudConfigured(): boolean {
  init();
  return database !== null && storage !== null;
}

export function getDb(): Database | null {
  init();
  return database;
}

export function getFiles(): FirebaseStorage | null {
  init();
  return storage;
}
