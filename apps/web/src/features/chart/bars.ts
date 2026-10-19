import { fetchBars } from "@kakure/feeds/client";
import type { BarsResponse } from "@kakure/feeds/protocol";
import { PRICE_RELAY } from "@/constants";

/**
 * One bars request shared by every chart and sparkline on a page: the relay returns every symbol's history in one
 * file (PD19), so a page that shows ten markets still makes one request, and it reveals nothing about which.
 */
const BARS_TTL_MS = 30_000;
let cache: { at: number; promise: Promise<BarsResponse> } | null = null;

export function loadBars(): Promise<BarsResponse> {
  if (!cache || Date.now() - cache.at > BARS_TTL_MS) cache = { at: Date.now(), promise: fetchBars(PRICE_RELAY) };
  return cache.promise;
}
