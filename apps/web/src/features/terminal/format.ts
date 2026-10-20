import { PRICE_SCALE_E4, ZATOSHI_PER_ZEC } from "@kakure/domain";
import { CENTS_PER_UNIT, MONEY_MAGNITUDES } from "./constants";

/**
 * The terminal's numbers (Owarine `terminal/format.ts`). Amounts are ZEC (TAZ on testnet) from zatoshi; a live PnL
 * keeps Tradash's magnitude decimals so a small one still moves.
 */
const ZAT_PER_ZEC = Number(ZATOSHI_PER_ZEC);
const MINUTE = 60;
const HOUR = 3_600;
const PAD = 2;
const MULTIPLE_WHOLE_FROM = 10;
const SECOND_MS = 1000;
const SMALL_DECIMALS = 4;
const PRECISION = 12;
const DECIMAL_BASE = 10;
/** Zatoshi shown as ZEC: 8 decimals at most, trailing zeros dropped. */
const ZEC_DECIMALS = 8;
const MIN_ZEC_DECIMALS = 2;

export const zatToNumber = (zat: number | bigint): number => Number(zat) / ZAT_PER_ZEC;

/** Tradash's magnitude rule: 4 under 10, 3 under 1,000, 2 above. */
export function moneyDecimals(value: number): number {
  const a = Math.abs(value);
  for (const [floor, decimals] of MONEY_MAGNITUDES) if (a >= floor) return decimals;
  return SMALL_DECIMALS;
}

/** `|value|` at `dp` decimals, rounding half up on the decimal value the screen shows. */
export function fixedText(value: number, dp: number): string {
  const scaled = Number((Math.abs(value) * DECIMAL_BASE ** dp).toPrecision(PRECISION));
  return (Math.round(scaled) / DECIMAL_BASE ** dp).toFixed(dp);
}

/** "0.1", "1.25", "0.0035": ZEC from zatoshi, with what decimals it needs. */
export function zecText(zat: number | bigint): string {
  const text = zatToNumber(zat).toFixed(ZEC_DECIMALS).replace(/0+$/, "");
  const [whole = "0", frac = ""] = text.split(".");
  return `${whole}.${frac.padEnd(MIN_ZEC_DECIMALS, "0")}`;
}

/** Equity (chips plus open positions at their live value) at the magnitude decimals: "0.9454", "12.304". */
export function equityText(zat: number): string {
  const zec = zatToNumber(zat);
  return fixedText(zec, moneyDecimals(zec));
}

/** A live PnL in ZEC, signed at the magnitude decimals ("+0.0412", "−1.204"). */
export function livePnlText(zec: number): string {
  const dp = moneyDecimals(zec);
  return `${zec < 0 ? "−" : "+"}${fixedText(zec, dp)}`;
}

/** What a right call pays per chip staked at a price in 1/10,000: "1.9×". */
export function multipleOf(priceE4: number | null): string {
  if (priceE4 === null || !(priceE4 > 0)) return "–";
  const m = PRICE_SCALE_E4 / priceE4;
  return `${m >= MULTIPLE_WHOLE_FROM ? m.toFixed(0) : m.toFixed(2).replace(/0$/, "")}×`;
}

/** A price in 1/10,000 as cents of a 1-ZEC payout ("52.5¢"), Owarine's Avg in / Now. */
export function centsOf(priceE4: number): string {
  return `${(priceE4 / (PRICE_SCALE_E4 / CENTS_PER_UNIT)).toFixed(1)}¢`;
}

/** "1:05" or "12s" until a moment. */
export function untilText(targetSec: number, nowSec: number): string {
  const s = Math.max(0, Math.round(targetSec - nowSec));
  if (s < MINUTE) return `${s}s`;
  const h = Math.floor(s / HOUR);
  const m = Math.floor((s % HOUR) / MINUTE);
  const r = s % MINUTE;
  const mm = String(m).padStart(PAD, "0");
  const ss = String(r).padStart(PAD, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export const clockText = (sec: number): string =>
  new Date(sec * SECOND_MS).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

export const sideWord = (side: "U" | "D"): "Up" | "Down" => (side === "U" ? "Up" : "Down");
