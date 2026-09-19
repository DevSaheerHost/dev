/*
 * TransferBox service worker.
 *
 * Strategy:
 *   - navigations: network first, falling back to the cached shell, so an
 *     offline launch still opens the app
 *   - same-origin static assets: cache first, since Vite gives every build a
 *     new hashed filename and a cached one can never be stale
 *   - everything else (Firebase, Storage): straight to the network, never
 *     cached — stale workspace data would be worse than no data
 *
 * Written by hand rather than generated: the whole policy is fifty lines and
 * carries no build-time dependency.
 */

const VERSION = 'v1';
const SHELL_CACHE = `transferbox-shell-${VERSION}`;
const ASSET_CACHE = `transferbox-assets-${VERSION}`;
const SHELL_URL = './index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll([SHELL_URL, './manifest.webmanifest']))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== ASSET_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(SHELL_CACHE).then((cache) => cache.put(SHELL_URL, copy));
          return response;
        })
        .catch(() => caches.match(SHELL_URL).then((cached) => cached ?? Response.error())),
    );
    return;
  }

  if (/\.(?:js|css|woff2?|png|svg|webmanifest)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            const copy = response.clone();
            void caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
  }
});
