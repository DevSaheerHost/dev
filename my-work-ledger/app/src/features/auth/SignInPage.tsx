/**
 * The sign-in screen.
 *
 * One form, three modes. Validation runs before the network call so a typo
 * costs nothing, and the submit button is disabled while a request is in flight
 * to stop a double sign-up creating two accounts.
 */

import { useState } from 'react';
import { BookLock, Loader2 } from 'lucide-react';

import { Banner, Button, TextInput } from '@/components/ui';

import {
  describeAuthError,
  useAuth,
  validateEmail,
  validatePassword,
} from './AuthProvider';

type Mode = 'signIn' | 'signUp' | 'reset';

const COPY: Record<Mode, { title: string; action: string; hint: string }> = {
  signIn: { title: 'Welcome back', action: 'Sign in', hint: 'Your ledger is waiting.' },
  signUp: {
    title: 'Create your ledger',
    action: 'Create account',
    hint: 'One account holds every shop you work at.',
  },
  reset: {
    title: 'Reset your password',
    action: 'Send reset link',
    hint: 'We will email you a link to set a new password.',
  },
};

export function SignInPage() {
  const { status, signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState<Mode>('signIn');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const copy = COPY[mode];

  function switchMode(next: Mode) {
    setMode(next);
    setErrors({});
    setFormError(null);
    setNotice(null);
    if (next !== 'signUp') setName('');
    if (next === 'reset') setPassword('');
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    const nextErrors: typeof errors = {};
    const emailError = validateEmail(email);
    if (emailError) nextErrors.email = emailError;

    if (mode === 'signUp') {
      if (name.trim() === '') nextErrors.name = 'What should the ledger call you?';
      const passwordError = validatePassword(password);
      if (passwordError) nextErrors.password = passwordError;
    } else if (mode === 'signIn' && password === '') {
      nextErrors.password = 'Enter your password';
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setBusy(true);
    setFormError(null);
    setNotice(null);
    try {
      if (mode === 'signIn') await signIn(email, password);
      else if (mode === 'signUp') await signUp(name, email, password);
      else {
        await resetPassword(email);
        setNotice('If that address has an account, a reset link is on its way.');
      }
    } catch (error) {
      setFormError(describeAuthError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center text-center">
          <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-accent text-accent-contrast">
            <BookLock size={22} />
          </span>
          <h1 className="text-xl font-bold text-ink">My Work Ledger</h1>
          <p className="mt-1 text-sm text-ink-2">
            Salary, allowances and shop expenses across every shop you work at.
          </p>
        </div>

        <form
          onSubmit={submit}
          className="rounded-2xl border border-line bg-surface p-5 shadow-card"
        >
          <h2 className="text-base font-semibold text-ink">{copy.title}</h2>
          <p className="mt-0.5 mb-4 text-sm text-ink-3">{copy.hint}</p>

          {status === 'unconfigured' ? (
            <Banner tone="debit" title="No backend configured">
              This build has no Firebase configuration, so accounts cannot be created. Copy
              <code className="mx-1 font-mono text-xs">.env.example</code>
              to <code className="mx-1 font-mono text-xs">.env.local</code>, fill in the project
              values and rebuild.
            </Banner>
          ) : (
            <div className="flex flex-col gap-4">
              {mode === 'signUp' ? (
                <TextInput
                  label="Your name"
                  value={name}
                  onChange={setName}
                  autoComplete="name"
                  maxLength={60}
                  error={errors.name}
                />
              ) : null}

              <TextInput
                label="Email"
                type="email"
                value={email}
                onChange={setEmail}
                autoComplete="email"
                inputMode="email"
                maxLength={254}
                error={errors.email}
              />

              {mode === 'reset' ? null : (
                <TextInput
                  label="Password"
                  type="password"
                  value={password}
                  onChange={setPassword}
                  autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
                  maxLength={128}
                  error={errors.password}
                  hint={mode === 'signUp' ? 'At least 10 characters.' : undefined}
                />
              )}

              {formError ? (
                <Banner tone="danger">{formError}</Banner>
              ) : notice ? (
                <Banner tone="accent">{notice}</Banner>
              ) : null}

              <Button type="submit" tone="primary" fullWidth disabled={busy}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                {busy ? 'Working…' : copy.action}
              </Button>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
            {mode === 'signIn' ? (
              <>
                <button
                  type="button"
                  onClick={() => switchMode('signUp')}
                  className="-mx-2 inline-flex min-h-11 items-center px-2 font-semibold text-accent-ink hover:underline"
                >
                  Create an account
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('reset')}
                  className="-mx-2 inline-flex min-h-11 items-center px-2 text-ink-3 hover:underline"
                >
                  Forgot password?
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => switchMode('signIn')}
                className="-mx-2 inline-flex min-h-11 items-center px-2 font-semibold text-accent-ink hover:underline"
              >
                Back to sign in
              </button>
            )}
          </div>
        </form>

        <p className="mt-5 text-center text-xs leading-relaxed text-ink-3">
          Your ledger is private to your account. Entries are stored on this device first, so the
          app keeps working without a signal.
        </p>
      </div>
    </main>
  );
}
