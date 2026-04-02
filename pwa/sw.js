// ToneGuard PWA Service Worker — enables installability and share target
const CACHE_NAME = "toneguard-pwa-v1";
const ASSETS = [
  "/pwa/index.html",
  "/pwa/app.js",
  "/pwa/manifest.json",
  "/icons/icon48.png",
  "/icons/icon128.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
