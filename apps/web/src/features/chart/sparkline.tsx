"use client";

import type { StreamSymbol } from "@kakure/feeds/protocol";
import { useEffect, useState } from "react";
import { loadBars } from "./bars";

/** The sparkline's view box; the path scales to the element's size. */
const VIEW_W = 120;
const VIEW_H = 36;
const PAD = 2;

/**
 * A 24-hour sparkline from the relay's 5-minute closes (Mitoshi's market-card sparkline; 21st.dev
 * ssychui/balance-chart geometry): mint when the day is up, rose when it's down. Draws nothing until bars arrive,
 * so a card never shows a made-up line.
 */
export function Sparkline({ symbol, className }: { symbol: StreamSymbol; className?: string }) {
  const [points, setPoints] = useState<number[] | null>(null);

  useEffect(() => {
    let alive = true;
    void loadBars().then((bars) => {
      if (!alive) return;
      const closes = (bars.fiveMinute[symbol] ?? []).map(([, price]) => Number(price)).filter(Number.isFinite);
      setPoints(closes.length > 1 ? closes : null);
    });
    return () => {
      alive = false;
    };
  }, [symbol]);

  if (!points) return <div aria-hidden className={className} />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = (VIEW_W - PAD * 2) / (points.length - 1);
  const path = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${(PAD + i * step).toFixed(1)},${(PAD + ((max - p) / span) * (VIEW_H - PAD * 2)).toFixed(1)}`,
    )
    .join("");
  const up = (points.at(-1) ?? 0) >= (points[0] ?? 0);
  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      className={className}
      role="img"
      aria-label={`${symbol.replace("-USD", "")} over the last day: ${up ? "up" : "down"}`}
    >
      <path
        d={path}
        fill="none"
        stroke={up ? "var(--up)" : "var(--down)"}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
