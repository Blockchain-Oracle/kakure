import { PYTH_FEED_IDS, type Quote, STOCK_SYMBOLS, type StockSymbol, type StreamSymbol } from "@kakure/feeds/protocol";

/** Pyth Hermes: price stream needs the API key (Bearer); feed metadata (schedules) is public. */
export const HERMES = "https://hermes.pyth.network";

const SSE_DATA_PREFIX = "data:";
const MS_PER_SECOND = 1000;
const DAYS_PER_WEEK = 7;

interface HermesParsedPrice {
  id: string;
  price: { price: string; expo: number; publish_time: number };
}

const SYMBOL_BY_FEED = new Map<string, StockSymbol>(
  STOCK_SYMBOLS.map((symbol) => [PYTH_FEED_IDS[symbol], symbol] as const),
);

/** Streams keyed Pyth prices for every stock; calls `onQuotes` per SSE event. Resolves when the stream ends. */
export async function streamStocks(
  apiKey: string,
  sessions: SessionCalendar,
  onQuotes: (quotes: Array<[StreamSymbol, Quote]>) => void,
  signal: AbortSignal,
): Promise<void> {
  const ids = STOCK_SYMBOLS.map((symbol) => `ids[]=${PYTH_FEED_IDS[symbol]}`).join("&");
  const response = await fetch(`${HERMES}/v2/updates/price/stream?${ids}&parsed=true&encoding=base64`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "text/event-stream" },
    signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`Hermes stream refused (${response.status})`);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return;
    }
    buffer += value;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.startsWith(SSE_DATA_PREFIX)) {
        onQuotes(parseHermes(line.slice(SSE_DATA_PREFIX.length), sessions));
      }
      newline = buffer.indexOf("\n");
    }
  }
}

function parseHermes(json: string, sessions: SessionCalendar): Array<[StreamSymbol, Quote]> {
  const event = JSON.parse(json) as { parsed?: HermesParsedPrice[] };
  return (event.parsed ?? []).flatMap((entry) => {
    const symbol = SYMBOL_BY_FEED.get(entry.id);
    if (!symbol) {
      return [];
    }
    const ts = entry.price.publish_time * MS_PER_SECOND;
    const quote: Quote = {
      p: scaleDecimal(entry.price.price, entry.price.expo),
      ts,
      src: "pyth",
      open: sessions.isOpen(symbol, ts),
    };
    return [[`${symbol}-USD` as StreamSymbol, quote]];
  });
}

/** Pyth publishes integers with a decimal exponent (price × 10^expo); convert exactly, no floats. */
export function scaleDecimal(integer: string, expo: number): string {
  const negative = integer.startsWith("-");
  const digits = negative ? integer.slice(1) : integer;
  if (expo >= 0) {
    return `${negative ? "-" : ""}${digits}${"0".repeat(expo)}`;
  }
  const places = -expo;
  const padded = digits.padStart(places + 1, "0");
  const whole = padded.slice(0, padded.length - places);
  const fraction = padded.slice(padded.length - places).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/**
 * Market hours from Pyth's published per-feed schedule, e.g.
 * "America/New_York;0930-1600,0930-1600,0930-1600,0930-1600,0930-1600,C,C;1127/C,1225/C"
 * (seven weekday entries Monday→Sunday, then dated exceptions MMDD/hours). Loaded once from public metadata.
 */
export class SessionCalendar {
  private readonly schedules = new Map<StockSymbol, string>();

  static async load(): Promise<SessionCalendar> {
    const calendar = new SessionCalendar();
    const response = await fetch(`${HERMES}/v2/price_feeds?asset_type=equity`);
    if (response.ok) {
      const feeds = (await response.json()) as Array<{ id: string; attributes?: { schedule?: string } }>;
      for (const feed of feeds) {
        const symbol = SYMBOL_BY_FEED.get(feed.id);
        if (symbol && feed.attributes?.schedule) {
          calendar.schedules.set(symbol, feed.attributes.schedule);
        }
      }
    }
    return calendar;
  }

  /** Unknown schedule → treated as closed, so the UI never claims a live session it can't vouch for. */
  isOpen(symbol: StockSymbol, at: number): boolean {
    const schedule = this.schedules.get(symbol);
    if (!schedule) {
      return false;
    }
    const [zone = "America/New_York", weekly = "", exceptions = ""] = schedule.split(";");
    const local = zonedParts(at, zone);
    const exception = exceptions
      .split(",")
      .find((entry) => entry.startsWith(`${local.month}${local.day}/`))
      ?.split("/")[1];
    const hours = exception ?? weekly.split(",")[(local.weekday + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK] ?? "C";
    return hours !== "C" && hours.split("&").some((range) => inRange(range, local.hhmm));
  }
}

function inRange(range: string, hhmm: string): boolean {
  const [start = "", end = ""] = range.split("-");
  return hhmm >= start && hhmm < end;
}

/** Local month/day/weekday/HHMM in the schedule's time zone (handles DST via Intl). */
function zonedParts(at: number, timeZone: string): { month: string; day: string; weekday: number; hhmm: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    month: get("month"),
    day: get("day"),
    weekday: weekdays.indexOf(get("weekday")),
    hhmm: `${get("hour")}${get("minute")}`.padStart(4, "0"),
  };
}
