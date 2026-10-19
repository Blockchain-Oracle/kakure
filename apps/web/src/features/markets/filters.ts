import type { Market } from "@kakure/domain";
import { CLOSING_SOON_MS } from "@/constants";
import { assetFor } from "./assets";
import type { Category } from "./category-store";
import { isBettable } from "./market-view";

export type WindowFilter = "all" | "1h" | "1d";

export interface MarketFilters {
  category: Category;
  window: WindowFilter;
  closingSoon: boolean;
  query: string;
}

/** Open markets first (soonest cutoff first), then scheduled, then everything already past betting. */
function rank(market: Market, now: number): number {
  if (isBettable(market, now)) return 0;
  if (market.state === "scheduled") return 1;
  return 2;
}

export function matchesQuery(market: Market, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const asset = assetFor(market);
  return [asset.symbol, asset.name, market.subject, market.rules.question].some((text) =>
    text.toLowerCase().includes(q),
  );
}

export function closesSoon(market: Market, now: number): boolean {
  return isBettable(market, now) && Date.parse(market.cutoffAt) - now <= CLOSING_SOON_MS;
}

export function filterMarkets(markets: readonly Market[], filters: MarketFilters, now: number): Market[] {
  return markets
    .filter((market) => assetFor(market).category === filters.category)
    .filter((market) => filters.window === "all" || market.window === filters.window)
    .filter((market) => !filters.closingSoon || closesSoon(market, now))
    .filter((market) => matchesQuery(market, filters.query))
    .sort((a, b) => rank(a, now) - rank(b, now) || Date.parse(a.cutoffAt) - Date.parse(b.cutoffAt));
}

/**
 * Lanes (plan §0 R2: by cadence, never by date): what a market is, not when. Hourly and Daily hold the crypto and
 * ZEC Up/Down windows, Range the strike ladders, Stocks the NYSE markets, Zcash everything Zcash-native (ZEC and
 * chain events), Resolved whatever has finished.
 */
export const LANES = ["hourly", "daily", "range", "stocks", "zcash", "resolved"] as const;
export type Lane = (typeof LANES)[number];
export const LANE_LABEL: Record<Lane, string> = {
  hourly: "Hourly",
  daily: "Daily",
  range: "Range",
  stocks: "Stocks",
  zcash: "Zcash",
  resolved: "Resolved",
};

const LIVE = new Set<Market["state"]>(["scheduled", "open", "closing"]);

export function isLane(value: string): value is Lane {
  return (LANES as readonly string[]).includes(value);
}

export function inLane(market: Market, lane: Lane): boolean {
  const category = assetFor(market).category;
  const live = LIVE.has(market.state);
  const plain = market.kind === "close" && !market.strike && category !== "stocks";
  switch (lane) {
    case "hourly":
      return live && plain && market.window === "1h";
    case "daily":
      return live && plain && market.window === "1d";
    case "range":
      return live && Boolean(market.strike);
    case "stocks":
      return live && category === "stocks";
    case "zcash":
      return live && category === "zcash";
    case "resolved":
      return !live;
  }
}

/** The markets in a lane, open ones first (soonest cutoff first), then upcoming, then finished (newest first). */
export function laneMarkets(markets: readonly Market[], lane: Lane, query: string, closingSoon: boolean, now: number) {
  return markets
    .filter((market) => inLane(market, lane))
    .filter((market) => !closingSoon || closesSoon(market, now))
    .filter((market) => matchesQuery(market, query))
    .sort((a, b) =>
      lane === "resolved"
        ? Date.parse(b.closesAt) - Date.parse(a.closesAt)
        : rank(a, now) - rank(b, now) || Date.parse(a.cutoffAt) - Date.parse(b.cutoffAt),
    );
}

/** Open-market counts per tab, for the tab labels. */
export function openCounts(markets: readonly Market[], now: number): Record<Category, number> {
  const counts: Record<Category, number> = { crypto: 0, stocks: 0, zcash: 0 };
  for (const market of markets) {
    if (isBettable(market, now)) counts[assetFor(market).category] += 1;
  }
  return counts;
}
