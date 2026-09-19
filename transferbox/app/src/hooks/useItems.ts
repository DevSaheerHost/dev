/**
 * The workspace's items, with the offline story attached.
 *
 * On mount the cached copy is shown immediately, then the live subscription
 * takes over. Saves made while offline go into an IndexedDB queue and are
 * flushed when connectivity returns; their status is reported honestly rather
 * than being shown as synced.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { isCloudConfigured } from '@/firebase/client';
import { AppError, toAppError } from '@/lib/errors';
import { isExpired } from '@/lib/format';
import { deleteItem, saveFile, saveText, subscribeItems } from '@/services/items';
import {
  cacheItems,
  queuePending,
  readCachedItems,
  readPending,
  removePending,
} from '@/storage/db';
import { useOnline } from '@/hooks/useOnline';
import { useWorkspace } from '@/stores/workspace';
import type { Item, PendingTransfer, Progress, RetentionId } from '@/types';

export type SyncStatus = 'offline' | 'syncing' | 'synced' | 'failed' | 'unconfigured';

interface SaveArgs {
  retention: RetentionId;
  onProgress?: (progress: Progress) => void;
}

export function useItems() {
  const { workspace } = useWorkspace();
  const online = useOnline();
  const [items, setItems] = useState<Item[]>([]);
  const [pending, setPending] = useState<PendingTransfer[]>([]);
  const [status, setStatus] = useState<SyncStatus>('syncing');
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(true);
  const [shownWorkspace, setShownWorkspace] = useState(workspace.id);
  const flushing = useRef(false);

  /*
   * Switching workspace resets the view. React's documented way to adjust
   * state when an input changes is to do it during render, which avoids the
   * extra commit an effect would cause.
   */
  if (shownWorkspace !== workspace.id) {
    setShownWorkspace(workspace.id);
    setItems([]);
    setLoading(true);
    setError(null);
  }

  /* Cached copy first, so history is never blank on a cold start. */
  useEffect(() => {
    let cancelled = false;
    void readCachedItems(workspace.id).then((cached) => {
      if (cancelled || cached.length === 0) return;
      setItems((current) =>
        current.length > 0 ? current : cached.filter((item) => !isExpired(item.expiresAt)),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [workspace.id]);

  /* Live subscription. */
  useEffect(() => {
    if (!isCloudConfigured()) {
      queueMicrotask(() => {
        setStatus('unconfigured');
        setLoading(false);
      });
      return;
    }

    const subscription = subscribeItems(
      workspace,
      (next) => {
        setItems(next);
        setLoading(false);
        setStatus('synced');
        setError(null);
        void cacheItems(workspace.id, next);
      },
      (subscriptionError) => {
        setError(subscriptionError);
        setStatus(navigator.onLine ? 'failed' : 'offline');
        setLoading(false);
      },
    );

    return () => subscription.close();
  }, [workspace, online]);

  const refreshPending = useCallback(
    () =>
      readPending().then((queue) => {
        setPending(queue.filter((entry) => entry.workspaceId === workspace.id));
      }),
    [workspace.id],
  );

  useEffect(() => {
    void refreshPending();
  }, [refreshPending]);

  /* Flush the offline queue when the connection returns. */
  useEffect(() => {
    if (!online || !isCloudConfigured() || flushing.current) return;

    const flush = async () => {
      flushing.current = true;
      try {
        const queue = await readPending();
        for (const entry of queue) {
          if (entry.workspaceId !== workspace.id) continue;
          try {
            if (entry.kind === 'text' && entry.text !== undefined) {
              await saveText(workspace, entry.text, { retention: entry.retention });
            } else if (entry.blob) {
              const file = new File([entry.blob], entry.fileName ?? 'file', {
                type: entry.mimeType ?? 'application/octet-stream',
              });
              await saveFile(workspace, file, { retention: entry.retention });
            }
            await removePending(entry.id);
          } catch (flushError) {
            setError(toAppError(flushError, 'save-failed'));
            setStatus('failed');
          }
        }
      } finally {
        flushing.current = false;
        await refreshPending();
      }
    };

    void flush();
  }, [online, workspace, refreshPending]);

  const addText = useCallback(
    async (text: string, args: SaveArgs) => {
      setError(null);
      if (!online || !isCloudConfigured()) {
        const entry: PendingTransfer = {
          id: `pending-${Date.now()}-${Math.round(performance.now())}`,
          workspaceId: workspace.id,
          createdAt: Date.now(),
          retention: args.retention,
          kind: 'text',
          text,
          attempts: 0,
        };
        await queuePending(entry);
        await refreshPending();
        return;
      }
      try {
        await saveText(workspace, text, args);
      } catch (saveError) {
        const appError = toAppError(saveError, 'save-failed');
        setError(appError);
        throw appError;
      }
    },
    [online, workspace, refreshPending],
  );

  const addFile = useCallback(
    async (file: File, args: SaveArgs) => {
      setError(null);
      if (!online || !isCloudConfigured()) {
        const entry: PendingTransfer = {
          id: `pending-${Date.now()}-${Math.round(performance.now())}`,
          workspaceId: workspace.id,
          createdAt: Date.now(),
          retention: args.retention,
          kind: 'file',
          blob: file,
          fileName: file.name,
          mimeType: file.type,
          attempts: 0,
        };
        await queuePending(entry);
        await refreshPending();
        return;
      }
      try {
        await saveFile(workspace, file, args);
      } catch (saveError) {
        const appError = toAppError(saveError, 'upload-failed');
        setError(appError);
        throw appError;
      }
    },
    [online, workspace, refreshPending],
  );

  const removeItem = useCallback(
    async (item: Item) => {
      setItems((current) => current.filter((row) => row.id !== item.id));
      try {
        await deleteItem(workspace, {
          id: item.id,
          ...(item.storagePath === undefined ? {} : { storagePath: item.storagePath }),
        });
      } catch (deleteError) {
        setError(toAppError(deleteError, 'delete-failed'));
      }
    },
    [workspace],
  );

  const discardPending = useCallback(
    async (id: string) => {
      await removePending(id);
      await refreshPending();
    },
    [refreshPending],
  );

  const visible = useMemo(() => items.filter((item) => !isExpired(item.expiresAt)), [items]);

  return {
    items: visible,
    pending,
    status: online ? status : 'offline',
    error,
    loading,
    addText,
    addFile,
    removeItem,
    discardPending,
    clearError: () => setError(null),
  };
}
