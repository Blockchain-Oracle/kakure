import type { Network } from "@kakure/domain";
import {
  BASE_HEADERS,
  CONTENT_SECURITY_POLICY,
  DATA_PREFIX,
  HTTP_BAD_REQUEST,
  HTTP_CONFLICT,
  HTTP_CREATED,
  HTTP_FORBIDDEN,
  HTTP_METHOD_NOT_ALLOWED,
  HTTP_NOT_FOUND,
  HTTP_NOT_MODIFIED,
  HTTP_OK,
  HTTP_PAYLOAD_TOO_LARGE,
  HTTP_PRECONDITION_FAILED,
  IMMUTABLE_CACHE,
  KEY_PATTERN,
  LATEST_CACHE,
  LATEST_FILE,
  NEXT_STATIC_PREFIX,
  PERMISSIONS_POLICY,
  PUSH_MAX_BYTES,
} from "./constants";
import { checkPush } from "./push";
import type { DataStore, WriteResult } from "./store";

export { DataStore } from "./store";

interface Env {
  /** Signed public files pushed by the operator (bundles, address lists, resolutions, history), one object per network. */
  STORE: DurableObjectNamespace<DataStore>;
  /** The static site export (apps/web/out). */
  ASSETS?: Fetcher;
}

/**
 * Serves Kakure's public data and site. It never reads cookies or query strings, and Workers observability is off
 * in wrangler.jsonc, so nothing about a visitor is kept. Market IDs live in URL fragments, which browsers never send,
 * so every visitor fetches the same files. The only request body it reads is the operator's push (PUT /data/…),
 * which is kept only when it is a document signed with the operator key pinned for that network.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith(DATA_PREFIX)) {
      const key = pathname.slice(DATA_PREFIX.length);
      if (!KEY_PATTERN.test(key)) return notFound();
      const [network, name] = key.split("/") as [Network, string];
      const store = env.STORE.get(env.STORE.idFromName(network));
      if (request.method === "GET" || request.method === "HEAD") return serveData(store, name, request);
      if (request.method === "PUT") return acceptPush(store, network, name, request);
      return methodNotAllowed("GET, HEAD, PUT");
    }
    if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET, HEAD");
    if (env.ASSETS) return withPageHeaders(await env.ASSETS.fetch(request), pathname);
    return notFound();
  },
} satisfies ExportedHandler<Env>;

async function serveData(store: DurableObjectStub<DataStore>, name: string, request: Request): Promise<Response> {
  const file = await store.read(name);
  if (file === null) return notFound();

  const etag = `"${file.sha256}"`;
  const headers = new Headers(BASE_HEADERS);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("etag", etag);
  headers.set("cache-control", name === LATEST_FILE ? LATEST_CACHE : IMMUTABLE_CACHE);
  // Public, signed data: readable from the docs site and the app on any origin.
  headers.set("access-control-allow-origin", "*");
  headers.set("cross-origin-resource-policy", "cross-origin");

  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: HTTP_NOT_MODIFIED, headers });
  return new Response(request.method === "HEAD" ? null : file.body, { headers });
}

const PUSH_STATUS: Readonly<Record<WriteResult, number>> = {
  stored: HTTP_CREATED,
  unchanged: HTTP_OK,
  conflict: HTTP_CONFLICT,
  stale: HTTP_CONFLICT,
  missing: HTTP_PRECONDITION_FAILED,
};

async function acceptPush(
  store: DurableObjectStub<DataStore>,
  network: Network,
  name: string,
  request: Request,
): Promise<Response> {
  if (Number(request.headers.get("content-length") ?? PUSH_MAX_BYTES + 1) > PUSH_MAX_BYTES) {
    return text("too large", HTTP_PAYLOAD_TOO_LARGE);
  }
  const body = await request.arrayBuffer();
  if (body.byteLength > PUSH_MAX_BYTES) return text("too large", HTTP_PAYLOAD_TOO_LARGE);

  const check = await checkPush(network, name, body);
  if (!check.ok) return text(check.reason, check.reason === "malformed" ? HTTP_BAD_REQUEST : HTTP_FORBIDDEN);
  const result = await store.write(check.file);
  return text(result, PUSH_STATUS[result]);
}

/** Security headers on every static asset; the CSP and Permissions-Policy on HTML pages; hashed files cached for good. */
function withPageHeaders(response: Response, pathname: string): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(BASE_HEADERS)) {
    headers.set(name, value);
  }
  if (response.ok && pathname.startsWith(NEXT_STATIC_PREFIX)) headers.set("cache-control", IMMUTABLE_CACHE);
  if ((headers.get("content-type") ?? "").includes("text/html")) {
    headers.set("content-security-policy", CONTENT_SECURITY_POLICY);
    headers.set("permissions-policy", PERMISSIONS_POLICY);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { ...BASE_HEADERS, "content-type": "text/plain; charset=utf-8" } });
}

function methodNotAllowed(allow: string): Response {
  return new Response(null, { status: HTTP_METHOD_NOT_ALLOWED, headers: { ...BASE_HEADERS, allow } });
}

function notFound(): Response {
  return text("Not found", HTTP_NOT_FOUND);
}
