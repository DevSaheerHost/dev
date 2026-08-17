// PartMatch Service Worker v1.0
const CACHE = 'partmatch-v1';
const STATIC = ['/'];

// Install: cache shell
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC).catch(() => {}))
  );
});

// Activate: clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first for Firebase API, cache-first for static assets
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Always network for Firebase / Google APIs
  if (url.hostname.includes('firebase') ||
      url.hostname.includes('google') ||
      url.hostname.includes('googleapis') ||
      url.hostname.includes('identitytoolkit')) {
    return; // Let browser handle it
  }

  // For Google Fonts — cache-first
  if (url.hostname.includes('fonts.googleapis') || url.hostname.includes('fonts.gstatic')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        });
      })
    );
    return;
  }

  // For the app shell — stale-while-revalidate
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

// Push notification support (future use)
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
