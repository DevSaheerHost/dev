/**
 * Workspace management: create, share, join, switch, forget.
 *
 * The share QR and link carry the secret in the URL fragment. Fragments are
 * never sent to a server, and the secret is not rendered anywhere it could be
 * copied by accident — it is revealed only on request.
 */

import { useEffect, useRef, useState } from 'react';

import { useToast } from '@/components/Toast';
import { Badge, Button, Card, CardHeader, Field, Spinner, cx } from '@/components/ui';
import { messageFor } from '@/lib/errors';
import { renderQr } from '@/qr/render';
import { isCameraSupported, startScanner, type ScannerHandle } from '@/qr/scanner';
import { copyText } from '@/services/clipboard';
import { buildShareLink, useWorkspace } from '@/stores/workspace';
import { formatRelative } from '@/lib/format';

export function WorkspacePage({ joinSecret }: { joinSecret?: string }) {
  const { workspace, known, createPrivate, join, switchTo, forget, switchToPublic } = useWorkspace();
  const { notify } = useToast();
  const [qr, setQr] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [manualSecret, setManualSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const scanner = useRef<ScannerHandle | null>(null);
  const consumedJoin = useRef<string | null>(null);
  const [shownWorkspace, setShownWorkspace] = useState(workspace.id);

  /* A different workspace means a different link: re-hide it during render. */
  if (shownWorkspace !== workspace.id) {
    setShownWorkspace(workspace.id);
    setRevealed(false);
    setQr(null);
  }

  /* Honour a join link the moment it appears in the URL. */
  useEffect(() => {
    if (!joinSecret || consumedJoin.current === joinSecret) return;
    consumedJoin.current = joinSecret;
    const run = async () => {
      try {
        await join(joinSecret);
        notify('Joined the private workspace.', 'success');
        // Remove the secret from the address bar once it has been stored.
        window.history.replaceState(null, '', `${window.location.pathname}#/workspace`);
      } catch (joinError) {
        setError(messageFor(joinError));
      }
    };
    void run();
  }, [joinSecret, join, notify]);

  /* Keep the share QR in step with the active workspace. */
  useEffect(() => {
    if (workspace.kind !== 'private') return;
    let cancelled = false;
    void renderQr(buildShareLink(workspace))
      .then((url) => {
        if (!cancelled) setQr(url);
      })
      .catch(() => setQr(null));
    return () => {
      cancelled = true;
    };
  }, [workspace]);

  useEffect(() => () => scanner.current?.stop(), []);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await createPrivate();
      notify('Private workspace created on this device.', 'success');
    } catch (createError) {
      setError(messageFor(createError));
    } finally {
      setBusy(false);
    }
  };

  const joinManually = async () => {
    setError(null);
    const value = extractSecret(manualSecret);
    if (!value) {
      setError('Paste the full workspace link, or the secret from it.');
      return;
    }
    try {
      await join(value);
      setManualSecret('');
      notify('Joined the private workspace.', 'success');
    } catch (joinError) {
      setError(messageFor(joinError));
    }
  };

  const toggleScan = async () => {
    if (scanning) {
      scanner.current?.stop();
      scanner.current = null;
      setScanning(false);
      return;
    }
    setError(null);
    if (!video.current) return;
    try {
      scanner.current = await startScanner(
        video.current,
        (value) => {
          const secret = extractSecret(value);
          if (!secret) return;
          scanner.current?.stop();
          scanner.current = null;
          setScanning(false);
          void join(secret)
            .then(() => notify('Joined the private workspace.', 'success'))
            .catch((joinError) => setError(messageFor(joinError)));
        },
        (scanError) => setError(messageFor(scanError)),
      );
      setScanning(true);
    } catch (startError) {
      setError(messageFor(startError));
    }
  };

  const shareLink = workspace.kind === 'private' ? buildShareLink(workspace) : '';

  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader
          title="Current workspace"
          description="Everything you save goes to the workspace selected here."
          action={
            workspace.kind === 'public' ? (
              <Badge tone="warn">Public</Badge>
            ) : (
              <Badge tone="good">Private</Badge>
            )
          }
        />

        <div className="grid gap-4 p-5">
          {workspace.kind === 'public' ? (
            <>
              <p className="text-[13.5px] leading-relaxed text-ink-2">
                You are using the public workspace. It needs no setup and works instantly on any
                browser, but <strong className="font-semibold text-ink">anyone using it can see what you share</strong>.
                Use it for convenience, not for anything sensitive.
              </p>
              <Button variant="primary" busy={busy} onClick={() => void create()} className="justify-self-start">
                Create private workspace
              </Button>
            </>
          ) : (
            <div className="grid gap-5 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
              <div className="mx-auto w-full max-w-56">
                <div className="aspect-square overflow-hidden rounded-2xl border border-line bg-white p-3">
                  {qr ? (
                    <img src={qr} alt="Workspace share QR code" className="size-full object-contain" />
                  ) : (
                    <div className="grid size-full place-items-center">
                      <Spinner className="size-5" />
                    </div>
                  )}
                </div>
                <p className="mt-2 text-center text-[12px] text-ink-3">Scan to join this workspace</p>
              </div>

              <div className="grid content-start gap-3">
                <div>
                  <p className="text-[12.5px] text-ink-3">Workspace</p>
                  <p className="font-mono text-lg font-semibold text-ink">{workspace.label}</p>
                </div>

                <p className="text-[13px] leading-relaxed text-ink-2">
                  Anything saved here is encrypted on this device before it is uploaded. The server
                  stores ciphertext under an unguessable identifier and never sees the key.
                </p>

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      void copyText(shareLink)
                        .then(() => notify('Share link copied. Treat it like a password.', 'success'))
                        .catch((copyError) => notify(messageFor(copyError), 'error'));
                    }}
                  >
                    Copy share link
                  </Button>
                  <Button size="sm" onClick={() => setRevealed((value) => !value)}>
                    {revealed ? 'Hide link' : 'Show link'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={switchToPublic}>
                    Switch to public
                  </Button>
                </div>

                {revealed && (
                  <p className="break-all rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 font-mono text-[11.5px] text-ink-2">
                    {shareLink}
                  </p>
                )}

                <p className="text-[12px] leading-relaxed text-ink-3">
                  Anyone holding this link has full access to the workspace. There is no recovery if
                  you lose it — nothing on the server can rebuild it.
                </p>
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Join a workspace" description="Scan a share QR, or paste a link someone sent you." />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <div className="grid content-start gap-3">
            <Field label="Workspace link or secret" htmlFor="join-secret">
              <input
                id="join-secret"
                value={manualSecret}
                onChange={(event) => setManualSecret(event.target.value)}
                placeholder="https://…/#/workspace?join=…"
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 font-mono text-[12.5px] text-ink focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
              />
            </Field>
            <Button onClick={() => void joinManually()} className="justify-self-start">
              Join workspace
            </Button>
          </div>

          <div className="grid content-start gap-3">
            {isCameraSupported() ? (
              <>
                <div className={cx('aspect-video overflow-hidden rounded-xl border border-line bg-bg-soft', !scanning && 'grid place-items-center')}>
                  <video ref={video} muted playsInline className={cx('size-full object-cover', !scanning && 'hidden')} />
                  {!scanning && <span className="text-[12.5px] text-ink-3">Camera is off</span>}
                </div>
                <Button onClick={() => void toggleScan()} className="justify-self-start">
                  {scanning ? 'Stop camera' : 'Scan share QR'}
                </Button>
              </>
            ) : (
              <p className="text-[13px] text-ink-3">
                This browser cannot use a camera, so paste the link instead.
              </p>
            )}
          </div>
        </div>

        {error && (
          <p role="alert" className="mx-5 mb-5 rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger">
            {error}
          </p>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Workspaces on this device"
          description="Secrets are stored in this browser only. Forgetting one removes it from here, not from other browsers."
        />
        <ul className="divide-y divide-line">
          <li className="flex flex-wrap items-center gap-3 px-5 py-3.5">
            <Badge tone="warn">Public</Badge>
            <span className="min-w-0 flex-1 text-[13.5px] text-ink">Public workspace</span>
            <Button size="sm" variant="ghost" onClick={switchToPublic} disabled={workspace.kind === 'public'}>
              {workspace.kind === 'public' ? 'In use' : 'Switch'}
            </Button>
          </li>

          {known
            .filter((entry) => entry.kind === 'private')
            .map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <Badge tone="good">Private</Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-ink">{entry.label}</p>
                  <p className="text-[12px] text-ink-3">Last used {formatRelative(entry.lastUsedAt)}</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void switchTo(entry.id)}
                  disabled={workspace.id === entry.id}
                >
                  {workspace.id === entry.id ? 'In use' : 'Switch'}
                </Button>
                <Button size="sm" variant="danger" onClick={() => void forget(entry.id)}>
                  Forget
                </Button>
              </li>
            ))}
        </ul>
      </Card>
    </div>
  );
}

/** Accept a full share link, a bare secret, or a QR payload of either. */
function extractSecret(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/join=([A-Za-z0-9_-]{22,88})/);
  if (match?.[1]) return match[1];
  return /^[A-Za-z0-9_-]{22,88}$/.test(trimmed) ? trimmed : null;
}
