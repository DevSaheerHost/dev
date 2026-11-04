/**
 * Authentication.
 *
 * Email and password through Firebase Auth. The signed-in uid is the only key
 * that reaches a document path, and the security rules refuse every read and
 * write where `request.auth.uid` does not match that path — so a session is
 * what scopes the data, not anything the client chooses to send.
 *
 * Error text is deliberately vague about whether an account exists. Firebase
 * itself returns a single `auth/invalid-credential` for a wrong password and an
 * unknown address; this layer does not undo that by guessing.
 */

import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { getAuthClient, isCloudConfigured, requireAuth } from '@/data/client';
import { ensureProfile, normaliseDisplayName } from '@/data/profile';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn' | 'unconfigured';

export interface AuthState {
  readonly status: AuthStatus;
  readonly uid: string | null;
  readonly email: string | null;
  readonly displayName: string;
  readonly signIn: (email: string, password: string) => Promise<void>;
  readonly signUp: (name: string, email: string, password: string) => Promise<void>;
  readonly signOut: () => Promise<void>;
  readonly resetPassword: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** The shortest password this app will create. Firebase's own floor is six. */
export const MIN_PASSWORD_LENGTH = 10;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateEmail(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return 'Enter your email address';
  if (trimmed.length > 254 || !EMAIL_PATTERN.test(trimmed)) return 'That does not look like an email address';
  return null;
}

/**
 * Length is the only requirement worth enforcing. Composition rules push people
 * towards `Password1!`, which is weaker than a long passphrase, so the check is
 * a floor on length plus a refusal of the handful of passwords everyone tries.
 */
export function validatePassword(value: string): string | null {
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (value.length > 128) return 'That password is too long';
  const lowered = value.toLowerCase();
  if (['password', '1234567890', 'qwertyuiop', 'passw0rd123'].includes(lowered)) {
    return 'Choose something harder to guess';
  }
  return null;
}

/** Maps a Firebase error code to something a person can act on. */
export function describeAuthError(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : '';

  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'That email and password do not match an account.';
    case 'auth/email-already-in-use':
      return 'An account already exists for that email address.';
    case 'auth/weak-password':
      return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    case 'auth/invalid-email':
      return 'That does not look like an email address.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes and try again.';
    case 'auth/network-request-failed':
      return 'No connection. Signing in needs the internet once; after that the ledger works offline.';
    case 'auth/operation-not-allowed':
      return 'Email sign-in is not enabled on this Firebase project yet.';
    case 'cloud-not-configured':
      return 'This build has no Firebase configuration, so there is nothing to sign in to.';
    default:
      return 'Could not complete that. Please try again.';
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(() =>
    isCloudConfigured() ? 'loading' : 'unconfigured',
  );
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const auth = getAuthClient();
    if (!auth) return;

    return onAuthStateChanged(
      auth,
      (next) => {
        setUser(next);
        setStatus(next ? 'signedIn' : 'signedOut');
        if (next) {
          // The profile document is what a later migration keys off, so it is
          // created on first sign-in. A failure here must not block the app.
          void ensureProfile(next.uid, next.displayName ?? next.email ?? 'Me').catch((error) => {
            if (import.meta.env.DEV) console.error('[work-ledger] profile bootstrap failed', error);
          });
        }
      },
      () => setStatus('signedOut'),
    );
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(requireAuth(), email.trim(), password);
  }, []);

  const signUp = useCallback(async (name: string, email: string, password: string) => {
    const credential = await createUserWithEmailAndPassword(requireAuth(), email.trim(), password);
    const displayName = normaliseDisplayName(name);
    await updateProfile(credential.user, { displayName });
    await ensureProfile(credential.user.uid, displayName);
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(requireAuth());
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    await sendPasswordResetEmail(requireAuth(), email.trim());
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      status,
      uid: user?.uid ?? null,
      email: user?.email ?? null,
      displayName: user?.displayName ?? user?.email?.split('@')[0] ?? 'Me',
      signIn,
      signUp,
      signOut,
      resetPassword,
    }),
    [status, user, signIn, signUp, signOut, resetPassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

/** The uid, for code that only runs behind a signed-in guard. */
export function useUid(): string {
  const { uid } = useAuth();
  if (!uid) throw new Error('useUid used outside a signed-in view');
  return uid;
}
