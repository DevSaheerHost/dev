/**
 * Settings.
 *
 * Deliberately short: a name, a theme, a sign-out, and a plain explanation of
 * where the data lives. The explanation is not filler — a user who does not
 * know whether an offline entry was saved will stop trusting the app, and a
 * user who does not know the data is tied to their account will not know what
 * happens if they lose the phone.
 */

import { useState } from 'react';
import { Check, LogOut, Moon, ShieldCheck, Smartphone, Sun, SunMoon } from 'lucide-react';

import { Banner, Button, Card, SectionHeading, TextInput } from '@/components/ui';
import { updateDisplayName } from '@/data/profile';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTheme, type ThemeChoice } from '@/hooks/useTheme';

const THEME_OPTIONS: readonly { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'System', icon: SunMoon },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

export function SettingsPage() {
  const { uid, email, displayName, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const [name, setName] = useState(displayName);
  const [status, setStatus] = useState<'idle' | 'saved' | 'failed'>('idle');

  function saveName() {
    if (!uid || name.trim() === '' || name === displayName) return;
    try {
      // Saved to the device straight away; it syncs when there is a connection.
      updateDisplayName(uid, name);
      setStatus('saved');
    } catch {
      setStatus('failed');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-bold text-ink">Settings</h1>
        <p className="mt-0.5 truncate text-sm text-ink-2">{email ?? 'Signed in'}</p>
      </header>

      <section>
        <SectionHeading title="Your name" />
        <Card className="p-4">
          <TextInput
            label="Display name"
            value={name}
            onChange={(value) => {
              setName(value);
              setStatus('idle');
            }}
            maxLength={60}
            hint="Used on the statements you hand to a shop owner."
          />
          <div className="mt-3 flex items-center gap-3">
            <Button
              onClick={saveName}
              disabled={name.trim() === '' || name === displayName}
            >
              Save
            </Button>
            {status === 'saved' ? (
              <span className="flex items-center gap-1.5 text-sm text-credit">
                <Check size={15} />
                Saved
              </span>
            ) : null}
            {status === 'failed' ? (
              <span className="text-sm text-danger">Could not save — try again.</span>
            ) : null}
          </div>
        </Card>
      </section>

      <section>
        <SectionHeading title="Appearance" />
        <Card className="p-4">
          <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={theme === option.value}
                onClick={() => setTheme(option.value)}
                className={`flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold transition-colors ${
                  theme === option.value
                    ? 'border-accent bg-accent-soft text-accent-ink'
                    : 'border-line-strong text-ink-2 hover:bg-surface-2'
                }`}
              >
                <option.icon size={18} />
                {option.label}
              </button>
            ))}
          </div>
        </Card>
      </section>

      <section>
        <SectionHeading title="How this works" />
        <Card className="divide-y divide-line">
          <div className="flex gap-3 p-4">
            <Smartphone size={17} className="mt-0.5 shrink-0 text-ink-3" />
            <div>
              <p className="text-sm font-semibold text-ink">Entries save on this device first</p>
              <p className="mt-0.5 text-sm text-ink-2">
                You can add an entry with no signal. It is stored here immediately and uploaded
                the next time you have a connection, so nothing waits on the network.
              </p>
            </div>
          </div>
          <div className="flex gap-3 p-4">
            <ShieldCheck size={17} className="mt-0.5 shrink-0 text-ink-3" />
            <div>
              <p className="text-sm font-semibold text-ink">Your ledger is yours alone</p>
              <p className="mt-0.5 text-sm text-ink-2">
                Every record is stored under your account and the server refuses any request for
                another account's data. Nothing is ever deleted: shops are archived and entries
                are voided, so a past balance can always be explained.
              </p>
            </div>
          </div>
        </Card>
      </section>

      <section>
        <SectionHeading title="Account" />
        <Card className="p-4">
          <Banner tone="neutral">
            Signing out needs a connection to sign back in. Your entries stay on the device.
          </Banner>
          <div className="mt-3">
            <Button tone="danger" onClick={() => void signOut()}>
              <LogOut size={15} />
              Sign out
            </Button>
          </div>
        </Card>
      </section>

      <p className="pb-2 text-center text-xs text-ink-3">
        My Work Ledger &middot; Phase 1 of 7 &mdash; shops and accounts. Transactions, settlements
        and reports are still to come.
      </p>
    </div>
  );
}
