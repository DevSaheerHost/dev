/* StockPilot service worker.
 * - API responses are never cached (always live, always authorized).
 * - Hashed static assets: cache-first.
 * - Only the audit screens are cached for offline use (they render no
 *   business data server-side); everything else falls back to /offline.
 * - Background Sync and push notifications.
 */
const VERSION = "sp-v1";
const STATIC = `${VERSION}-static`;
const PAGES = `${VERSION}-pages`;
const OFFLINE_PAGES = ["/voice", "/photo", "/more"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(PAGES).then((c) => c.addAll(["/offline", "/icons/icon-192.png"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      }),
    );
    return;
  }

  if (request.mode === "navigate") {
    const cacheable = OFFLINE_PAGES.includes(url.pathname);
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (cacheable && res.ok && !res.redirected) caches.open(PAGES).then((c) => c.put(url.pathname, res.clone()));
          return res;
        })
        .catch(async () => (cacheable && (await caches.match(url.pathname))) || (await caches.match("/offline")) || Response.error()),
    );
  }
});

// Background Sync: ask open pages to flush their IndexedDB queue (they hold the session).
self.addEventListener("sync", (event) => {
  if (event.tag !== "sp-sync") return;
  event.waitUntil(self.clients.matchAll({ type: "window" }).then((clients) => clients.forEach((c) => c.postMessage({ type: "sp-sync" }))));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "sp-clear-cache") event.waitUntil(caches.delete(PAGES));
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = typeof data.title === "string" ? data.title.slice(0, 120) : "StockPilot";
  const body = typeof data.body === "string" ? data.body.slice(0, 300) : "";
  const target = typeof data.url === "string" && data.url.startsWith("/") && !data.url.startsWith("//") ? data.url : "/notifications";
  event.waitUntil(self.registration.showNotification(title, { body, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data: { url: target } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/notifications";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const c of clients) if ("focus" in c) { c.navigate(target); return c.focus(); }
      return self.clients.openWindow(target);
    }),
  );
});
