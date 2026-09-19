/**
 * QR transfer, both directions.
 *
 * Sending: the payload is chunked by the TBX1 protocol and the frames are
 * played as a sequence, with manual stepping for anything the receiver missed.
 * Receiving: the camera feeds every decoded frame into a QrReceiver, which
 * tracks what is still missing and verifies the SHA-256 before handing back the
 * reconstructed text.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { QR_CHUNK_BYTES, QR_FRAME_INTERVAL_MS } from '@/lib/constants';
import { messageFor } from '@/lib/errors';
import { formatBytes } from '@/lib/format';
import {
  QrReceiver,
  createTextTransfer,
  type QrTransfer as QrTransferData,
  type ReceiverState,
} from '@/qr/protocol';
import { renderQr } from '@/qr/render';
import { isCameraSupported, startScanner, type ScannerHandle } from '@/qr/scanner';
import { copyText } from '@/services/clipboard';
import { useToast } from './Toast';
import { Badge, Button, Card, CardHeader, ProgressBar, Spinner, cx } from './ui';

/** Above this many frames, an individual button per frame stops being useful. */
const GRID_LIMIT = 60;

/* ------------------------------------------------------------- sending ---- */

export function QrSender({ text }: { text: string }) {
  const { notify } = useToast();
  const [transfer, setTransfer] = useState<QrTransferData | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState(text);

  /* A new payload invalidates the current sequence, adjusted during render. */
  if (source !== text) {
    setSource(text);
    setTransfer(null);
    setFrameIndex(0);
    setError(null);
  }

  /* Build the frame sequence whenever the payload changes. */
  useEffect(() => {
    if (!text.trim()) return;
    let cancelled = false;

    createTextTransfer(text, QR_CHUNK_BYTES)
      .then((next) => {
        if (!cancelled) setTransfer(next);
      })
      .catch((buildError: unknown) => {
        if (!cancelled) setError(messageFor(buildError));
      });

    return () => {
      cancelled = true;
    };
  }, [text]);

  /* Render the visible frame. */
  useEffect(() => {
    const frame = transfer?.frames[frameIndex];
    if (!frame) return;
    let cancelled = false;
    void renderQr(frame)
      .then((url) => {
        if (!cancelled) setImage(url);
      })
      .catch((renderError) => {
        if (!cancelled) setError(messageFor(renderError));
      });
    return () => {
      cancelled = true;
    };
  }, [transfer, frameIndex]);

  /* Auto-play. */
  useEffect(() => {
    if (!transfer || !playing || transfer.total <= 1) return;
    const timer = window.setInterval(() => {
      setFrameIndex((index) => (index + 1) % transfer.total);
    }, QR_FRAME_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [transfer, playing]);

  if (text.trim() && !transfer && !error) {
    return (
      <Card className="grid place-items-center gap-3 px-6 py-14 text-[13.5px] text-ink-3">
        <Spinner className="size-5" />
        Preparing frames…
      </Card>
    );
  }

  if (!text.trim()) {
    return (
      <Card className="px-6 py-12 text-center text-[13.5px] text-ink-3">
        Add some text on the Home screen first, then come back to show it as QR codes.
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="px-6 py-8 text-center text-[13.5px] text-danger" role="alert">
        {error}
      </Card>
    );
  }

  if (!transfer) return null;

  return (
    <Card>
      <CardHeader
        title="Show these to the other browser"
        description={`${transfer.total} QR frame${transfer.total === 1 ? '' : 's'} · ${formatBytes(transfer.byteLength)} · transfer ${transfer.transferId}`}
        action={<Badge tone="accent">Frame {frameIndex + 1} of {transfer.total}</Badge>}
      />

      <div className="grid gap-5 p-5 sm:grid-cols-[minmax(0,320px)_minmax(0,1fr)] sm:items-start">
        <div className="mx-auto w-full max-w-80">
          <div className="aspect-square overflow-hidden rounded-2xl border border-line bg-white p-3">
            {image ? (
              <img src={image} alt={`QR frame ${frameIndex + 1} of ${transfer.total}`} className="size-full object-contain" />
            ) : (
              <div className="grid size-full place-items-center text-ink-3">
                <Spinner className="size-5" />
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <Button
              size="sm"
              onClick={() => setFrameIndex((index) => (index - 1 + transfer.total) % transfer.total)}
              aria-label="Previous frame"
            >
              Previous
            </Button>
            <Button size="sm" variant="primary" onClick={() => setPlaying((value) => !value)}>
              {playing ? 'Pause' : 'Play'}
            </Button>
            <Button
              size="sm"
              onClick={() => setFrameIndex((index) => (index + 1) % transfer.total)}
              aria-label="Next frame"
            >
              Next
            </Button>
          </div>

          <div className="mt-3">
            <ProgressBar value={(frameIndex + 1) / transfer.total} label="Sequence position" />
          </div>
        </div>

        <div className="grid gap-4">
          <ol className="grid gap-2 text-[13.5px] leading-relaxed text-ink-2">
            <li>1. On the other browser, open Transfer and choose Scan.</li>
            <li>2. Point it at this screen and let the sequence play.</li>
            <li>3. It will tell you which frames are still missing — use Previous and Next to show those again.</li>
          </ol>

          {transfer.total > GRID_LIMIT && (
            <p className="rounded-xl border border-warn/25 bg-warn-soft px-3.5 py-2.5 text-[12.5px] leading-relaxed text-warn">
              {transfer.total} frames is a long sequence to scan. For a payload this size, Save
              &amp; Sync or Direct Transfer will be far quicker — QR is best for smaller amounts of
              text, or when the two browsers share no network at all.
            </p>
          )}

          <div className="grid gap-2">
            <p className="text-[12.5px] font-medium text-ink-2">Jump to a frame</p>
            {transfer.total <= GRID_LIMIT ? (
              <div className="flex flex-wrap gap-1">
                {transfer.frames.map((_, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => {
                      setPlaying(false);
                      setFrameIndex(index);
                    }}
                    aria-label={`Show frame ${index + 1}`}
                    aria-current={index === frameIndex ? 'true' : undefined}
                    className={cx(
                      'size-7 rounded-md border font-mono text-[11px] tabular-nums transition-colors',
                      index === frameIndex
                        ? 'border-accent bg-accent text-accent-contrast'
                        : 'border-line bg-surface-2 text-ink-3 hover:border-accent hover:text-ink',
                    )}
                  >
                    {index + 1}
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="frame-jump" className="sr-only">
                  Frame number
                </label>
                <input
                  id="frame-jump"
                  type="number"
                  min={1}
                  max={transfer.total}
                  value={frameIndex + 1}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (!Number.isFinite(next)) return;
                    setPlaying(false);
                    setFrameIndex(Math.min(transfer.total, Math.max(1, Math.round(next))) - 1);
                  }}
                  className="w-24 rounded-xl border border-line bg-surface-2 px-3 py-2 font-mono text-[13px] tabular-nums text-ink focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
                />
                <span className="text-[12.5px] text-ink-3">of {transfer.total}</span>
                <Button size="sm" onClick={() => setFrameIndex((index) => Math.max(0, index - 10))}>
                  −10
                </Button>
                <Button
                  size="sm"
                  onClick={() => setFrameIndex((index) => Math.min(transfer.total - 1, index + 10))}
                >
                  +10
                </Button>
              </div>
            )}
            <p className="text-[12px] text-ink-3">
              The receiver lists any frames it is still missing — type the number here to show one
              again.
            </p>
          </div>

          <Button
            size="sm"
            variant="ghost"
            className="justify-self-start"
            onClick={() => {
              void copyText(transfer.checksum)
                .then(() => notify('Checksum copied.', 'success'))
                .catch((copyError) => notify(messageFor(copyError), 'error'));
            }}
          >
            Copy SHA-256 checksum
          </Button>
        </div>
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------- receiving ---- */

export function QrReceiverPanel({ onComplete }: { onComplete: (text: string) => void }) {
  const { notify } = useToast();
  const video = useRef<HTMLVideoElement>(null);
  const receiver = useRef(new QrReceiver());
  const handle = useRef<ScannerHandle | null>(null);
  const [scanning, setScanning] = useState(false);
  const [state, setState] = useState<ReceiverState>({
    transferId: '',
    total: 0,
    checksum: '',
    received: 0,
    missing: [],
    complete: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const stop = useCallback(() => {
    handle.current?.stop();
    handle.current = null;
    setScanning(false);
  }, []);

  useEffect(() => stop, [stop]);

  const finish = useCallback(async () => {
    try {
      const text = await receiver.current.finishText();
      setDone(true);
      stop();
      onComplete(text);
      notify('Transfer complete. Checksum verified.', 'success');
    } catch (finishError) {
      setError(messageFor(finishError));
    }
  }, [onComplete, notify, stop]);

  const start = useCallback(async () => {
    setError(null);
    setDone(false);
    if (!video.current) return;
    try {
      handle.current = await startScanner(
        video.current,
        (value) => {
          const outcome = receiver.current.accept(value);
          if (outcome.status === 'mismatch') {
            setError('Those frames belong to a different transfer. Reset and start again.');
            return;
          }
          if (outcome.status === 'ignored') return;
          setState(outcome.state);
          if (outcome.state.complete) void finish();
        },
        (scanError) => setError(messageFor(scanError)),
      );
      setScanning(true);
    } catch (startError) {
      setError(messageFor(startError));
    }
  }, [finish]);

  const reset = () => {
    receiver.current.reset();
    setState(receiver.current.state());
    setError(null);
    setDone(false);
  };

  if (!isCameraSupported()) {
    return (
      <Card className="px-6 py-8 text-center text-[13.5px] text-ink-3">
        This browser has no camera access, so QR codes cannot be scanned here. You can still show
        QR codes to another browser, or use Save &amp; Sync.
      </Card>
    );
  }

  const progress = state.total > 0 ? state.received / state.total : 0;

  return (
    <Card>
      <CardHeader
        title="Scan the other browser"
        description="Hold this browser steady in front of the playing sequence."
        action={
          state.total > 0 ? (
            <Badge tone={state.complete ? 'good' : 'accent'}>
              {state.received} of {state.total} frames
            </Badge>
          ) : undefined
        }
      />

      <div className="grid gap-5 p-5 sm:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div>
          <div className="aspect-square overflow-hidden rounded-2xl border border-line bg-bg-soft">
            <video ref={video} muted playsInline className="size-full object-cover" />
          </div>
          <div className="mt-3 flex gap-2">
            {scanning ? (
              <Button size="sm" block onClick={stop}>
                Stop camera
              </Button>
            ) : (
              <Button size="sm" variant="primary" block onClick={() => void start()}>
                Start camera
              </Button>
            )}
            <Button size="sm" onClick={reset}>
              Reset
            </Button>
          </div>
        </div>

        <div className="grid content-start gap-4">
          {state.total > 0 && <ProgressBar value={progress} label="Frames received" />}

          {done && (
            <p className="rounded-xl border border-good/25 bg-good-soft px-3.5 py-2.5 text-[13px] font-medium text-good">
              Transfer complete. Integrity verified.
            </p>
          )}

          {error && (
            <p role="alert" className="rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger">
              {error}
            </p>
          )}

          {state.total > 0 && !state.complete && (
            <div className="grid gap-2">
              <p className="text-[12.5px] font-medium text-ink-2">
                Still missing {state.missing.length} frame{state.missing.length === 1 ? '' : 's'}
              </p>
              <div className="flex flex-wrap gap-1">
                {state.missing.slice(0, 60).map((index) => (
                  <span
                    key={index}
                    className="rounded-md border border-warn/30 bg-warn-soft px-2 py-1 font-mono text-[11px] tabular-nums text-warn"
                  >
                    {index + 1}
                  </span>
                ))}
                {state.missing.length > 60 && (
                  <span className="px-2 py-1 text-[11px] text-ink-3">
                    +{state.missing.length - 60} more
                  </span>
                )}
              </div>
              <p className="text-[12px] text-ink-3">
                Ask the sender to step to those frame numbers and hold each one steady.
              </p>
            </div>
          )}

          {state.total === 0 && !error && (
            <p className="text-[13.5px] leading-relaxed text-ink-3">
              Nothing scanned yet. Frames can arrive in any order, and duplicates are ignored — the
              transfer finishes as soon as every frame has been seen once.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
