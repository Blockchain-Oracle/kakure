import { BARS_PATH, CANDLES_PATH, HEALTH_PATH, SNAPSHOT_PATH, STREAM_PATH } from "@kakure/feeds/protocol";
import { ALLOWED_ORIGINS, HTTP_FORBIDDEN, HTTP_NOT_FOUND, HTTP_UPGRADE_REQUIRED, HUB_NAME } from "./constants";

export { PriceHub } from "./hub";

interface Env {
  PRICE_HUB: DurableObjectNamespace;
}

const ORIGINS = new Set<string>(ALLOWED_ORIGINS);

/**
 * Kakure price relay. Observability is off in wrangler.jsonc and it reads no cookies. It never sees which market a
 * visitor is looking at, because everyone receives every symbol, live and as candles. The candle route alone reads
 * its query (`interval`, `count`, `end`), so it does learn which interval a chart shows and how far back it scrolls
 * (stated on /privacy).
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const origin = request.headers.get("origin");
    if (origin !== null && !ORIGINS.has(origin)) {
      return new Response("Forbidden", { status: HTTP_FORBIDDEN });
    }

    const hub = env.PRICE_HUB.get(env.PRICE_HUB.idFromName(HUB_NAME));
    if (pathname === STREAM_PATH) {
      if (request.headers.get("upgrade") !== "websocket") {
        return new Response("Expected a WebSocket upgrade", { status: HTTP_UPGRADE_REQUIRED });
      }
      return hub.fetch(request);
    }
    if (pathname === SNAPSHOT_PATH || pathname === HEALTH_PATH || pathname === BARS_PATH || pathname === CANDLES_PATH) {
      const response = await hub.fetch(request);
      const headers = new Headers(response.headers);
      if (pathname === SNAPSHOT_PATH) {
        headers.set("cache-control", "public, max-age=5");
      }
      if (origin !== null) {
        headers.set("access-control-allow-origin", origin);
      }
      return new Response(response.body, { status: response.status, headers });
    }
    return new Response("Not found", { status: HTTP_NOT_FOUND });
  },
} satisfies ExportedHandler<Env>;
