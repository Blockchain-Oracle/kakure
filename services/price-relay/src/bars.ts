import type { BarPoint, BarsResponse, StreamSymbol } from "@kakure/feeds/protocol";
import {
  BACKFILL_CONCURRENCY,
  CANDLE_CLOSE,
  CANDLE_TIME,
  COINBASE_REST,
  FIVE_MINUTE_BARS_KEPT,
  FIVE_MINUTE_GRANULARITY_S,
  FIVE_MINUTE_MS,
  MS_PER_SECOND,
  ONE_MINUTE_BARS_KEPT,
  ONE_MINUTE_GRANULARITY_S,
  ONE_MINUTE_MS,
} from "./constants";

type Ring = BarPoint[];

/**
 * Closing prices per bar for every symbol, kept in memory: 5-minute bars for a day and 1-minute bars for five hours.
 * Live ticks overwrite the current bar's close and open a new bar when the clock crosses into the next one.
 * After the object starts, history is backfilled once from Coinbase's public candles; the relay fetches every
 * symbol the same way, and clients get all of them in one response, so nothing reveals what anyone looks at.
 */
export class BarStore {
  private readonly five = new Map<StreamSymbol, Ring>();
  private readonly one = new Map<StreamSymbol, Ring>();
  private backfill: Promise<void> | null = null;

  record(symbol: StreamSymbol, price: string, ts: number): void {
    push(this.five, symbol, ts, price, FIVE_MINUTE_MS, FIVE_MINUTE_BARS_KEPT);
    push(this.one, symbol, ts, price, ONE_MINUTE_MS, ONE_MINUTE_BARS_KEPT);
  }

  snapshot(): BarsResponse {
    return { fiveMinute: Object.fromEntries(this.five), oneMinute: Object.fromEntries(this.one) };
  }

  /** Starts the one-time history backfill; later calls return the same promise. Failures leave live-only bars. */
  ensureBackfill(symbols: readonly StreamSymbol[], minuteSymbols: readonly StreamSymbol[]): Promise<void> {
    this.backfill ??= this.runBackfill(symbols, minuteSymbols).catch(() => undefined);
    return this.backfill;
  }

  private async runBackfill(symbols: readonly StreamSymbol[], minuteSymbols: readonly StreamSymbol[]) {
    const jobs: Array<() => Promise<void>> = [
      ...symbols.map((symbol) => () => this.fill(this.five, symbol, FIVE_MINUTE_GRANULARITY_S, FIVE_MINUTE_BARS_KEPT)),
      ...minuteSymbols.map(
        (symbol) => () => this.fill(this.one, symbol, ONE_MINUTE_GRANULARITY_S, ONE_MINUTE_BARS_KEPT),
      ),
    ];
    const workers = Array.from({ length: BACKFILL_CONCURRENCY }, async () => {
      for (let job = jobs.shift(); job; job = jobs.shift()) {
        await job().catch(() => undefined);
      }
    });
    await Promise.all(workers);
  }

  private async fill(target: Map<StreamSymbol, Ring>, symbol: StreamSymbol, granularity: number, kept: number) {
    const response = await fetch(`${COINBASE_REST}/products/${symbol}/candles?granularity=${granularity}`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return;
    }
    const candles = (await response.json()) as number[][];
    const history: Ring = candles
      .map((candle): BarPoint => [Number(candle[CANDLE_TIME]) * MS_PER_SECOND, String(candle[CANDLE_CLOSE])])
      .sort((a, b) => a[0] - b[0]);
    // Live bars recorded while the request was in flight are newer than the history; keep them on top.
    const live = (target.get(symbol) ?? []).filter(([start]) => start > (history.at(-1)?.[0] ?? 0));
    target.set(symbol, [...history, ...live].slice(-kept));
  }
}

function push(
  target: Map<StreamSymbol, Ring>,
  symbol: StreamSymbol,
  ts: number,
  price: string,
  size: number,
  kept: number,
) {
  const start = ts - (ts % size);
  const ring = target.get(symbol) ?? [];
  const last = ring.at(-1);
  if (last && last[0] === start) {
    last[1] = price;
  } else if (!last || start > last[0]) {
    ring.push([start, price]);
    if (ring.length > kept) {
      ring.splice(0, ring.length - kept);
    }
  }
  target.set(symbol, ring);
}
