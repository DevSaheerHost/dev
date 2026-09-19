/**
 * Direct transfer panel.
 *
 * One browser hosts a pairing code, the other joins it. Once the channel opens,
 * bytes go browser to browser; the coordination record in the database is
 * deleted as soon as the session ends.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { messageFor } from '@/lib/errors';
import { formatBytes } from '@/lib/format';
import { renderQr } from '@/qr/render';
import { isWebRtcSupported, newPairCode, PeerSession, type PeerPhase, type TransferMeta } from '@/webrtc/peer';
import { copyText } from '@/services/clipboard';
import { isCloudConfigured } from '@/firebase/client';
import { useToast } from './Toast';
import { Badge, Button, Card, CardHeader, Field, ProgressBar, cx } from './ui';
import type { Progress } from '@/types';

const PHASE_LABEL: Record<PeerPhase, string> = {
  idle: 'Not connected',
  waiting: 'Waiting for the other browser',
  connecting: 'Connecting',
  connected: 'Connected',
  transferring: 'Transferring',
  done: 'Finished',
  failed: 'Connection failed',
};

const PHASE_TONE: Record<PeerPhase, 'neutral' | 'accent' | 'good' | 'danger'> = {
  idle: 'neutral',
  waiting: 'accent',
  connecting: 'accent',
  connected: 'good',
  transferring: 'accent',
  done: 'good',
  failed: 'danger',
};

export function DirectTransfer({ getText, file }: { getText: () => string; file: File | null }) {
  const { notify } = useToast();
  const session = useRef<PeerSession | null>(null);
  const [mode, setMode] = useState<'idle' | 'host' | 'join'>('idle');
  const [code, setCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [phase, setPhase] = useState<PeerPhase>('idle');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [received, setReceived] = useState<{ url: string; meta: TransferMeta; verified: boolean } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const teardown = useCallback(() => {
    session.current?.close();
    session.current = null;
    setMode('idle');
    setPhase('idle');
    setProgress(null);
    setQr(null);
    setCode('');
  }, []);

  useEffect(
    () => () => {
      session.current?.close();
      session.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!received) return;
    return () => URL.revokeObjectURL(received.url);
  }, [received]);

  const events = useCallback(
    () => ({
      onPhase: (next: PeerPhase) => setPhase(next),
      onProgress: (next: Progress) => setProgress(next),
      onReceived: (blob: Blob, meta: TransferMeta, verified: boolean) => {
        setReceived({ url: URL.createObjectURL(blob), meta, verified });
        notify(
          verified ? 'Received and integrity verified.' : 'Received, but verification failed.',
          verified ? 'success' : 'error',
        );
      },
      onError: (peerError: Error) => setError(messageFor(peerError)),
    }),
    [notify],
  );

  const host = async () => {
    setError(null);
    const pairCode = newPairCode();
    setCode(pairCode);
    setMode('host');
    const peer = new PeerSession(pairCode, events());
    session.current = peer;
    try {
      await peer.host();
      setQr(await renderQr(pairCode));
    } catch (hostError) {
      setError(messageFor(hostError));
      setMode('idle');
    }
  };

  const join = async () => {
    setError(null);
    const value = joinCode.trim().toUpperCase();
    if (value.length < 4) {
      setError('Enter the code shown on the other browser.');
      return;
    }
    setMode('join');
    const peer = new PeerSession(value, events());
    session.current = peer;
    try {
      await peer.join();
    } catch (joinError) {
      setError(messageFor(joinError));
      setMode('idle');
    }
  };

  const send = async () => {
    const peer = session.current;
    if (!peer?.ready) {
      setError('The channel is not open yet. Wait for "Connected".');
      return;
    }
    setError(null);
    try {
      if (file) {
        await peer.send(file, {
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          kind: 'file',
        });
      } else {
        const text = getText();
        if (!text.trim()) {
          setError('There is nothing in the composer to send.');
          return;
        }
        const blob = new Blob([text], { type: 'text/plain' });
        await peer.send(blob, {
          name: 'text.txt',
          mimeType: 'text/plain',
          size: blob.size,
          kind: 'text',
        });
      }
      notify('Sent directly to the other browser.', 'success');
    } catch (sendError) {
      setError(messageFor(sendError));
    }
  };

  if (!isWebRtcSupported()) {
    return (
      <Card className="px-6 py-8 text-center text-[13.5px] text-ink-3">
        This browser does not support direct connections. Use Save &amp; Sync or QR Transfer instead.
      </Card>
    );
  }

  if (!isCloudConfigured()) {
    return (
      <Card className="px-6 py-8 text-center text-[13.5px] text-ink-3">
        Pairing needs the cloud coordination layer, which is not configured in this build. QR
        Transfer works entirely offline and needs nothing.
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Direct transfer"
        description="Bytes travel straight between the two browsers. Only the pairing handshake goes through the cloud."
        action={
          <Badge tone={PHASE_TONE[phase]}>
            {PHASE_LABEL[phase]}
          </Badge>
        }
      />

      <div className="grid gap-5 p-5">
        {mode === 'idle' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid content-start gap-3 rounded-xl border border-line bg-surface-2 p-4">
              <h3 className="text-[14px] font-semibold text-ink">Start here</h3>
              <p className="text-[13px] leading-relaxed text-ink-3">
                Creates a pairing code and a QR for the other browser to scan or type.
              </p>
              <Button variant="primary" onClick={() => void host()}>
                Create pairing code
              </Button>
            </div>

            <div className="grid content-start gap-3 rounded-xl border border-line bg-surface-2 p-4">
              <h3 className="text-[14px] font-semibold text-ink">Join the other browser</h3>
              <Field label="Pairing code" htmlFor="pair-code">
                <input
                  id="pair-code"
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                  maxLength={16}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="ABCD2345"
                  className="w-full rounded-xl border border-line bg-surface px-3 py-2 font-mono text-[15px] tracking-[0.18em] text-ink focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
                />
              </Field>
              <Button onClick={() => void join()}>Connect</Button>
            </div>
          </div>
        )}

        {mode === 'host' && (
          <div className="grid gap-4 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)] sm:items-center">
            <div className="mx-auto w-full max-w-56">
              <div className="aspect-square overflow-hidden rounded-2xl border border-line bg-white p-3">
                {qr && <img src={qr} alt="Pairing QR code" className="size-full object-contain" />}
              </div>
            </div>
            <div className="grid gap-3">
              <div>
                <p className="text-[12.5px] text-ink-3">Pairing code</p>
                <p className="font-mono text-2xl font-semibold tracking-[0.2em] text-ink">{code}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    void copyText(code)
                      .then(() => notify('Code copied.', 'success'))
                      .catch((copyError) => notify(messageFor(copyError), 'error'));
                  }}
                >
                  Copy code
                </Button>
                <Button size="sm" variant="ghost" onClick={teardown}>
                  Cancel
                </Button>
              </div>
              <p className="text-[12.5px] leading-relaxed text-ink-3">
                Enter this on the other browser under Direct Transfer. The code stops working when
                you leave this screen.
              </p>
            </div>
          </div>
        )}

        {mode === 'join' && (
          <p className="text-[13.5px] text-ink-2">
            Connecting to <span className="font-mono">{joinCode}</span>…
          </p>
        )}

        {mode !== 'idle' && (
          <div className="grid gap-3 border-t border-line pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13px] text-ink-2">
                {file ? `Ready to send ${file.name} (${formatBytes(file.size)})` : 'Ready to send the composer text'}
              </p>
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => void send()} disabled={phase !== 'connected' && phase !== 'done'}>
                  Send
                </Button>
                <Button variant="ghost" onClick={teardown}>
                  Disconnect
                </Button>
              </div>
            </div>

            {progress && progress.total > 0 && (
              <ProgressBar value={progress.loaded / progress.total} label="Transfer" />
            )}
          </div>
        )}

        {received && (
          <div
            className={cx(
              'grid gap-2 rounded-xl border px-4 py-3',
              received.verified ? 'border-good/25 bg-good-soft' : 'border-danger/25 bg-danger-soft',
            )}
          >
            <p className={cx('text-[13.5px] font-semibold', received.verified ? 'text-good' : 'text-danger')}>
              {received.verified
                ? 'Transfer complete. Integrity verified.'
                : 'Transfer completed but integrity verification failed.'}
            </p>
            <p className="text-[12.5px] text-ink-2">
              {received.meta.name} · {formatBytes(received.meta.size)}
            </p>
            <a
              href={received.url}
              download={received.meta.name}
              rel="noopener"
              className="justify-self-start rounded-xl border border-line bg-surface px-4 py-2 text-[13px] font-medium text-ink hover:border-accent"
            >
              Save file
            </a>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger">
            {error}
          </p>
        )}
      </div>
    </Card>
  );
}
