"use client";

import { formatUsd, priceDecimals } from "@kakure/chart";
import type { WindowPhase } from "@kakure/domain";
import { fire } from "@kakure/sounds";
import { cx, Mark, RollingNumber } from "@kakure/ui-web";
import {
  ArrowDownRight,
  ArrowUpRight,
  BadgePercent,
  ChevronDown,
  ChevronRight,
  Clock,
  Coins,
  Gauge,
  LineChart,
  Settings,
  TrendingDown,
} from "lucide-react";
import { type PointerEvent, useRef, useState } from "react";
import { KakureMark } from "@/features/shell/brand";
import { PERCENT } from "../constants";
import { untilText } from "../format";
import type { TerminalLane } from "../use-window";

/**
 * The terminal's floating chrome (Owarine `ui/Chrome.tsx`, Tradash's `a2` `a5` `se`): the asset chip, the Window chip,
 * the equity pill, the draggable order-settings stack, the View position pill and the rail's sheet row.
 */
const tap = () => fire("toggle", { haptic: "tick" });

export function SheetRow({
  onMarkets,
  onHistory,
  onSettings,
}: {
  onMarkets: () => void;
  onHistory: () => void;
  onSettings: () => void;
}) {
  const items = [
    { label: "Markets", icon: LineChart, onClick: onMarkets },
    { label: "History", icon: Clock, onClick: onHistory },
    { label: "Settings", icon: Settings, onClick: onSettings },
  ];
  return (
    <div role="toolbar" aria-label="Terminal" className="grid shrink-0 grid-cols-3 gap-1 rounded-full bg-secondary p-1">
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          onClick={() => {
            tap();
            item.onClick();
          }}
          className="flex h-9 items-center justify-center gap-1.5 rounded-full text-chip-label text-muted-foreground transition-colors hover:bg-card hover:text-foreground focus-visible:bg-card focus-visible:text-foreground focus-visible:outline-none"
        >
          <item.icon aria-hidden className="size-4" />
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** The asset chip: its mark, the live price in rolling digits ("—" before the first tick), "BTC · Bitcoin". */
export function AssetChip({
  asset,
  name,
  mark,
  price,
  onOpen,
}: {
  asset: string;
  name: string;
  mark: string | null;
  price: number | null;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        tap();
        onOpen();
      }}
      className="kk-glass flex min-w-0 items-center gap-2.5 rounded-full py-1.5 pr-3 pl-1.5 text-left lg:gap-3 lg:pr-4"
    >
      <Mark mark={mark} label={asset} size="row" />
      <span className="flex flex-col leading-tight">
        <span className="numbers flex items-center gap-1 text-row-strong text-foreground">
          {price === null ? "—" : <RollingNumber value={formatUsd(price, priceDecimals(price))} />}
          <ChevronDown aria-hidden className="size-4 text-muted-foreground" />
        </span>
        <span className="text-meta text-muted-foreground">
          {asset} · {name}
        </span>
      </span>
    </button>
  );
}

/** The Window length you trade, and where this Window is: "trades 0:23", "closes 0:12", "opens 0:41". */
export function WindowChip({
  lanes,
  cadenceSec,
  onPick,
  phase,
  startSec,
  cutoffSec,
  expirySec,
  nowSec,
}: {
  lanes: readonly TerminalLane[];
  cadenceSec: number | null;
  onPick: (sec: number) => void;
  phase: WindowPhase | null;
  startSec: number | null;
  cutoffSec: number | null;
  expirySec: number | null;
  nowSec: number;
}) {
  const status =
    phase === "live" && cutoffSec !== null
      ? `trades ${untilText(cutoffSec, nowSec)}`
      : phase === "riding" && expirySec !== null
        ? `closes ${untilText(expirySec, nowSec)}`
        : phase === "pre" && startSec !== null
          ? `opens ${untilText(startSec, nowSec)}`
          : phase === "opening"
            ? "opening…"
            : phase === "settled"
              ? "settling"
              : "no Window";
  return (
    <div className="kk-glass flex max-w-full items-center gap-1 overflow-x-auto rounded-full p-1 [scrollbar-width:none]">
      {lanes.map((l) => (
        <button
          key={l.cadenceSec}
          type="button"
          onClick={() => {
            tap();
            onPick(l.cadenceSec);
          }}
          aria-pressed={l.cadenceSec === cadenceSec}
          className={cx(
            "h-8 shrink-0 rounded-full px-3 text-chip-label",
            l.cadenceSec === cadenceSec ? "bg-foreground text-stage" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {l.label}
        </button>
      ))}
      <span className="numbers shrink-0 px-2 text-meta whitespace-nowrap text-muted-foreground">{status}</span>
    </div>
  );
}

/** The equity pill: chips plus what open positions would close for, in rolling digits; "Deposit" with nothing yet. */
export function EquityPill({ equity, coin, onOpen }: { equity: string | null; coin: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-label={equity === null ? "Deposit" : "Wallet"}
      onClick={() => {
        tap();
        onOpen();
      }}
      className="kk-glass flex h-11 shrink-0 items-center gap-2 rounded-full pr-1 pl-3 lg:pl-4"
    >
      <span className="numbers text-row-strong text-foreground">
        {equity === null ? "Deposit" : <RollingNumber value={`${equity} ${coin}`} />}
      </span>
      <span className="grid size-9 place-items-center rounded-full bg-primary text-primary-foreground">
        <KakureMark className="size-5" />
      </span>
    </button>
  );
}

const STACK_LIMIT_PX = 160;
const TAP_AFTER_DRAG_MS = 250;
/** A press becomes a drag past this many px. */
const DRAG_START_PX = 3;

/**
 * The floating order-settings stack: flush to the left edge, glass, four rows (Size · Pays · Fees · Trailing); it
 * peeks in, can be dragged up and down, and a tap opens the settings sheet (a tap right after a drag is ignored).
 */
export function SettingsStack({
  asset,
  size,
  pays,
  fees,
  trailPct,
  onOpen,
}: {
  asset: string;
  size: string;
  pays: string;
  fees: string;
  trailPct: number;
  onOpen: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const drag = useRef<{ startY: number; startOffset: number; moved: boolean } | null>(null);
  const draggedAt = useRef(0);
  const rows = [
    { icon: Coins, label: "Size", value: size },
    { icon: Gauge, label: "Pays", value: pays },
    { icon: BadgePercent, label: "Fees", value: fees },
    { icon: TrendingDown, label: "Trailing", value: `${(trailPct * PERCENT).toFixed(2)}%` },
  ];
  const down = (e: PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, startOffset: offset, moved: false };
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dy) > DRAG_START_PX) {
      d.moved = true;
      fire("toggle", { haptic: "tick" });
    }
    if (d.moved) setOffset(Math.max(-STACK_LIMIT_PX, Math.min(STACK_LIMIT_PX, d.startOffset + dy)));
  };
  const up = () => {
    if (drag.current?.moved) draggedAt.current = Date.now();
    drag.current = null;
  };
  return (
    <button
      type="button"
      aria-label={`${asset} order settings`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onClick={() => {
        if (Date.now() - draggedAt.current < TAP_AFTER_DRAG_MS) return;
        tap();
        onOpen();
      }}
      style={{ transform: `translateY(${offset}px)` }}
      className="kk-glass kk-peek grid touch-none grid-cols-[auto_auto] items-center gap-x-2 gap-y-1.5 rounded-r-2xl border-l-0 py-2.5 pr-3 pl-2.5 text-left"
    >
      {rows.map((r) => (
        <span key={r.label} className="contents">
          <span className="grid size-5 place-items-center rounded-full bg-secondary text-muted-foreground">
            <r.icon aria-hidden className="size-3" strokeWidth={2.5} />
          </span>
          <span className="numbers text-meta text-foreground">
            <span className="sr-only">{r.label}: </span>
            {r.value}
          </span>
        </span>
      ))}
    </button>
  );
}

/** Phone only: "View position" / "View N positions" with the total ROI, above the trade buttons. */
export function ViewPositionPill({
  count,
  roiPct,
  onOpen,
}: {
  count: number;
  roiPct: number | null;
  onOpen: () => void;
}) {
  const Dir = roiPct === null ? Clock : roiPct >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <button
      type="button"
      onClick={() => {
        tap();
        onOpen();
      }}
      className="kk-glass flex h-12 w-full items-center gap-3 rounded-full pr-3 pl-1.5"
    >
      <span
        className={cx(
          "grid size-9 place-items-center rounded-full",
          roiPct === null ? "bg-secondary text-muted-foreground" : roiPct >= 0 ? "kk-up-soft" : "kk-down-soft",
        )}
      >
        <Dir aria-hidden className="size-4" strokeWidth={2.75} />
      </span>
      <span className="flex-1 text-left text-row-strong">
        {count === 1 ? "View position" : `View ${count} positions`}
      </span>
      <span
        className={cx(
          "numbers text-row-strong",
          roiPct === null ? "text-muted-foreground" : roiPct >= 0 ? "text-up" : "text-down",
        )}
      >
        {roiPct === null ? "—" : <RollingNumber value={`${roiPct >= 0 ? "+" : "−"}${Math.abs(roiPct).toFixed(1)}%`} />}
      </span>
      <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
    </button>
  );
}
