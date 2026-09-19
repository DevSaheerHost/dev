import { useEffect, useState } from 'react';

import { Badge, Button, Card, CardHeader, Field, Select } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { isCloudConfigured } from '@/firebase/client';
import { MAX_FILE_BYTES, MAX_TEXT_BYTES, RETENTIONS } from '@/lib/constants';
import { formatBytes } from '@/lib/format';
import { isCameraSupported } from '@/qr/scanner';
import { canPaste } from '@/services/clipboard';
import { isWebRtcSupported } from '@/webrtc/peer';
import { useTheme, type ThemeChoice } from '@/hooks/useTheme';
import type { RetentionId } from '@/types';

export function SettingsPage({
  retention,
  onRetentionChange,
}: {
  retention: RetentionId;
  onRetentionChange: (value: RetentionId) => void;
}) {
  const { theme, setTheme } = useTheme();
  const { notify } = useToast();
  const [installable, setInstallable] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event);
      setInstallable(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const install = async () => {
    const prompt = installPrompt as (Event & { prompt?: () => Promise<void> }) | null;
    if (!prompt?.prompt) return;
    await prompt.prompt();
    setInstallable(false);
  };

  const capabilities: Array<{ label: string; available: boolean; note: string }> = [
    { label: 'Cloud sync', available: isCloudConfigured(), note: 'Save & Sync between browsers' },
    { label: 'Camera', available: isCameraSupported(), note: 'Scanning QR frames' },
    { label: 'Direct connection', available: isWebRtcSupported(), note: 'Browser-to-browser transfer' },
    { label: 'Clipboard read', available: canPaste(), note: 'The Paste button' },
    { label: 'Local database', available: typeof indexedDB !== 'undefined', note: 'Offline history and queue' },
    { label: 'Web Crypto', available: Boolean(globalThis.crypto?.subtle), note: 'Private workspaces and checksums' },
  ];

  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader title="Preferences" description="Stored on this device only." />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Theme" htmlFor="theme">
            <Select id="theme" value={theme} onChange={(event) => setTheme(event.target.value as ThemeChoice)}>
              <option value="system">Match my device</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </Select>
          </Field>

          <Field label="Default retention" htmlFor="default-retention" hint="Applied to new items.">
            <Select
              id="default-retention"
              value={retention}
              onChange={(event) => onRetentionChange(event.target.value as RetentionId)}
            >
              {RETENTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Install"
          description="TransferBox runs as an installed app, and keeps working offline."
        />
        <div className="grid gap-3 p-5">
          <p className="text-[13.5px] leading-relaxed text-ink-2">
            Installed or not, cached history stays readable without a connection, and anything you
            save while offline is queued and uploaded when the connection returns.
          </p>
          {installable ? (
            <Button variant="primary" className="justify-self-start" onClick={() => void install()}>
              Install app
            </Button>
          ) : (
            <p className="text-[12.5px] text-ink-3">
              Use your browser’s “Install app” or “Add to Home Screen” option. Some browsers only
              offer it after a second visit.
            </p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="What this browser supports" description="Missing features degrade, they never block the app." />
        <ul className="divide-y divide-line">
          {capabilities.map((capability) => (
            <li key={capability.label} className="flex items-center gap-3 px-5 py-3">
              <Badge tone={capability.available ? 'good' : 'warn'}>
                {capability.available ? 'Available' : 'Unavailable'}
              </Badge>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium text-ink">{capability.label}</p>
                <p className="text-[12px] text-ink-3">{capability.note}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Limits" description="Raising these is a configuration change, not a rewrite." />
        <div className="grid gap-2 p-5 text-[13.5px] text-ink-2">
          <p>Maximum file size: {formatBytes(MAX_FILE_BYTES)}</p>
          <p>Maximum text size: {formatBytes(MAX_TEXT_BYTES)}</p>
          <p className="text-[12.5px] text-ink-3">
            Expired items disappear from every browser and are deleted when any browser notices
            them. A scheduled cleanup job on the backend is still recommended for items nobody
            revisits — see the README.
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="mt-2 justify-self-start"
            onClick={() => notify('TransferBox stores nothing about you: no account, no analytics.', 'info')}
          >
            What is stored about me?
          </Button>
        </div>
      </Card>
    </div>
  );
}
