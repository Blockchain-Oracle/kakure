import { PRICE_RELAY, SITE_ORIGIN } from "@/constants";

/**
 * React Native's WebSocket always sends an Origin header: Android adds the socket URL's own origin, and iOS's
 * SocketRocket does the same. The relay refuses unknown origins (it lets browsers in only from Kakure's own site,
 * and native clients that send none), so its own origin gets a 403. This shim gives relay sockets Kakure's site
 * origin, which the relay allows; every other socket is untouched. @kakure/feeds opens the socket itself, so this
 * runs before `configurePrices`.
 */
const relayHost = new URL(PRICE_RELAY).host;

type NativeSocket = new (
  url: string,
  protocols?: string | string[],
  options?: { headers?: Record<string, string> },
) => WebSocket;

const Base = globalThis.WebSocket as unknown as NativeSocket;

class RelaySocket extends Base {
  constructor(url: string, protocols?: string | string[], options?: { headers?: Record<string, string> }) {
    let host = "";
    try {
      host = new URL(url).host;
    } catch {
      host = "";
    }
    const headers = host === relayHost ? { ...options?.headers, origin: SITE_ORIGIN } : options?.headers;
    super(url, protocols, headers ? { ...options, headers } : options);
  }
}

globalThis.WebSocket = RelaySocket as unknown as typeof WebSocket;
