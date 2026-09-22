// Hand-rolled service worker (no next-pwa/workbox — this project builds with
// Turbopack, whose hashed asset filenames aren't known at write time, so a
// build-time precache manifest isn't available here). Strategy:
//   1. Precache the few assets whose URLs are stable and known ahead of
//      time: the app shell document, the knowledge base, the manifest, icons.
//   2. Everything else same-origin (including hashed /_next/static/* chunks)
//      is cached opportunistically the first time it's fetched successfully
//      (network-first, cache as a fallback) — so after one successful visit,
//      every asset that page actually loaded is available offline too.
//   3. /api/* is never touched — /api/ask needs live answers and /api/health
//      must stay a real connectivity probe, not a cached response.

const CACHE_VERSION = "v1";
const CACHE_NAME = `electionhelp-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  "/",
  "/manifest.json",
  "/knowledge-base.json",
  "/favicon.ico",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const shell = await cache.match("/");
      if (shell) return shell;
    }
    throw new Error("Offline and no cached response available.");
  }
}
