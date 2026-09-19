/**
 * Status messages.
 *
 * Rendered into an `aria-live` region so screen readers announce the outcome
 * of an action that has no visible focus change.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { cx } from './ui';

export type ToastTone = 'info' | 'success' | 'error';

interface ToastMessage {
  id: number;
  text: string;
  tone: ToastTone;
}

interface ToastContextValue {
  notify: (text: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 0;

const TONE_CLASS: Record<ToastTone, string> = {
  info: 'border-line bg-surface text-ink',
  success: 'border-good/30 bg-good-soft text-good',
  error: 'border-danger/30 bg-danger-soft text-danger',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);

  const notify = useCallback((text: string, tone: ToastTone = 'info') => {
    const id = (nextId += 1);
    setMessages((current) => [...current.slice(-2), { id, text, tone }]);
    window.setTimeout(() => {
      setMessages((current) => current.filter((message) => message.id !== id));
    }, 4200);
  }, []);

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-60 flex flex-col items-center gap-2 px-4 sm:bottom-6"
      >
        {messages.map((message) => (
          <div
            key={message.id}
            className={cx(
              'pointer-events-auto max-w-md rounded-xl border px-4 py-2.5 text-[13.5px] font-medium shadow-float',
              TONE_CLASS[message.tone],
            )}
          >
            {message.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
