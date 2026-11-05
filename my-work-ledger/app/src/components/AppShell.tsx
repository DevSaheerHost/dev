/**
 * The application frame.
 *
 * Bottom navigation on a phone, a sidebar from `sm:` up. The bottom bar is
 * where a thumb can reach while holding the phone one-handed in a shop, which
 * is the posture this app is actually used in.
 *
 * The offline notice is deliberately reassuring rather than alarming: entries
 * are written to the on-device cache first and sync later, so being offline
 * costs nothing and the user needs to know that rather than worry.
 */

import type { ReactNode } from 'react';
import { Bell, BookLock, CloudOff, LayoutDashboard, Settings, Store } from 'lucide-react';

import { ShopSwitcher } from '@/features/shops/ShopSwitcher';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

export type Route = 'dashboard' | 'shops' | 'reminders' | 'settings';

interface NavItem {
  readonly route: Route;
  readonly label: string;
  readonly icon: typeof LayoutDashboard;
}

const NAV_ITEMS: readonly NavItem[] = [
  { route: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { route: 'shops', label: 'Shops', icon: Store },
  { route: 'reminders', label: 'Reminders', icon: Bell },
  { route: 'settings', label: 'Settings', icon: Settings },
];

export function AppShell({
  route,
  onNavigate,
  children,
}: {
  route: Route;
  onNavigate: (route: Route) => void;
  children: ReactNode;
}) {
  const online = useOnlineStatus();

  return (
    <div className="min-h-dvh sm:flex">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-line bg-surface sm:flex sm:flex-col">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-accent-contrast">
            <BookLock size={17} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold text-ink">My Work Ledger</span>
            <span className="block text-xs text-ink-3">Multi-shop balances</span>
          </span>
        </div>
        <nav className="flex flex-col gap-1 px-3">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.route}
              type="button"
              onClick={() => onNavigate(item.route)}
              aria-current={route === item.route ? 'page' : undefined}
              className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors ${
                route === item.route
                  ? 'bg-accent-soft text-accent-ink'
                  : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
              }`}
            >
              <item.icon size={17} />
              {item.label}
            </button>
          ))}
        </nav>
        {!online ? (
          <p className="mt-auto flex items-start gap-2 px-5 py-5 text-xs leading-relaxed text-ink-3">
            <CloudOff size={14} className="mt-0.5 shrink-0" />
            Offline. Entries are saved on this device and sync when you reconnect.
          </p>
        ) : null}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile header */}
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-bg/90 px-4 py-2.5 backdrop-blur-sm sm:hidden">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-accent-contrast">
            <BookLock size={16} />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
            My Work Ledger
          </span>
          <div className="min-w-0 max-w-[55%] shrink">
            <ShopSwitcher />
          </div>
        </header>

        {/* Desktop header */}
        <header className="hidden items-center justify-between gap-3 border-b border-line bg-bg/90 px-7 py-3 backdrop-blur-sm sm:flex">
          <h1 className="text-sm font-semibold text-ink-2">
            {NAV_ITEMS.find((item) => item.route === route)?.label}
          </h1>
          <div className="flex items-center gap-3">
            {!online ? (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-ink-3">
                <CloudOff size={14} />
                Offline
              </span>
            ) : null}
            <div className="w-56">
              <ShopSwitcher />
            </div>
          </div>
        </header>

        {!online ? (
          <p className="flex items-center gap-2 bg-debit-soft px-4 py-2 text-xs font-medium text-debit-strong sm:hidden">
            <CloudOff size={13} className="shrink-0" />
            Offline — entries save here and sync later.
          </p>
        ) : null}

        <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-5 pb-28 sm:px-7 sm:pb-10">
          {children}
        </main>

        {/* Mobile bottom navigation */}
        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] sm:hidden">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.route}
              type="button"
              onClick={() => onNavigate(item.route)}
              aria-current={route === item.route ? 'page' : undefined}
              className={`flex min-h-16 flex-col items-center justify-center gap-1 px-0.5 text-[0.7rem] font-semibold transition-colors ${
                route === item.route ? 'text-accent-ink' : 'text-ink-3'
              }`}
            >
              <item.icon size={20} />
              {item.label}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
