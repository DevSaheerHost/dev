/**
 * Workspace state.
 *
 * Holds the active workspace, the list of workspaces this device knows about,
 * and the operations that create, join, switch and forget them. Secrets live
 * in IndexedDB on this device only; they are never sent to a server, written to
 * a query string, or logged.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  deriveWorkspaceId,
  generateSecret,
  isValidSecret,
  labelFromId,
} from '@/crypto/workspace';
import { AppError } from '@/lib/errors';
import {
  SETTING_KEYS,
  readSetting,
  readWorkspaces,
  writeSetting,
  writeWorkspaces,
} from '@/storage/db';
import type { StoredWorkspace, Workspace } from '@/types';

const PUBLIC_WORKSPACE: Workspace = {
  kind: 'public',
  id: 'public',
  label: 'Public workspace',
};

interface WorkspaceContextValue {
  workspace: Workspace;
  known: StoredWorkspace[];
  ready: boolean;
  createPrivate: () => Promise<Workspace>;
  join: (secret: string) => Promise<Workspace>;
  switchTo: (id: string) => Promise<void>;
  forget: (id: string) => Promise<void>;
  switchToPublic: () => void;
  shareLink: (workspace: Workspace) => string;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/** Build a share link. The secret sits in the fragment, never in the query. */
export function buildShareLink(workspace: Workspace): string {
  if (workspace.kind === 'public') {
    return `${window.location.origin}${window.location.pathname}#/home`;
  }
  return `${window.location.origin}${window.location.pathname}#/workspace?join=${workspace.secret}`;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<Workspace>(PUBLIC_WORKSPACE);
  const [known, setKnown] = useState<StoredWorkspace[]>([]);
  const [ready, setReady] = useState(false);

  /** Restore the previous session, then honour a join link if one is present. */
  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      const [stored, activeId] = await Promise.all([
        readWorkspaces(),
        readSetting<string>(SETTING_KEYS.activeWorkspace, 'public'),
      ]);
      if (cancelled) return;

      setKnown(stored);
      const active = stored.find((entry) => entry.id === activeId);
      if (active?.kind === 'private' && active.secret) {
        setWorkspace({
          kind: 'private',
          id: active.id,
          secret: active.secret,
          label: active.label,
        });
      }
      setReady(true);
    };

    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  const remember = useCallback(async (entry: StoredWorkspace) => {
    const stored = await readWorkspaces();
    const next = [entry, ...stored.filter((row) => row.id !== entry.id)].slice(0, 12);
    await writeWorkspaces(next);
    await writeSetting(SETTING_KEYS.activeWorkspace, entry.id);
    setKnown(next);
  }, []);

  const adopt = useCallback(
    async (secret: string): Promise<Workspace> => {
      if (!isValidSecret(secret)) throw new AppError('workspace-invalid');
      const id = await deriveWorkspaceId(secret);
      const label = labelFromId(id);
      const next: Workspace = { kind: 'private', id, secret, label };
      await remember({ id, kind: 'private', secret, label, lastUsedAt: Date.now() });
      setWorkspace(next);
      return next;
    },
    [remember],
  );

  const createPrivate = useCallback(() => adopt(generateSecret()), [adopt]);
  const join = useCallback((secret: string) => adopt(secret.trim()), [adopt]);

  const switchTo = useCallback(
    async (id: string) => {
      if (id === 'public') {
        setWorkspace(PUBLIC_WORKSPACE);
        await writeSetting(SETTING_KEYS.activeWorkspace, 'public');
        return;
      }
      const stored = await readWorkspaces();
      const entry = stored.find((row) => row.id === id);
      if (!entry?.secret) throw new AppError('workspace-invalid');
      setWorkspace({ kind: 'private', id: entry.id, secret: entry.secret, label: entry.label });
      await writeSetting(SETTING_KEYS.activeWorkspace, entry.id);
    },
    [],
  );

  const forget = useCallback(
    async (id: string) => {
      const stored = await readWorkspaces();
      const next = stored.filter((row) => row.id !== id);
      await writeWorkspaces(next);
      setKnown(next);
      setWorkspace((current) => (current.id === id ? PUBLIC_WORKSPACE : current));
      await writeSetting(SETTING_KEYS.activeWorkspace, 'public');
    },
    [],
  );

  const switchToPublic = useCallback(() => {
    setWorkspace(PUBLIC_WORKSPACE);
    void writeSetting(SETTING_KEYS.activeWorkspace, 'public');
  }, []);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspace,
      known,
      ready,
      createPrivate,
      join,
      switchTo,
      forget,
      switchToPublic,
      shareLink: buildShareLink,
    }),
    [workspace, known, ready, createPrivate, join, switchTo, forget, switchToPublic],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return context;
}

export { PUBLIC_WORKSPACE };
