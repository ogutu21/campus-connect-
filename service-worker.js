/* CampusConnect service worker
   - App shell is precached so the whole app opens offline.
   - Same-origin files: network-first (updates always arrive), cache fallback.
   - Firebase SDK, Font Awesome and fonts: stale-while-revalidate runtime cache.
   - Firestore/Auth API traffic is never touched (Firestore has its own offline cache).
*/
const VERSION = "campusconnect-v12";
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./offline.html",
  "./style.css",
  "./script.js",
  "./campus.js",
  "./manifest.json",
  "./icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png"
];

const FIREBASE_VERSION = "12.19.0";
const CDN_PRECACHE = [
  `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`,
  `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`,
  `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`,
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css"
];

const CACHEABLE_HOSTS = [
  "www.gstatic.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdnjs.cloudflare.com"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(APP_SHELL);

    const runtime = await caches.open(RUNTIME_CACHE);
    await Promise.allSettled(
      CDN_PRECACHE.map(url =>
        fetch(url, { mode: "cors" }).then(r => (r.ok ? runtime.put(url, r) : null))
      )
    );
  })());
  // No automatic skipWaiting: the page shows an "Update available" banner and sends SKIP_WAITING.
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keep = [SHELL_CACHE, RUNTIME_CACHE];
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !keep.includes(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
  });
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const response = await withTimeout(fetch(request), 4000);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = (await cache.match(request, { ignoreSearch: true })) || (await caches.match(request, { ignoreSearch: true }));
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await caches.match(fallbackUrl);
      if (fallback) return fallback;
    }
    return Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);

  const refresh = fetch(request)
    .then(response => {
      if (response && (response.ok || response.type === "opaque")) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  return cached || (await refresh) || Response.error();
}

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (request.mode === "navigate") {
      event.respondWith(
        networkFirst(request, SHELL_CACHE, "./index.html").then(async response => {
          if (response && response.type !== "error") return response;
          return (await caches.match("./offline.html")) || response;
        })
      );
      return;
    }

    event.respondWith(networkFirst(request, SHELL_CACHE));
    return;
  }

  if (CACHEABLE_HOSTS.includes(url.hostname) &&
      (url.hostname !== "www.gstatic.com" || url.pathname.startsWith("/firebasejs/"))) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

// Tapping a reminder notification focuses an open CampusConnect window, or opens the app.
self.addEventListener("notificationclick", event => {
  event.notification.close();

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);

    if (existing) return existing.focus();

    return self.clients.openWindow("./");
  })());
});

self.addEventListener("message", event => {
  const data = event.data || {};

  if (data.type === "CACHE_URLS" && Array.isArray(data.urls)) {
    event.waitUntil((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      await Promise.allSettled(
        data.urls.slice(0, 80).map(async raw => {
          try {
            const url = new URL(raw);
            const ok = CACHEABLE_HOSTS.includes(url.hostname) &&
              (url.hostname !== "www.gstatic.com" || url.pathname.startsWith("/firebasejs/"));
            if (!ok) return;
            if (await cache.match(raw)) return;
            const response = await fetch(raw, { mode: url.hostname === "fonts.googleapis.com" ? "no-cors" : "cors" });
            if (response.ok || response.type === "opaque") await cache.put(raw, response);
          } catch { /* best effort */ }
        })
      );
    })());
  }

  if (data.type === "SKIP_WAITING") self.skipWaiting();
});
