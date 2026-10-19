import { useEffect, useSyncExternalStore } from "react";
import { type PriceState, PriceStream } from "./client";
import type { StreamSymbol } from "./protocol";

let shared: PriceStream | null = null;

/**
 * Configures the one relay connection for this tab or app. Call once at the app root,
 * e.g. `configurePrices(process.env.NEXT_PUBLIC_PRICE_RELAY)`.
 */
export function configurePrices(relayOrigin: string): PriceStream {
  shared ??= new PriceStream(relayOrigin);
  return shared;
}

/** The configured stream (or `null` before `configurePrices`), for canvas code that reads ticks outside React. */
export function sharedPrices(): PriceStream | null {
  return shared;
}

const NOT_CONFIGURED: PriceState = { status: "connecting" };
const noop = () => {};

/** Live price for a symbol: `{ status: "connecting" | "live" | "stale" | "closed", price?, ts? }`. */
export function usePrice(symbol: StreamSymbol): PriceState {
  const stream = shared;
  useEffect(() => {
    stream?.start();
  }, [stream]);
  return useSyncExternalStore(
    (listener) => stream?.subscribe(symbol, listener) ?? noop,
    () => stream?.get(symbol) ?? NOT_CONFIGURED,
    () => NOT_CONFIGURED,
  );
}

/** Keeps the socket closed while the page is hidden (browser only). */
export function pauseWhenHidden(stream: PriceStream): () => void {
  const onVisibility = () => (document.hidden ? stream.stop() : stream.start());
  document.addEventListener("visibilitychange", onVisibility);
  return () => document.removeEventListener("visibilitychange", onVisibility);
}
