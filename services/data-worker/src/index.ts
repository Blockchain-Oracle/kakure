import {
  BASE_HEADERS,
  DATA_PREFIX,
  HTTP_METHOD_NOT_ALLOWED,
  HTTP_NOT_FOUND,
  HTTP_NOT_MODIFIED,
  IMMUTABLE_CACHE,
  KEY_PATTERN,
  LATEST_CACHE,
  LATEST_FILE,
} from "./constants";

interface Env {
  /** Signed public files pushed by the operator (bundles, address lists, resolution evidence). */
  DATA: R2Bucket;
  /** The static site export, once it exists (S04/S05). */
  ASSETS?: Fetcher;
}

/**
 * Serves Kakure's public data. It never reads cookies, query strings or request bodies,
 * and Workers observability is off in wrangler.jsonc, so nothing about a visitor is kept.
 * Market IDs live in URL fragments, which browsers never send, so every visitor fetches the same files.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, { status: HTTP_METHOD_NOT_ALLOWED, headers: { ...BASE_HEADERS, allow: "GET, HEAD" } });
    }

    const { pathname } = new URL(request.url);
    if (pathname.startsWith(DATA_PREFIX)) {
      return serveData(pathname.slice(DATA_PREFIX.length), request, env);
    }
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return notFound();
  },
} satisfies ExportedHandler<Env>;

async function serveData(key: string, request: Request, env: Env): Promise<Response> {
  if (!KEY_PATTERN.test(key)) {
    return notFound();
  }

  const object = await env.DATA.get(key, { onlyIf: request.headers });
  if (object === null) {
    return notFound();
  }

  const headers = new Headers(BASE_HEADERS);
  object.writeHttpMetadata(headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", key.endsWith(`/${LATEST_FILE}`) ? LATEST_CACHE : IMMUTABLE_CACHE);
  // Public, signed data: readable from the docs site and the app on any origin.
  headers.set("access-control-allow-origin", "*");
  headers.set("cross-origin-resource-policy", "cross-origin");

  // `onlyIf` returns metadata without a body when the client's ETag still matches.
  if (!("body" in object)) {
    return new Response(null, { status: HTTP_NOT_MODIFIED, headers });
  }
  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}

function notFound(): Response {
  return new Response("Not found", { status: HTTP_NOT_FOUND, headers: BASE_HEADERS });
}
