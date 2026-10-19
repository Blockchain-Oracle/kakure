import { type Market, MIN_TICKETS_PER_SIDE, payoutZat, ZATOSHI_PER_ZEC, zatToZec } from "@kakure/domain";
import type { PillTone } from "@kakure/ui-web";
import { formatWhen } from "@/lib/time";

/** Plain-words views of a market for cards and the detail page. Nothing here invents a number. */

export const WINDOW_LABEL: Record<Market["window"], string> = {
  "1h": "Hourly",
  "1d": "Daily",
  session: "NYSE session",
  event: "Event",
};

const SIDE_WORD: Record<string, string> = { U: "Up", D: "Down", Y: "Yes", N: "No" };
const SIDE_SIGN: Record<string, string> = { U: "▲", D: "▼", Y: "✓", N: "✕" };

export function sideWord(side: string): string {
  return SIDE_WORD[side] ?? side;
}

/** Betting is open on the operator's word and before the cutoff on the clock (the bundle can be minutes old). */
export function isBettable(market: Market, now: number): boolean {
  return (market.state === "open" || market.state === "closing") && now < Date.parse(market.cutoffAt);
}

export function statePill(market: Market, now: number): { label: string; tone: PillTone; pulse?: boolean } {
  const cutoff = Date.parse(market.cutoffAt);
  switch (market.state) {
    case "scheduled":
      return { label: `Opens ${formatWhen(market.opensAt, now)}`, tone: "neutral" };
    case "open":
    case "closing":
      if (now >= cutoff) return { label: "Betting closed", tone: "quiet" };
      return market.state === "closing"
        ? { label: "Closing", tone: "warn", pulse: true }
        : { label: "Open", tone: "neutral", pulse: true };
    case "closed":
      return { label: "Betting closed", tone: "quiet" };
    case "resolving":
      return { label: "Resolving", tone: "neutral", pulse: true };
    case "resolved":
    case "paid": {
      const suffix = market.state === "paid" ? " · paid" : "";
      if (!market.outcome) return { label: `Resolved${suffix}`, tone: "neutral" };
      if (market.outcome === "refund") return { label: `Refunded${suffix}`, tone: "warn" };
      const up = market.outcome === "U" || market.outcome === "Y";
      return {
        label: `${SIDE_SIGN[market.outcome] ?? ""} ${sideWord(market.outcome)}${suffix}`,
        tone: up ? "up" : "down",
      };
    }
    case "refunding":
      return { label: "Refunding", tone: "warn" };
  }
}

/** The two sides in display order for this market kind. */
export function sidesOf(market: Pick<Market, "kind">): readonly [string, string] {
  return market.kind === "event" ? ["Y", "N"] : ["U", "D"];
}

export interface SideOdds {
  side: string;
  word: string;
  sign: string;
  tickets: number;
  zat: bigint;
  /** Share of the pool, whole percent. */
  percent: number;
  /** What a 1 ZEC ticket would pay at these totals, e.g. "1.62×"; null when a side is empty. */
  multiple: string | null;
}

const PERCENT = 100n;
const MULTIPLE_DECIMALS = 2;

/** Odds as of the last release; null while sealed (D3: never a 0 % or a made-up split). */
export function releasedOdds(market: Market): { seq: number; sides: [SideOdds, SideOdds] } | null {
  if (market.sealed || !market.released) return null;
  const [a, b] = sidesOf(market);
  const pool = (side: string) => market.released?.sides[side as keyof typeof market.released.sides];
  const za = BigInt(pool(a)?.zat ?? "0");
  const zb = BigInt(pool(b)?.zat ?? "0");
  const total = za + zb;
  const view = (side: string, mine: bigint, other: bigint): SideOdds => ({
    side,
    word: sideWord(side),
    sign: SIDE_SIGN[side] ?? "",
    tickets: pool(side)?.tickets ?? 0,
    zat: mine,
    percent: total > 0n ? Number((mine * PERCENT + total / 2n) / total) : 0,
    multiple:
      mine > 0n && other > 0n
        ? `${(Number(payoutZat(ZATOSHI_PER_ZEC, mine, other)) / Number(ZATOSHI_PER_ZEC)).toFixed(MULTIPLE_DECIMALS)}×`
        : null,
  });
  return { seq: market.released.seq, sides: [view(a, za, zb), view(b, zb, za)] };
}

/** "0.35 ZEC" on mainnet, "0.35 TAZ" on testnet. */
export function coinAmount(zat: bigint, coin: string): string {
  return `${zatToZec(zat)} ${coin}`;
}

export function ticketsWord(count: number): string {
  return `${count} ${count === 1 ? "ticket" : "tickets"}`;
}

const hourFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });

/**
 * A short title for cards: "BTC Up or Down · 19:00–20:00" (local time). The signed question in `rules` stays the
 * authority and is shown in full on the market page (D13).
 */
export function shortTitle(market: Market, symbol: string): string {
  if (market.kind === "event") return market.rules.question;
  const opens = new Date(market.opensAt);
  const closes = new Date(market.closesAt);
  const span =
    market.window === "1h"
      ? `${hourFormat.format(opens)}–${hourFormat.format(closes)}`
      : dayFormat.format(market.window === "1d" ? opens : closes);
  return `${symbol} Up or Down · ${span}`;
}

/** "Sealed · 4 tickets · odds open at 3 a side" (C5, D3). */
export function sealedLine(market: Market): string {
  return `Sealed · ${ticketsWord(market.ticketCount)} · odds open at ${MIN_TICKETS_PER_SIDE} a side`;
}

/**
 * The price a close market is judged against: its strike, or the opening print (Coinbase's, else the venues'
 * median). `null` until the opening is fixed. Event markets have none.
 */
export function referencePrice(market: Market): number | null {
  if (market.strike) return Number(market.strike);
  const opening = market.opening ?? {};
  if (opening.coinbase) return Number(opening.coinbase);
  const values = Object.values(opening)
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)] ?? null;
}
