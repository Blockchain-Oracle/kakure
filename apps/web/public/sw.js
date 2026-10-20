/*
 * Kakure's service worker (plan §2): offline use, and the same requests from every visitor.
 *
 * - On install, for every visitor: every built script, style and the address checker's WebAssembly, plus the
 *   fonts the pages preload (scripts/precache.mjs fills in the list after `next build`). So opening a market, the
 *   bet sheet or the portfolio fetches nothing that depends on what you look at (O7). Asset marks need no request
 *   at all: they're an inline sprite in every page.
 * - Pages: network first, then the cached copy, so the app opens offline with its last data.
 * - Built assets (/_next/static) and the games' sounds: cache first; they never change within a build.
 * - The arcade's API (/arcade/) and the relay (/ohttp/): never touched, so no board or seed is ever kept here.
 * - /data/<network>/latest.json: the cached copy while it is fresher than the edge cache (20 s), else the network.
 *   Bundles and address lists are immutable: cache first.
 * - On each app start the page asks for a prefetch: this worker loads latest.json, its bundle and its address list
 *   for BOTH networks, whichever one you use, so the host sees the same requests from every visitor (PD14) and
 *   nothing about which network or market you look at. The app also polls both networks on the same clock (O8).
 * - The data cache keeps only what the app can use: each network's two newest bundles (the one on screen and the one
 *   before it, for the chain check) and its last day of prints files. Every older bundle goes, so the cache is never a
 *   minute-by-minute log of when this device had the app open (privacy re-audit V8).
 */
const PRECACHE = self.__KAKURE_PRECACHE__ ?? [];
const BUILD = self.__KAKURE_BUILD__ ?? "dev";
const PREFIX = "kakure-sw-v1";
const SHELL_CACHE = `${PREFIX}-shell-${BUILD}`;
const DATA_CACHE = `${PREFIX}-data`;
const NETWORKS = ["testnet", "mainnet"];
const LATEST_FRESH_MS = 20000;
const PREFETCH_EVERY_MS = 60000;
const FETCHED_AT = "x-kakure-fetched-at";
const NOT_FOUND = 404;
const IMMUTABLE = /^\/_next\/static\/|^\/sounds\/[a-z-]+\.mp3$/;
/** The arcade's API (boards, seeds, scores) is live and per request: never cached, never answered offline. */
const PASS_THROUGH = /^\/(arcade|ohttp)\//;
const DATA = /^\/data\/(mainnet|testnet)\/[a-z0-9][a-z0-9._-]*\.json$/;
const SERIES = /^\/data\/(mainnet|testnet)\/(bundle|prints)-(\d+)\.json$/;
const KEEP = { bundle: 2, prints: 25 };
let lastPrefetch = 0;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // One file failing (a deploy mid-install) shouldn't block the worker; it's fetched on first use instead.
      await Promise.allSettled(PRECACHE.map((path) => cache.add(path)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name !== SHELL_CACHE && name !== DATA_CACHE) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

async function stamp(response) {
  const headers = new Headers(response.headers);
  headers.set(FETCHED_AT, String(Date.now()));
  return new Response(await response.blob(), { status: response.status, statusText: response.statusText, headers });
}

async function latest(request) {
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(request);
  const age = cached ? Date.now() - Number(cached.headers.get(FETCHED_AT) ?? 0) : Number.POSITIVE_INFINITY;
  if (cached && age < LATEST_FRESH_MS) return cached;
  try {
    const response = await fetch(request);
    if (response.ok || response.status === NOT_FOUND) await cache.put(request, await stamp(response.clone()));
    return response;
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    if (cacheName === DATA_CACHE) await trimData(cache);
  }
  return response;
}

/** Keeps each network's newest bundles and prints files (`KEEP`), dropping the rest. */
async function trimData(cache) {
  const groups = new Map();
  for (const request of await cache.keys()) {
    const match = SERIES.exec(new URL(request.url).pathname);
    if (!match) continue;
    const key = `${match[1]}:${match[2]}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ request, n: Number(match[3]) });
  }
  for (const [key, items] of groups) {
    items.sort((a, b) => b.n - a.n);
    for (const item of items.slice(KEEP[key.split(":")[1]])) await cache.delete(item.request);
  }
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = (await cache.match(request, { ignoreSearch: true })) ?? (await cache.match("/markets"));
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || PASS_THROUGH.test(url.pathname)) return;
  if (DATA.test(url.pathname)) {
    event.respondWith(url.pathname.endsWith("/latest.json") ? latest(request) : cacheFirst(request, DATA_CACHE));
  } else if (IMMUTABLE.test(url.pathname)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
  } else {
    event.respondWith(networkFirst(request));
  }
});

async function json(response) {
  try {
    return response.ok ? await response.clone().json() : null;
  } catch {
    return null;
  }
}

async function prefetch() {
  if (Date.now() - lastPrefetch < PREFETCH_EVERY_MS) return;
  lastPrefetch = Date.now();
  for (const network of NETWORKS) {
    try {
      const pointer = await json(await latest(new Request(`/data/${network}/latest.json`)));
      if (!pointer?.bundle) continue;
      const bundle = await json(await cacheFirst(new Request(`/data/${network}/${pointer.bundle}`), DATA_CACHE));
      if (bundle?.addresses) await cacheFirst(new Request(`/data/${network}/${bundle.addresses}`), DATA_CACHE);
    } catch {
      // Offline or nothing published: the app shows its own state.
    }
  }
}

self.addEventListener("message", (event) => {
  if (event.data?.type === "prefetch") event.waitUntil(prefetch());
});
