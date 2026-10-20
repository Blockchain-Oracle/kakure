"use client";

import { formatUsd, priceDecimals } from "@kakure/chart";
import { LANE_ASSETS, type LaneAsset } from "@kakure/domain";
import { sharedPrices, usePrice } from "@kakure/feeds";
import { CRYPTO_STREAM_SYMBOLS, type StreamSymbol } from "@kakure/feeds/protocol";
import { fire } from "@kakure/sounds";
import { cx, Mark, Sheet } from "@kakure/ui-web";
import { Search, Star, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { loadBars } from "@/features/chart/bars";
import { assetFor } from "@/features/markets/assets";
import { PERCENT } from "../constants";
import { setTradeSettings, useTradeSettings } from "../settings";
import { lanesFor } from "../use-window";

/**
 * The market picker (Owarine `sheets/MarketsSheet.tsx`, Tradash's `Q`): search, category chips, "Market | Last price /
 * 24h change", rows with a star, the mark, the name, the symbol and its shortest Window, the price and the 24 h move.
 * Hot is the biggest movers. Every other relay asset is listed too, with why it can't be traded here. The 24 h move
 * comes from the relay's day of 5-minute bars, which every visitor downloads alike (PD19).
 */
type Category = "favourites" | "all" | "hot" | "crypto";
const CATEGORIES: ReadonlyArray<{ id: Category; label: string }> = [
  { id: "favourites", label: "Favourites" },
  { id: "all", label: "All" },
  { id: "hot", label: "Hot 🔥" },
  { id: "crypto", label: "Crypto" },
];
const HOT_COUNT = 6;
const tap = () => fire("toggle", { haptic: "tick" });

/** The price a day ago per symbol (the first 5-minute bar of the relay's day). */
function useDayOpen(open: boolean): ReadonlyMap<string, number> {
  const [opens, setOpens] = useState<ReadonlyMap<string, number>>(new Map());
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void loadBars()
      .then((bars) => {
        if (!alive) return;
        const next = new Map<string, number>();
        for (const [symbol, points] of Object.entries(bars.fiveMinute)) {
          const first = points?.[0]?.[1];
          if (first) next.set(symbol, Number(first));
        }
        setOpens(next);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [open]);
  return opens;
}

const isLane = (symbol: string): symbol is LaneAsset => (LANE_ASSETS as readonly string[]).includes(symbol);

/** The biggest 24 h movers, either way (Owarine's Hot), from the live price against a day ago. */
function hottest(symbols: readonly LaneAsset[], opens: ReadonlyMap<string, number>): LaneAsset[] {
  const stream = sharedPrices();
  const move = (s: LaneAsset) => {
    const open = opens.get(`${s}-USD`);
    const now = Number(stream?.get(`${s}-USD`)?.price ?? Number.NaN);
    return open && Number.isFinite(now) ? Math.abs(now - open) / open : 0;
  };
  return [...symbols].sort((a, b) => move(b) - move(a)).slice(0, HOT_COUNT);
}

export function MarketsSheet({
  open,
  onClose,
  current,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  current: string;
  onPick: (asset: LaneAsset) => void;
}) {
  const settings = useTradeSettings();
  const [category, setCategory] = useState<Category>("all");
  const [query, setQuery] = useState("");
  const opens = useDayOpen(open);
  useEffect(() => {
    if (open) {
      setCategory("all");
      setQuery("");
    }
  }, [open]);

  const symbols = useMemo(() => CRYPTO_STREAM_SYMBOLS.map((s) => s.replace("-USD", "")), []);
  const matches = (symbol: string) => {
    const q = query.trim().toLowerCase();
    const name = assetFor({ kind: "close", subject: symbol }).name.toLowerCase();
    return !q || symbol.toLowerCase().includes(q) || name.includes(q);
  };
  const tradable = LANE_ASSETS.filter(matches).filter((s) =>
    category === "favourites" ? settings.favourites.includes(s) : true,
  );
  const others = symbols
    .filter((s) => !isLane(s))
    .filter(matches)
    .filter((s) => (category === "favourites" ? settings.favourites.includes(s) : category !== "hot"));
  const toggleStar = (symbol: string) =>
    setTradeSettings({
      favourites: settings.favourites.includes(symbol)
        ? settings.favourites.filter((s) => s !== symbol)
        : [...settings.favourites, symbol],
    });

  const empty =
    category === "favourites" && settings.favourites.length === 0
      ? "No favourites yet. Tap a star to add one."
      : tradable.length === 0 && others.length === 0
        ? query
          ? "No markets match that search."
          : "Nothing listed here right now."
        : null;

  return (
    <Sheet open={open} onClose={onClose} title="Markets">
      <div className="flex flex-col gap-3">
        <label className="flex h-11 items-center gap-2 rounded-full bg-secondary px-4">
          <Search aria-hidden className="size-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search markets"
            aria-label="Search markets"
            className="min-w-0 flex-1 bg-transparent text-row outline-none placeholder:text-muted-foreground"
          />
          {query ? (
            <button type="button" aria-label="Clear" onClick={() => setQuery("")}>
              <X aria-hidden className="size-4 text-muted-foreground" />
            </button>
          ) : null}
        </label>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                tap();
                setCategory(c.id);
              }}
              className={cx(
                "h-8 shrink-0 rounded-full px-3.5 text-chip-label",
                category === c.id ? "bg-foreground text-stage" : "bg-secondary text-muted-foreground",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex justify-between px-1 text-[0.6875rem] text-muted-foreground">
          <span>Market</span>
          <span>Last price / 24h change</span>
        </div>
        {empty ? <p className="py-8 text-center text-row text-muted-foreground">{empty}</p> : null}
        <ul className="flex flex-col gap-1.5">
          {(category === "hot" ? hottest(tradable, opens) : tradable).map((symbol) => (
            <PickerRow
              key={symbol}
              symbol={symbol}
              lane={lanesFor(symbol)[0]?.label ?? null}
              active={symbol === current}
              starred={settings.favourites.includes(symbol)}
              onStar={() => toggleStar(symbol)}
              onPick={() => {
                tap();
                onPick(symbol);
                onClose();
              }}
              dayOpen={opens.get(`${symbol}-USD`) ?? null}
            />
          ))}
          {others.map((symbol) => (
            <PickerRow
              key={symbol}
              symbol={symbol}
              lane={null}
              active={false}
              starred={settings.favourites.includes(symbol)}
              onStar={() => toggleStar(symbol)}
              onPick={null}
              dayOpen={opens.get(`${symbol}-USD`) ?? null}
            />
          ))}
        </ul>
      </div>
    </Sheet>
  );
}

function PickerRow({
  symbol,
  lane,
  active,
  starred,
  onStar,
  onPick,
  dayOpen,
}: {
  symbol: string;
  lane: string | null;
  active: boolean;
  starred: boolean;
  onStar: () => void;
  /** Null: no Window for it here (it streams for charts only). */
  onPick: (() => void) | null;
  dayOpen: number | null;
}) {
  const asset = assetFor({ kind: "close", subject: symbol });
  const live = usePrice(`${symbol}-USD` as StreamSymbol);
  const price = live.price ? Number(live.price) : null;
  const pct = price !== null && dayOpen ? ((price - dayOpen) / dayOpen) * PERCENT : null;
  const body = (
    <>
      <Mark mark={asset.mark} label={symbol} size="token" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-row-strong">{asset.name}</span>
        <span className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
          {symbol}
          <span className="truncate rounded-full bg-secondary px-1.5 font-bold">{lane ?? "No Window yet"}</span>
        </span>
      </span>
      <span className="flex flex-col items-end">
        {price === null ? (
          <span className="h-4 w-16 rounded bg-secondary motion-safe:animate-pulse" />
        ) : (
          <span className="numbers text-row-strong">{formatUsd(price, priceDecimals(price))}</span>
        )}
        {pct === null ? (
          <span className="text-[0.6875rem] text-muted-foreground">—</span>
        ) : (
          <span
            className={cx(
              "numbers text-[0.6875rem] font-semibold",
              pct > 0 ? "text-up" : pct < 0 ? "text-down" : "text-muted-foreground",
            )}
          >
            {`${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct).toFixed(2)}%`}
          </span>
        )}
      </span>
    </>
  );
  return (
    <li
      className={cx(
        "flex items-center gap-3 rounded-group px-2 py-2",
        active ? "bg-secondary" : "hover:bg-secondary/60",
      )}
    >
      <button
        type="button"
        aria-label={starred ? `Unstar ${symbol}` : `Star ${symbol}`}
        aria-pressed={starred}
        onClick={onStar}
        className="grid size-7 place-items-center"
      >
        <Star aria-hidden className={cx("size-4", starred ? "fill-warn-dot text-warn-dot" : "text-muted-foreground")} />
      </button>
      {onPick ? (
        <button type="button" onClick={onPick} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          {body}
        </button>
      ) : (
        <span aria-disabled className="flex min-w-0 flex-1 items-center gap-3 opacity-70">
          {body}
        </span>
      )}
    </li>
  );
}
