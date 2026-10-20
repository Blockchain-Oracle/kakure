import type { Network } from "@kakure/domain";
import {
  BASE_HEADERS,
  HTTP_BAD_GATEWAY,
  HTTP_METHOD_NOT_ALLOWED,
  HTTP_PAYLOAD_TOO_LARGE,
  HTTP_SERVICE_UNAVAILABLE,
  HTTP_UNSUPPORTED_MEDIA_TYPE,
  OHTTP_MAX_BYTES,
  OHTTP_REQUEST_TYPE,
  OHTTP_RESPONSE_TYPE,
  PROBLEM_TYPE,
} from "./constants";

/**
 * The Oblivious HTTP relay (RFC 9458 §6.2; plan §00), modelled on cloudflare/privacy-gateway-relay. It forwards a
 * client's encrypted request to the network's operator gateway and the encrypted answer back, and nothing else:
 *
 * - it builds a fresh request carrying only `content-type: message/ohttp-req`, so no client header (and no
 *   `CF-Connecting-IP`, `X-Forwarded-For` or cookie) ever reaches the gateway;
 * - it can't read either message (HPKE to the gateway's key, published in the signed bundle);
 * - it keeps nothing: Workers observability is off and nothing here logs;
 * - it never retries (§6.5): a failed relay answers 502 and the client decides.
 *
 * What it does learn: the client's IP, when it trades, and which network's operator (the path). The operator learns
 * the trade but never the IP. Kakure runs both hops, so that split rests on Kakure not combining them (stated on
 * /privacy); Tor is recommended for more.
 */
export async function relay(request: Request, network: Network, gateway: string | undefined): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(null, { status: HTTP_METHOD_NOT_ALLOWED, headers: { ...BASE_HEADERS, allow: "POST" } });
  }
  if (!gateway) return plain(`no gateway for ${network}`, HTTP_SERVICE_UNAVAILABLE);
  if (request.headers.get("content-type") !== OHTTP_REQUEST_TYPE) {
    return plain("expected message/ohttp-req", HTTP_UNSUPPORTED_MEDIA_TYPE);
  }
  if (Number(request.headers.get("content-length") ?? OHTTP_MAX_BYTES + 1) > OHTTP_MAX_BYTES) {
    return plain("too large", HTTP_PAYLOAD_TOO_LARGE);
  }
  const body = await request.arrayBuffer();
  if (body.byteLength > OHTTP_MAX_BYTES) return plain("too large", HTTP_PAYLOAD_TOO_LARGE);

  let upstream: Response;
  try {
    upstream = await fetch(gateway, {
      method: "POST",
      headers: { "content-type": OHTTP_REQUEST_TYPE },
      body,
      // Workers support "follow" and "manual" only; never follow a redirect away from the gateway.
      redirect: "manual",
    });
  } catch {
    return plain("gateway unreachable", HTTP_BAD_GATEWAY);
  }
  const type = upstream.headers.get("content-type");
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      ...BASE_HEADERS,
      "content-type": type === OHTTP_RESPONSE_TYPE || type === PROBLEM_TYPE ? type : "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function plain(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { ...BASE_HEADERS, "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
