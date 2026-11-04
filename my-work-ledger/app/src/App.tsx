/**
 * The application root.
 *
 * Routing is the URL hash, read and written directly. A router dependency buys
 * nothing here: there are three screens, no nested layouts and no data loading
 * tied to a route. The hash also survives the `file://`-style origin a
 * Capacitor WebView serves from, where path-based routing needs a server.
 */

import { useEffect, useState } from 'react';

import { AppShell, type Route } from '@/components/AppShell';
import { Spinner } from '@/components/ui';
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider';
import { SignInPage } from '@/features/auth/SignInPage';
import { ShopsProvider } from '@/features/shops/ShopsProvider';
import { ShopsPage } from '@/features/shops/ShopsPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { useTheme } from '@/hooks/useTheme';

const ROUTES: readonly Route[] = ['dashboard', 'shops', 'settings'];

function readRoute(): Route {
  const candidate = window.location.hash.replace(/^#\/?/, '');
  return ROUTES.find((route) => route === candidate) ?? 'dashboard';
}

function useHashRoute(): [Route, (next: Route) => void] {
  const [route, setRoute] = useState<Route>(readRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Writing the hash fires `hashchange`, which updates the state above, so the
  // URL stays the single source of truth and the back button works.
  const navigate = (next: Route) => {
    window.location.hash = `#/${next}`;
  };

  return [route, navigate];
}

function SignedInApp() {
  const [route, navigate] = useHashRoute();

  return (
    <ShopsProvider>
      <AppShell route={route} onNavigate={navigate}>
        {route === 'dashboard' ? <DashboardPage /> : null}
        {route === 'shops' ? <ShopsPage /> : null}
        {route === 'settings' ? <SettingsPage /> : null}
      </AppShell>
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
