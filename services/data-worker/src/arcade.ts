import {
  ARCADE_MAX_BYTES,
  BASE_HEADERS,
  HTTP_BAD_GATEWAY,
  HTTP_METHOD_NOT_ALLOWED,
  HTTP_PAYLOAD_TOO_LARGE,
  HTTP_SERVICE_UNAVAILABLE,
} from "./constants";

/**
 * The arcade's door (plan §0 R4): `/arcade/v1/…` forwarded to the arcade service (services/arcade, on the Coolify
 * server) the way `relay.ts` forwards trades. It builds a fresh request with the method, the path (never a query) and,
 * for a POST, the JSON body, so no header of the visitor's reaches the service: not `CF-Connecting-IP`, not a cookie.
 * Same origin as the site, so the CSP needs no new host. It keeps nothing and never retries.
 */
export async function arcade(request: Request, origin: string | undefined): Promise<Response> {
  if (!origin) return plain("the arcade isn't open here", HTTP_SERVICE_UNAVAILABLE);
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response(null, { status: HTTP_METHOD_NOT_ALLOWED, headers: { ...BASE_HEADERS, allow: "GET, POST" } });
  }
  let body: ArrayBuffer | undefined;
  if (request.method === "POST") {
    if (Number(request.headers.get("content-length") ?? ARCADE_MAX_BYTES + 1) > ARCADE_MAX_BYTES) {
      return plain("too large", HTTP_PAYLOAD_TOO_LARGE);
    }
    body = await request.arrayBuffer();
    if (body.byteLength > ARCADE_MAX_BYTES) return plain("too large", HTTP_PAYLOAD_TOO_LARGE);
  }
  let upstream: Response;
  try {
    upstream = await fetch(`${origin.replace(/\/$/, "")}${new URL(request.url).pathname}`, {
      method: request.method,
      headers: body ? { "content-type": "application/json" } : {},
      ...(body ? { body } : {}),
      redirect: "manual",
    });
  } catch {
    return plain("the arcade is unreachable", HTTP_BAD_GATEWAY);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      ...BASE_HEADERS,
      "content-type": "application/json; charset=utf-8",
      "cache-control": upstream.headers.get("cache-control") ?? "no-store",
    },
  });
}

function plain(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { ...BASE_HEADERS, "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
