import { useEffect, useState } from 'react';

export type RouteName = 'home' | 'history' | 'transfer' | 'workspace' | 'settings';

export interface Route {
  name: RouteName;
  params: URLSearchParams;
}

const ROUTES: RouteName[] = ['home', 'history', 'transfer', 'workspace', 'settings'];

function parse(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [path = '', queryText = ''] = raw.split('?');
  const name = ROUTES.find((route) => route === path) ?? 'home';
  return { name, params: new URLSearchParams(queryText) };
}

/**
 * Hash routing keeps the app deployable as static files anywhere, and keeps a
 * shared workspace secret in the fragment, which browsers never send to a
 * server.
 */
export function useHashRoute(): [Route, (name: RouteName, params?: Record<string, string>) => void] {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = (name: RouteName, params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params).toString()}` : '';
    window.location.hash = `#/${name}${query}`;
  };

  return [route, navigate];
}
