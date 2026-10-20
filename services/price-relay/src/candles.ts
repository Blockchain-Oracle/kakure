import {
  CANDLE_INTERVAL_MS,
  CANDLES_MAX,
  type CandleInterval,
  type CandleRow,
  type CandlesResponse,
  type StreamSymbol,
} from "@kakure/feeds/protocol";
import {
  BACKFILL_CONCURRENCY,
  CANDLE_BASE,
  CANDLE_CLOSE,
  CANDLE_HIGH,
  CANDLE_LOW,
  CANDLE_OPEN,
  CANDLE_TIME,
  CANDLES_LIVE_TTL_MS,
  CANDLES_OLDER_KEPT,
  COINBASE_CANDLES_PER_REQUEST,
  COINBASE_REST,
  COINBASE_REST_HEADERS,
  LANE_STREAM_SYMBOLS,
  MS_PER_SECOND,
} from "./constants";

/**
 * OHLC candles for the terminal's candle view (Owarine's intervals, 1m to 1d), every traded asset in one response so
 * the relay never learns which market a visitor watches (PD19). Built from Coinbase's public candles; intervals it
 * doesn't serve are aggregated from its finer ones. The newest response is shared by everyone for a few seconds;
 * older history (`end`) never changes and is kept in a small cache. A symbol Coinbase fails on is left out, not the
 * whole response.
 */
type Raw = number[];

export class CandleStore {
  private live = new Map<CandleInterval, { at: number; body: Promise<CandlesResponse> }>();
  private older = new Map<string, Promise<CandlesResponse>>();

  get(interval: CandleInterval, count: number, endMs: number | null, nowMs: number): Promise<CandlesResponse> {
    const wanted = Math.min(CANDLES_MAX, Math.max(1, Math.floor(count)));
    if (endMs === null) {
      const hit = this.live.get(interval);
      if (!hit || nowMs - hit.at > CANDLES_LIVE_TTL_MS) {
        const body = build(interval, CANDLES_MAX, nowMs);
        this.live.set(interval, { at: nowMs, body });
        body.catch(() => this.live.delete(interval));
      }
      return (this.live.get(interval) as { body: Promise<CandlesResponse> }).body.then((all) => newest(all, wanted));
    }
    const key = `${interval}|${endMs}|${wanted}`;
    let body = this.older.get(key);
    if (!body) {
      body = build(interval, wanted, endMs);
      body.catch(() => this.older.delete(key));
      this.older.set(key, body);
      if (this.older.size > CANDLES_OLDER_KEPT) this.older.delete(this.older.keys().next().value as string);
    }
    return body;
  }
}

function newest(all: CandlesResponse, count: number): CandlesResponse {
  const candles: CandlesResponse["candles"] = {};
  for (const [symbol, rows] of Object.entries(all.candles))
    candles[symbol as StreamSymbol] = (rows ?? []).slice(-count);
  return { interval: all.interval, candles };
}

async function build(interval: CandleInterval, count: number, endMs: number): Promise<CandlesResponse> {
  // A symbol Coinbase fails on is left out; the others still answer.
  const jobs = LANE_STREAM_SYMBOLS.map(
    (symbol) => async () => [symbol, await candlesOf(symbol, interval, count, endMs).catch(() => null)] as const,
  );
  const results: Array<readonly [StreamSymbol, CandleRow[] | null]> = [];
  const workers = Array.from({ length: BACKFILL_CONCURRENCY }, async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) results.push(await job());
  });
  await Promise.all(workers);
  const candles: CandlesResponse["candles"] = {};
  for (const [symbol, rows] of results) if (rows) candles[symbol] = rows;
  return { interval, candles };
}

/** One symbol's `count` newest candles ending before `endMs`, oldest first. */
async function candlesOf(
  symbol: StreamSymbol,
  interval: CandleInterval,
  count: number,
  endMs: number,
): Promise<CandleRow[]> {
  const [granularity, factor] = CANDLE_BASE[interval];
  const intervalMs = CANDLE_INTERVAL_MS[interval];
  const endS = Math.floor(endMs / MS_PER_SECOND);
  // One extra candle's worth, so the oldest aggregated candle is whole.
  const needed = (count + 1) * factor;
  const raw: Raw[] = [];
  for (let fetched = 0; fetched < needed; fetched += COINBASE_CANDLES_PER_REQUEST) {
    const chunk = Math.min(COINBASE_CANDLES_PER_REQUEST, needed - fetched);
    const end = endS - fetched * granularity;
    const start = end - chunk * granularity;
    const url = `${COINBASE_REST}/products/${symbol}/candles?granularity=${granularity}&start=${start}&end=${end}`;
    const response = await fetch(url, { headers: COINBASE_REST_HEADERS });
    if (!response.ok) throw new Error(`coinbase candles ${response.status}`);
    raw.push(...((await response.json()) as Raw[]));
  }
  const buckets = new Map<number, { o: number; h: number; l: number; c: number; first: number; last: number }>();
  for (const row of raw) {
    const t = Number(row[CANDLE_TIME]) * MS_PER_SECOND;
    if (t >= endMs) continue;
    const bucket = Math.floor(t / intervalMs) * intervalMs;
    const o = Number(row[CANDLE_OPEN]);
    const h = Number(row[CANDLE_HIGH]);
    const l = Number(row[CANDLE_LOW]);
    const c = Number(row[CANDLE_CLOSE]);
    const b = buckets.get(bucket);
    if (!b) {
      buckets.set(bucket, { o, h, l, c, first: t, last: t });
      continue;
    }
    if (t < b.first) {
      b.first = t;
      b.o = o;
    }
    if (t > b.last) {
      b.last = t;
      b.c = c;
    }
    b.h = Math.max(b.h, h);
    b.l = Math.min(b.l, l);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .slice(-count)
    .map(([t, b]): CandleRow => [t, String(b.o), String(b.h), String(b.l), String(b.c)]);
}
