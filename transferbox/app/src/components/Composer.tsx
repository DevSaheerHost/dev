/**
 * The composer: paste text, drop a file, choose how long it lives, send.
 *
 * Performance notes — this is the one place that handles megabyte payloads:
 *   - the textarea is uncontrolled; its value never enters React state
 *   - counts are recomputed on a short debounce, not per keystroke
 *   - byte size is estimated by walking code units, which avoids allocating a
 *     second copy of a 3 MB string on every update
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { MAX_FILE_BYTES, MAX_TEXT_BYTES, RETENTIONS } from '@/lib/constants';
import { AppError, messageFor } from '@/lib/errors';
import {
  estimateUtf8Size,
  formatBytes,
  formatCount,
  isActiveContentType,
  kindFromMime,
} from '@/lib/format';
import { canPaste, pasteText } from '@/services/clipboard';
import { useDraft } from '@/stores/draft';
import { useToast } from './Toast';
import { Badge, Button, Card, ProgressBar, Select, cx } from './ui';
import type { Progress, RetentionId } from '@/types';

interface ComposerProps {
  retention: RetentionId;
  onRetentionChange: (retention: RetentionId) => void;
  onSaveText: (text: string) => Promise<void>;
  onSaveFile: (file: File) => Promise<void>;
  onQrTransfer: () => void;
  onDirectTransfer: () => void;
  progress: Progress | null;
  busy: boolean;
}

const DEBOUNCE_MS = 140;

export function Composer({
  retention,
  onRetentionChange,
  onSaveText,
  onSaveFile,
  onQrTransfer,
  onDirectTransfer,
  progress,
  busy,
}: ComposerProps) {
  const draft = useDraft();
  const { notify } = useToast();
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const timer = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Re-sync the DOM value when the body is replaced from elsewhere. */
  useEffect(() => {
    const value = draft.getText();
    if (area.current && area.current.value !== value) area.current.value = value;
  }, [draft]);

  const recount = useCallback(
    (value: string) => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        draft.reportStats({ characters: value.length, bytes: estimateUtf8Size(value) });
      }, DEBOUNCE_MS);
    },
    [draft],
  );

  const onInput = (event: React.FormEvent<HTMLTextAreaElement>) => {
    const value = event.currentTarget.value;
    draft.setBody(value);
    setError(null);
    recount(value);
  };

  const stageFile = useCallback(
    (file: File | null | undefined) => {
      if (!file) return;
      if (file.size > MAX_FILE_BYTES) {
        setError(new AppError('file-too-large').message);
        return;
      }
      if (isActiveContentType(file.type, file.name)) {
        setError(new AppError('unsafe-type').message);
        return;
      }
      setError(null);
      draft.setFile(file);
    },
    [draft],
  );

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      stageFile(file);
      return;
    }
    const text = event.dataTransfer.getData('text/plain');
    if (text) {
      draft.setText(text);
      notify('Text added to the composer.');
    }
  };

  const handlePaste = async () => {
    try {
      const text = await pasteText();
      if (!text) {
        notify('Your clipboard is empty.', 'info');
        return;
      }
      draft.setText(text);
      notify('Pasted from clipboard.', 'success');
    } catch (pasteError) {
      notify(messageFor(pasteError), 'error');
    }
  };

  const save = async () => {
    setError(null);
    const file = draft.file;
    try {
      if (file) {
        await onSaveFile(file);
        draft.setFile(null);
        if (picker.current) picker.current.value = '';
        notify('File uploaded to this workspace.', 'success');
        return;
      }
      const text = draft.getText();
      if (!text.trim()) {
        setError(new AppError('empty').message);
        return;
      }
      if (estimateUtf8Size(text) > MAX_TEXT_BYTES) {
        setError(new AppError('text-too-large').message);
        return;
      }
      await onSaveText(text);
      draft.clear();
      if (area.current) area.current.value = '';
      notify('Saved to this workspace.', 'success');
    } catch (saveError) {
      setError(messageFor(saveError));
    }
  };

  const { characters, bytes } = draft.stats;
  const overLimit = bytes > MAX_TEXT_BYTES;
  const file = draft.file;

  return (
    <Card
      className={cx('overflow-hidden transition-colors', dragging && 'border-accent ring-3 ring-accent-soft')}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">
            Paste or drop something here
          </h2>
          <p className="text-[12.5px] text-ink-3">
            Text up to {formatBytes(MAX_TEXT_BYTES)}, files up to {formatBytes(MAX_FILE_BYTES)}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canPaste() && (
            <Button size="sm" variant="ghost" onClick={handlePaste}>
              Paste
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              draft.clear();
              if (area.current) area.current.value = '';
              if (picker.current) picker.current.value = '';
            }}
          >
            Clear
          </Button>
        </div>
      </div>

      <div className="p-5">
        <label htmlFor="composer" className="sr-only">
          Text to share
        </label>
        <textarea
          id="composer"
          ref={area}
          onInput={onInput}
          spellCheck={false}
          rows={8}
          placeholder="Paste large text here, or drop a file anywhere on this card."
          className="tb-scroll block max-h-[46vh] min-h-[9rem] w-full resize-y rounded-xl border border-line bg-surface-2 px-3.5 py-3 font-mono text-[13.5px] leading-relaxed text-ink transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
        />

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-ink-3">
          <span className="font-mono tabular-nums">
            {formatCount(characters)} characters
          </span>
          <span className={cx('font-mono tabular-nums', overLimit && 'font-semibold text-danger')}>
            {formatBytes(bytes)}
          </span>
          {overLimit && <Badge tone="danger">Over the {formatBytes(MAX_TEXT_BYTES)} limit</Badge>}
        </div>

        {file && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-medium text-ink">{file.name}</p>
              <p className="mt-0.5 text-[12px] text-ink-3">
                {file.type || 'unknown type'} · {formatBytes(file.size)} ·{' '}
                {RETENTIONS.find((r) => r.id === retention)?.label ?? ''}
              </p>
            </div>
            <Badge tone="accent">{kindFromMime(file.type, file.name)}</Badge>
            <Button size="sm" variant="ghost" onClick={() => draft.setFile(null)}>
              Remove
            </Button>
          </div>
        )}

        {progress && progress.total > 0 && (
          <div className="mt-4">
            <ProgressBar value={progress.loaded / progress.total} label="Uploading" />
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger">
            {error}
          </p>
        )}

        <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="grid gap-1.5">
            <label htmlFor="retention" className="text-[12.5px] font-medium text-ink-2">
              Keep this for
            </label>
            <Select
              id="retention"
              value={retention}
              onChange={(event) => onRetentionChange(event.target.value as RetentionId)}
              className="sm:max-w-56"
            >
              {RETENTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="lg" onClick={() => void save()} busy={busy}>
              {file ? 'Upload file' : 'Save & Sync'}
            </Button>
            <Button size="lg" onClick={onQrTransfer}>
              QR Transfer
            </Button>
            <Button size="lg" onClick={onDirectTransfer}>
              Direct Transfer
            </Button>
            <Button size="lg" variant="ghost" onClick={() => picker.current?.click()}>
              Choose file
            </Button>
          </div>
        </div>

        <input
          ref={picker}
          type="file"
          className="sr-only"
          onChange={(event) => stageFile(event.target.files?.[0])}
        />
      </div>
    </Card>
  );
}
