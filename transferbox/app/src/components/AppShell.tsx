/**
 * Application frame: header with the workspace switcher and sync status, and a
 * navigation bar that sits on the side on wide screens and along the bottom on
 * touch-sized ones, where thumbs are.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { APP_NAME } from '@/lib/constants';
import type { RouteName } from '@/hooks/useHashRoute';
import type { SyncStatus } from '@/hooks/useItems';
import { useTheme, type ThemeChoice } from '@/hooks/useTheme';
import { useWorkspace } from '@/stores/workspace';
import { Badge, Button, Dot, cx } from './ui';

const NAV: ReadonlyArray<{ id: RouteName; label: string; icon: ReactNode }> = [
  { id: 'home', label: 'Home', icon: <IconHome /> },
  { id: 'history', label: 'History', icon: <IconHistory /> },
  { id: 'transfer', label: 'Transfer', icon: <IconTransfer /> },
  { id: 'workspace', label: 'Workspace', icon: <IconWorkspace /> },
  { id: 'settings', label: 'Settings', icon: <IconSettings /> },
];

const STATUS_LABEL: Record<SyncStatus, { text: string; tone: 'good' | 'warn' | 'danger' | 'neutral' }> = {
  synced: { text: 'Synced', tone: 'good' },
  syncing: { text: 'Syncing', tone: 'neutral' },
  offline: { text: 'Offline', tone: 'warn' },
  failed: { text: 'Sync failed', tone: 'danger' },
  unconfigured: { text: 'Local only', tone: 'warn' },
};

export function AppShell({
  route,
  onNavigate,
  status,
  children,
}: {
  route: RouteName;
  onNavigate: (name: RouteName) => void;
  status: SyncStatus;
  children: ReactNode;
}) {
  const { workspace } = useWorkspace();
  const { theme, setTheme } = useTheme();
  const statusInfo = STATUS_LABEL[status];

  return (
    <div className="min-h-dvh bg-bg">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3 sm:gap-3 sm:px-6">
          <button
            type="button"
            onClick={() => onNavigate('home')}
            className="flex shrink-0 items-center gap-2.5 rounded-lg text-left"
          >
            <span className="grid size-8 place-items-center rounded-lg bg-accent text-accent-contrast">
              <IconBox />
            </span>
            <span className="hidden text-[15px] font-semibold tracking-tight text-ink min-[420px]:inline">
              {APP_NAME}
            </span>
          </button>

          <WorkspaceSwitcher onNavigate={onNavigate} />

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Badge tone={statusInfo.tone} className="hidden sm:inline-flex">
              <Dot tone={statusInfo.tone} />
              {statusInfo.text}
            </Badge>
            <ThemeToggle theme={theme} onChange={setTheme} />
          </div>
        </div>

        <p className="sr-only" role="status" aria-live="polite">
          {workspace.kind === 'public' ? 'Public workspace' : `Private workspace ${workspace.label}`}.{' '}
          {statusInfo.text}.
        </p>
      </header>

      <div className="mx-auto flex max-w-6xl gap-6 px-4 pb-24 pt-5 sm:px-6 lg:pb-10">
        <nav aria-label="Sections" className="hidden w-44 shrink-0 lg:block">
          <ul className="sticky top-20 grid gap-1">
            {NAV.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => onNavigate(entry.id)}
                  aria-current={route === entry.id ? 'page' : undefined}
                  className={cx(
                    'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                    route === entry.id
                      ? 'bg-accent-soft text-accent-ink'
                      : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
                  )}
                >
                  <span className="shrink-0">{entry.icon}</span>
                  {entry.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 flex-1">{children}</main>
      </div>

      <nav
        aria-label="Sections"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur-md lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <ul className="mx-auto flex max-w-lg">
          {NAV.map((entry) => (
            <li key={entry.id} className="flex-1">
              <button
                type="button"
                onClick={() => onNavigate(entry.id)}
                aria-current={route === entry.id ? 'page' : undefined}
                className={cx(
                  'flex h-14 w-full flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors',
                  route === entry.id ? 'text-accent' : 'text-ink-3',
                )}
              >
                {entry.icon}
                {entry.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

function WorkspaceSwitcher({ onNavigate }: { onNavigate: (name: RouteName) => void }) {
  const { workspace, known, switchTo, switchToPublic } = useWorkspace();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const isPublic = workspace.kind === 'public';

  return (
    <div ref={container} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cx(
          'flex w-full min-w-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors',
          isPublic
            ? 'border-warn/30 bg-warn-soft text-warn'
            : 'border-good/30 bg-good-soft text-good',
        )}
      >
        <Dot tone={isPublic ? 'warn' : 'good'} />
        <span className="min-w-0 truncate">
          {isPublic ? 'Public' : `Private · ${workspace.label}`}
        </span>
        <IconChevron />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-2 w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line bg-surface shadow-float"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              switchToPublic();
              setOpen(false);
            }}
            className="flex w-full flex-col gap-0.5 border-b border-line px-4 py-3 text-left hover:bg-surface-2"
          >
            <span className="text-[13.5px] font-semibold text-ink">Public workspace</span>
            <span className="text-[12px] text-ink-3">Shared with everyone. No privacy.</span>
          </button>

          {known
            .filter((entry) => entry.kind === 'private')
            .map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  void switchTo(entry.id);
                  setOpen(false);
                }}
                className="flex w-full flex-col gap-0.5 border-b border-line px-4 py-3 text-left hover:bg-surface-2"
              >
                <span className="text-[13.5px] font-semibold text-ink">Private · {entry.label}</span>
                <span className="text-[12px] text-ink-3">End-to-end encrypted on this device</span>
              </button>
            ))}

          <div className="p-2">
            <Button
              size="sm"
              variant="primary"
              block
              onClick={() => {
                setOpen(false);
                onNavigate('workspace');
              }}
            >
              Manage workspaces
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ThemeToggle({
  theme,
  onChange,
}: {
  theme: ThemeChoice;
  onChange: (choice: ThemeChoice) => void;
}) {
  const order: ThemeChoice[] = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(theme) + 1) % order.length]!;
  const label: Record<ThemeChoice, string> = {
    system: 'System theme',
    light: 'Light theme',
    dark: 'Dark theme',
  };

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => onChange(next)}
      aria-label={`${label[theme]}. Switch to ${label[next].toLowerCase()}`}
      title={label[theme]}
    >
      {theme === 'dark' ? <IconMoon /> : theme === 'light' ? <IconSun /> : <IconAuto />}
      <span className="hidden sm:inline">{theme === 'system' ? 'Auto' : label[theme].split(' ')[0]}</span>
    </Button>
  );
}

/* ---------------------------------------------------------------- icons ---- */

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function IconBox() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden="true" {...stroke}>
      <path d="M21 8v8a2 2 0 0 1-1 1.7l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.7l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8z" />
      <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
    </svg>
  );
}

function IconHome() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true" {...stroke}>
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />
    </svg>
  );
}

function IconHistory() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true" {...stroke}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3 4v4h4M12 8v4.5l3 1.8" />
    </svg>
  );
}

function IconTransfer() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true" {...stroke}>
      <path d="M4 8h13l-3-3M20 16H7l3 3" />
    </svg>
  );
}

function IconWorkspace() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true" {...stroke}>
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7.5a4 4 0 0 1 8 0V10M12 14v2" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true" {...stroke}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M21 12h-2.5M5.5 12H3M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8M18.4 18.4l-1.8-1.8M7.4 7.4 5.6 5.6" />
    </svg>
  );
}

function IconChevron() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" aria-hidden="true" {...stroke}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function IconSun() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true" {...stroke}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M22 12h-2M4 12H2M19 5l-1.5 1.5M6.5 17.5 5 19M19 19l-1.5-1.5M6.5 6.5 5 5" />
    </svg>
  );
}

function IconMoon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true" {...stroke}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
    </svg>
  );
}

function IconAuto() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true" {...stroke}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4v16a8 8 0 0 0 0-16z" fill="currentColor" stroke="none" />
    </svg>
  );
}
