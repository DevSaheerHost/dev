/**
 * The application root.
 *
 * Routing is the URL hash, read and written directly. A router dependency buys
 * nothing here: there are five screens, no nested layouts and no data loading
 * tied to a route. The hash also survives the `file://`-style origin a
 * Capacitor WebView serves from, where path-based routing needs a server.
 *
 * `#/shop/{id}` carries the open shop, so the back button works and a reload
 * lands where the user was rather than bouncing them to the dashboard.
 */

import { useEffect, useState } from 'react';

import { AppShell, type Route } from '@/components/AppShell';
import { Spinner } from '@/components/ui';
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider';
import { SignInPage } from '@/features/auth/SignInPage';
import { ShopsProvider, useShops } from '@/features/shops/ShopsProvider';
import { ShopsPage } from '@/features/shops/ShopsPage';
import { LedgerProvider } from '@/features/ledger/LedgerProvider';
import { ReminderRuntimeProvider } from '@/features/reminders/ReminderRuntime';
import { useAndroidBackButton } from '@/hooks/useAndroidBackButton';
import { DashboardPage } from '@/pages/DashboardPage';
import { RemindersPage } from '@/pages/RemindersPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { ShopPage } from '@/pages/ShopPage';
import { useTheme } from '@/hooks/useTheme';

const ROUTES: readonly Route[] = ['dashboard', 'shops', 'reminders', 'settings'];

interface Location {
  readonly route: Route;
  /** Set when the hash is `#/shop/{id}`; the tab stays on Shops underneath. */
  readonly shopId: string | null;
}

function readLocation(): Location {
  const candidate = window.location.hash.replace(/^#\/?/, '');
  const shopMatch = /^shop\/([A-Za-z][A-Za-z0-9_-]{1,127})$/.exec(candidate);
  if (shopMatch) return { route: 'shops', shopId: shopMatch[1] ?? null };
  return { route: ROUTES.find((route) => route === candidate) ?? 'dashboard', shopId: null };
}

function useHashLocation(): [Location, (next: Route) => void, (shopId: string) => void] {
  const [location, setLocation] = useState<Location>(readLocation);

  useEffect(() => {
    const onHashChange = () => setLocation(readLocation());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Writing the hash fires `hashchange`, which updates the state above, so the
  // URL stays the single source of truth and the back button works.
  const navigate = (next: Route) => {
    window.location.hash = `#/${next}`;
  };
  const openShop = (shopId: string) => {
    window.location.hash = `#/shop/${shopId}`;
  };

  return [location, navigate, openShop];
}

function Screens({
  location,
  navigate,
  openShop,
}: {
  location: Location;
  navigate: (route: Route) => void;
  openShop: (shopId: string) => void;
}) {
  const { shops } = useShops();
  const openedShop = location.shopId
    ? (shops.find((shop) => shop.id === location.shopId) ?? null)
    : null;

  // A hash pointing at a shop that no longer exists falls back to the list
  // rather than showing an empty screen.
  if (location.shopId && !openedShop) {
    return <ShopsPage onOpenShop={openShop} />;
  }

  if (openedShop) {
    return (
      <ShopPage
        shop={openedShop}
        onBack={() => navigate('shops')}
        onOpenReminders={() => navigate('reminders')}
      />
    );
  }

  return (
    <>
      {location.route === 'dashboard' ? <DashboardPage onOpenShop={openShop} /> : null}
      {location.route === 'shops' ? <ShopsPage onOpenShop={openShop} /> : null}
      {location.route === 'reminders' ? <RemindersPage onOpenShop={openShop} /> : null}
      {location.route === 'settings' ? <SettingsPage /> : null}
    </>
  );
}

function SignedInApp() {
  const [location, navigate, openShop] = useHashLocation();
  useAndroidBackButton();

  return (
    <ShopsProvider>
      <LedgerProvider>
        {/*
          Reminders are derived and delivered here, above the screens, so a
          notification fires wherever you are in the app — and, on Android, so
          the phone's alarms are kept in step with the ledger.
        */}
        <ReminderRuntimeProvider>
          <AppShell route={location.route} onNavigate={navigate}>
            <Screens location={location} navigate={navigate} openShop={openShop} />
          </AppShell>
        </ReminderRuntimeProvider>
      </LedgerProvider>
    </ShopsProvider>
  );
}

function Gate() {
  const { status } = useAuth();

  // The theme has to be applied whether or not anyone is signed in, so the hook
  // lives above the gate rather than inside the signed-in tree.
  useTheme();

  if (status === 'loading') {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner label="Opening your ledger" />
      </div>
    );
  }

  if (status === 'signedIn') return <SignedInApp />;

  return <SignInPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
