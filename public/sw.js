const CACHE = "imv-v2";
const PRECACHE = ["/", "/manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);

  // Never intercept API routes or non-page requests
  if (url.pathname.startsWith("/api/")) return;
  if (!url.pathname.startsWith("/") || url.pathname.includes(".")) {
    // Static asset: cache-first
    if (url.origin === self.location.origin) {
      e.respondWith(
        caches.match(e.request).then((cached) => {
          if (cached) return cached;
          return fetch(e.request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE).then((c) => c.put(e.request, clone));
            }
            return response;
          }).catch(() => cached);
        })
      );
    }
    return;
  }

  // Navigation: network-first with cache fallback
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});
