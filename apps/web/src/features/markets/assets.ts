import type { Market } from "@kakure/domain";
import { STREAM_SYMBOLS, type StreamSymbol } from "@kakure/feeds/protocol";
import type { Category } from "./category-store";

/**
 * What the UI knows about each market subject: its name, tab, mark and live price stream.
 * Marks are vendored in public/marks/ (scripts/marks.mjs); a subject without one gets the labelled neutral disc.
 */
export interface Asset {
  symbol: string;
  name: string;
  category: Category;
  mark: string | null;
  stream: StreamSymbol | null;
}

const CRYPTO_NAMES: Readonly<Record<string, string>> = {
  AAVE: "Aave",
  ARB: "Arbitrum",
  AVAX: "Avalanche",
  BCH: "Bitcoin Cash",
  BTC: "Bitcoin",
  CRV: "Curve",
  DOGE: "Dogecoin",
  DOT: "Polkadot",
  ETH: "Ethereum",
  HYPE: "Hyperliquid",
  LINK: "Chainlink",
  LTC: "Litecoin",
  OP: "Optimism",
  PEPE: "Pepe",
  POL: "Polygon",
  SHIB: "Shiba Inu",
  SKY: "Sky",
  SOL: "Solana",
  SUI: "Sui",
  UNI: "Uniswap",
  XRP: "XRP",
  ZEC: "Zcash",
};

const STOCK_NAMES: Readonly<Record<string, string>> = {
  AAPL: "Apple",
  AMZN: "Amazon",
  GOOGL: "Alphabet",
  META: "Meta",
  MSFT: "Microsoft",
  NVDA: "NVIDIA",
  QQQ: "Invesco QQQ",
  SPY: "SPDR S&P 500",
  TSLA: "Tesla",
  VOO: "Vanguard S&P 500",
};

/** Chain events (event markets) are Zcash-native; their subject is an event key such as `nu7`. */
const EVENT_NAMES: Readonly<Record<string, string>> = {
  nu7: "NU7 activation",
  tnheight: "Testnet block height",
};

const MARKS = new Set(["BTC", "ETH", "SOL", "ZEC", "XRP", "DOGE", "AAPL", "TSLA", "NVDA"]);
const ZEC = "ZEC";

function markFor(symbol: string): string | null {
  return MARKS.has(symbol) ? `/marks/${symbol.toLowerCase()}.svg` : null;
}

function streamFor(symbol: string): StreamSymbol | null {
  const stream = `${symbol}-USD`;
  return (STREAM_SYMBOLS as readonly string[]).includes(stream) ? (stream as StreamSymbol) : null;
}

export function assetFor(market: Pick<Market, "kind" | "subject">): Asset {
  const symbol = market.subject.toUpperCase();
  if (market.kind === "event") {
    return {
      symbol: ZEC,
      name: EVENT_NAMES[market.subject] ?? "Zcash network",
      category: "zcash",
      mark: markFor(ZEC),
      stream: null,
    };
  }
  if (symbol in STOCK_NAMES) {
    return { symbol, name: STOCK_NAMES[symbol] ?? symbol, category: "stocks", mark: markFor(symbol), stream: null };
  }
  return {
    symbol,
    name: CRYPTO_NAMES[symbol] ?? symbol,
    category: symbol === ZEC ? "zcash" : "crypto",
    mark: markFor(symbol),
    stream: streamFor(symbol),
  };
}
