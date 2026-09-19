/**
 * History list and item detail.
 *
 * Rows render a truncated preview only; the full body is fetched on demand
 * when an item is opened, so a list of 3 MB pastes stays cheap to scroll.
 */

import { useCallback, useEffect, useState } from 'react';

import { FULL_VIEW_CHARS } from '@/lib/constants';
import { messageFor } from '@/lib/errors';
import { KIND_LABEL, formatBytes, formatExpiry, formatRelative } from '@/lib/format';
import { copyText } from '@/services/clipboard';
import { fetchBlob, fetchText } from '@/services/items';
import { useWorkspace } from '@/stores/workspace';
import { useToast } from './Toast';
import { Badge, Button, EmptyState, Modal, Spinner, cx } from './ui';
import type { Item, PendingTransfer } from '@/types';

const TONE_BY_KIND = {
  text: 'neutral',
  image: 'accent',
  video: 'accent',
  audio: 'accent',
  file: 'neutral',
} as const;

export function ItemList({
  items,
  pending,
  loading,
  onDelete,
  onDiscardPending,
  emptyAction,
}: {
  items: Item[];
  pending: PendingTransfer[];
  loading: boolean;
  onDelete: (item: Item) => void;
  onDiscardPending: (id: string) => void;
  emptyAction?: React.ReactNode;
}) {
  const [open, setOpen] = useState<Item | null>(null);

  if (loading && items.length === 0 && pending.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 px-6 py-12 text-[13.5px] text-ink-3">
        <Spinner className="size-4" />
        Loading this workspace…
      </div>
    );
  }

  if (items.length === 0 && pending.length === 0) {
    return (
      <EmptyState
        title="Nothing here yet"
        description="Anything you save appears here, and on every other browser opened in this workspace."
        action={emptyAction}
      />
    );
  }

  return (
    <>
      <ul className="divide-y divide-line">
        {pending.map((entry) => (
          <li key={entry.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
            <Badge tone="warn">Waiting to sync</Badge>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-medium text-ink">
                {entry.kind === 'file' ? (entry.fileName ?? 'File') : (entry.text ?? '').slice(0, 80)}
              </p>
              <p className="text-[12px] text-ink-3">
                Saved on this device {formatRelative(entry.createdAt)} · uploads when the connection returns
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => onDiscardPending(entry.id)}>
              Discard
            </Button>
          </li>
        ))}

        {items.map((item) => (
          <ItemRow key={item.id} item={item} onOpen={() => setOpen(item)} onDelete={() => onDelete(item)} />
        ))}
      </ul>

      {open && (
        <ItemDetail key={open.id} item={open} onClose={() => setOpen(null)} onDelete={onDelete} />
      )}
    </>
  );
}

function ItemRow({
  item,
  onOpen,
  onDelete,
}: {
  item: Item;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { notify } = useToast();
  const label = item.type === 'text' ? KIND_LABEL.text : (item.fileName ?? KIND_LABEL[item.type]);

  const quickCopy = async () => {
    if (item.text === undefined) {
      onOpen();
      return;
    }
    try {
      await copyText(item.text);
      notify('Copied to clipboard.', 'success');
    } catch (error) {
      notify(messageFor(error), 'error');
    }
  };

  return (
    <li className="group flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 transition-colors hover:bg-surface-2">
      <Badge tone={TONE_BY_KIND[item.type]} className="shrink-0">
        {KIND_LABEL[item.type]}
      </Badge>

      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 text-left"
        aria-label={`Open ${label}`}
      >
        <p className="truncate text-[13.5px] font-medium text-ink">{label}</p>
        <p className="truncate text-[12px] text-ink-3">
          {item.type === 'text' ? item.preview.replace(/\s+/g, ' ').slice(0, 120) : (item.mimeType ?? 'file')}
        </p>
      </button>

      <div className="flex shrink-0 items-center gap-3 text-[12px] text-ink-3">
        <span className="font-mono tabular-nums">{formatBytes(item.size)}</span>
        <span className="hidden sm:inline">{formatRelative(item.createdAt)}</span>
      </div>

      <div className="flex shrink-0 gap-1">
        <Button size="sm" variant="ghost" onClick={() => void quickCopy()}>
          {item.type === 'text' ? 'Copy' : 'Open'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete} aria-label={`Delete ${label}`}>
          Delete
        </Button>
      </div>
    </li>
  );
}

/** Mounted fresh for each item (see the `key` above), so no reset logic. */
function ItemDetail({
  item,
  onClose,
  onDelete,
}: {
  item: Item;
  onClose: () => void;
  onDelete: (item: Item) => void;
}) {
  const { workspace } = useWorkspace();
  const { notify } = useToast();
  const [body, setBody] = useState<string | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(item.type === 'text');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (item.type !== 'text') return;
    let cancelled = false;

    fetchText(workspace, item)
      .then((text) => {
        if (!cancelled) setBody(text);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(messageFor(loadError));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [item, workspace]);

  useEffect(
    () => () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
    [objectUrl],
  );

  const download = useCallback(async () => {
    if (!item) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await fetchBlob(workspace, item);
      const url = URL.createObjectURL(blob);
      setObjectUrl(url);
      const link = document.createElement('a');
      link.href = url;
      link.download = item.fileName ?? 'transferbox-file';
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      notify('Downloaded. Integrity verified.', 'success');
    } catch (downloadError) {
      setError(messageFor(downloadError));
    } finally {
      setBusy(false);
    }
  }, [item, workspace, notify]);

  const title = item.type === 'text' ? 'Text' : (item.fileName ?? 'File');
  const truncated = body !== null && body.length > FULL_VIEW_CHARS;

  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[12px] text-ink-3">
            {formatBytes(item.size)} · {formatExpiry(item.expiresAt)}
            {item.sha256 && ' · integrity hash stored'}
          </span>
          <div className="flex gap-2">
            {item.type === 'text' && body !== null && (
              <Button
                onClick={() => {
                  void copyText(body)
                    .then(() => notify('Copied to clipboard.', 'success'))
                    .catch((copyError) => notify(messageFor(copyError), 'error'));
                }}
              >
                Copy all
              </Button>
            )}
            {item.storagePath && (
              <Button variant="primary" busy={busy} onClick={() => void download()}>
                Download
              </Button>
            )}
            <Button
              variant="danger"
              onClick={() => {
                onDelete(item);
                onClose();
              }}
            >
              Delete
            </Button>
          </div>
        </div>
      }
    >
      {error && (
        <p role="alert" className="mb-4 rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger">
          {error}
        </p>
      )}

      {busy && body === null && (
        <p className="flex items-center gap-2 text-[13.5px] text-ink-3">
          <Spinner className="size-4" /> Fetching content…
        </p>
      )}

      {item.type === 'text' && body !== null && (
        <>
          {truncated && (
            <p className="mb-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12.5px] text-ink-3">
              Showing the first {FULL_VIEW_CHARS.toLocaleString()} characters. Copy all to get the
              whole thing.
            </p>
          )}
          <pre className="tb-scroll max-h-[52vh] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-line bg-surface-2 p-4 font-mono text-[12.5px] leading-relaxed text-ink">
            {truncated ? `${body.slice(0, FULL_VIEW_CHARS)}…` : body}
          </pre>
        </>
      )}

      {item.type !== 'text' && (
        <div className={cx('grid gap-3 text-[13.5px] text-ink-2')}>
          <Detail label="Name" value={item.fileName ?? '—'} />
          <Detail label="Type" value={item.mimeType ?? 'unknown'} />
          <Detail label="Size" value={formatBytes(item.size)} />
          <Detail label="Added" value={new Date(item.createdAt).toLocaleString()} />
          <Detail label="Expires" value={formatExpiry(item.expiresAt)} />
          {item.sha256 && <Detail label="SHA-256" value={item.sha256} mono />}
          {objectUrl && item.type === 'image' && (
            <img src={objectUrl} alt={item.fileName ?? 'Shared image'} className="mt-2 max-h-80 rounded-xl border border-line object-contain" />
          )}
        </div>
      )}
    </Modal>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 border-b border-line pb-2 last:border-b-0">
      <span className="text-[12.5px] text-ink-3">{label}</span>
      <span className={cx('break-words', mono && 'font-mono text-[11.5px]')}>{value}</span>
    </div>
  );
}
