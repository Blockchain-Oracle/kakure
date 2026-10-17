/*
 * The docs' service worker, so the docs and their search keep working offline after the first visit.
 * scripts/offline.mjs copies this file to out/sw.js after `next build`, filling in PAGES, ASSETS and VERSION.
 *
 * - On install: every page, the scripts, styles and fonts they load, the search engine chunk and the search index
 *   (/api/search, the static index the search dialog loads), so any page opens, hydrates and searches offline.
 * - Built assets (/_next/static): cache first; they are content-hashed and never change. Chunks loaded later
 *   (the Mermaid renderer on System maps) are kept once fetched.
 * - Everything else, GET or HEAD (pages are also probed with HEAD requests): network first, then the cache.
 */
const PAGES = self.__KAKURE_DOCS_PAGES__;
const ASSETS = self.__KAKURE_DOCS_ASSETS__;
const CACHE = `kakure-docs-${self.__KAKURE_DOCS_VERSION__}`;
const SEARCH_INDEX = "/api/search";
const IMMUTABLE = /^\/_next\/static\//;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([...PAGES, ...ASSETS, SEARCH_INDEX]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("kakure-docs-") && name !== CACHE) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && request.method === "GET") await cache.put(request, response.clone());
    return response;
  } catch (error) {
    // Client navigations add a ?_rsc= cache-buster; the payload itself is the same file.
    const cached =
      (await cache.match(request, { ignoreMethod: true })) ??
      (await cache.match(request, { ignoreMethod: true, ignoreSearch: true }));
    if (!cached) throw error;
    return request.method === "HEAD" ? new Response(null, { status: cached.status, headers: cached.headers }) : cached;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" && request.method !== "HEAD") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const immutable = request.method === "GET" && IMMUTABLE.test(url.pathname);
  event.respondWith(immutable ? cacheFirst(request) : networkFirst(request));
});
