import "server-only";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

/**
 * Firebase Admin SDK. The Next.js server is the ONLY client that reads or
 * writes Firestore/Storage; security rules deny all direct browser access.
 * Credentials come from env (service account) or, in local development,
 * from the emulators (FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST).
 */
let app: App | null = null;

// Next.js may load this module once per server bundle, but Firestore settings
// can only be applied once per process, so the instance lives on globalThis.
const globalForFirestore = globalThis as unknown as { __stockpilotFirestore?: Firestore };

function adminApp(): App {
  if (app) return app;
  if (getApps().length) return (app = getApps()[0]!);
  const projectId = process.env.FIREBASE_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("FIREBASE_PROJECT_ID is not configured.");
  const usingEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  app = initializeApp({
    projectId,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET ?? process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    ...(!usingEmulator && clientEmail && privateKey ? { credential: cert({ projectId, clientEmail, privateKey }) } : {}),
  });
  return app;
}

export function db(): Firestore {
  if (globalForFirestore.__stockpilotFirestore) return globalForFirestore.__stockpilotFirestore;
  const firestore = getFirestore(adminApp());
  try {
    firestore.settings({ ignoreUndefinedProperties: true });
  } catch {
    // Already configured by another bundle in this process.
  }
  globalForFirestore.__stockpilotFirestore = firestore;
  return firestore;
}

export const adminAuth = () => getAuth(adminApp());
export const bucket = () => getStorage(adminApp()).bucket();
