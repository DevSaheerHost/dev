/**
 * The current draft, shared between Home and Transfer.
 *
 * The text body is deliberately kept in a ref rather than React state: a 3 MB
 * string in state would be copied into every render and handed to every context
 * consumer. Components subscribe to the cheap `stats` value (characters and
 * bytes) and read the body only when they are about to act on it.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface DraftStats {
  characters: number;
  bytes: number;
}

interface DraftContextValue {
  /** Store what the composer holds without re-rendering anything. */
  setBody: (text: string) => void;
  /** Read the full body. Call this only when you need the whole string. */
  getText: () => string;
  /** Replace the body programmatically; bumps `revision` so inputs re-sync. */
  setText: (text: string, stats?: DraftStats) => void;
  /** Report new counts without replacing the body (the textarea owns it). */
  reportStats: (stats: DraftStats) => void;
  stats: DraftStats;
  file: File | null;
  setFile: (file: File | null) => void;
  clear: () => void;
  revision: number;
}

const EMPTY: DraftStats = { characters: 0, bytes: 0 };

const DraftContext = createContext<DraftContextValue | null>(null);

export function DraftProvider({ children }: { children: ReactNode }) {
  const body = useRef('');
  const [stats, setStats] = useState<DraftStats>(EMPTY);
  const [file, setFile] = useState<File | null>(null);
  const [revision, setRevision] = useState(0);

  const getText = useCallback(() => body.current, []);

  /** The textarea owns its own value; this keeps our copy in step silently. */
  const setBody = useCallback((text: string) => {
    body.current = text;
  }, []);

  const setText = useCallback((text: string, next?: DraftStats) => {
    body.current = text;
    setStats(next ?? { characters: text.length, bytes: new Blob([text]).size });
    setRevision((value) => value + 1);
  }, []);

  const reportStats = useCallback((next: DraftStats) => setStats(next), []);

  const clear = useCallback(() => {
    body.current = '';
    setStats(EMPTY);
    setFile(null);
    setRevision((value) => value + 1);
  }, []);

  const value = useMemo<DraftContextValue>(
    () => ({ setBody, getText, setText, reportStats, stats, file, setFile, clear, revision }),
    [setBody, getText, setText, reportStats, stats, file, clear, revision],
  );

  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function useDraft(): DraftContextValue {
  const context = useContext(DraftContext);
  if (!context) throw new Error('useDraft must be used inside DraftProvider');
  return context;
}
