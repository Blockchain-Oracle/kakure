"use client";

import { BOARD_LIMIT } from "@kakure/arcade";
import { type BundleV2, cadenceLabel, LANE_ASSETS, quoteWindow } from "@kakure/domain";
import { useMemo } from "react";
import { multipleOf } from "@/features/terminal/format";
import { LANE_SYMBOLS, useCommittedSpots } from "@/features/terminal/use-window";
import { ARCADE } from "../arcade/copy";
import { MARQUEE_GAP_REM, MARQUEE_HOVER_SEC, MARQUEE_MIN_SEC, MARQUEE_SEC_PER_ITEM } from "../constants";
import { GAMES } from "../copy";
import { useGames } from "../games-provider";
import { InfiniteSlider } from "../kit/infinite-slider";
import { useBoard } from "../player/queries";
import { practiceCandidates } from "../practice/candidates";

const MS = 1000;

interface Item {
  key: string;
  who: string;
  what: string;
  tone: "up" | "run" | "best";
}

/**
 * The hall's marquee (Mitoshi `hall/NowPlaying.tsx`): one strip moving under the title. Mitoshi mixed the venue's fills
 * with the arcade's runs; trades here are private, so it mixes today's server-checked runs (nickname and score, never a
 * time) with what Up pays now on each asset's shortest live Window. Hidden when both are empty; still under reduced
 * motion, where it scrolls by hand.
 */
export function NowPlaying({ bundle, nowMs }: { bundle: BundleV2 | null; nowMs: number }) {
  const { reducedMotion } = useGames();
  const rider = useBoard("line-rider", "day", BOARD_LIMIT);
  const hop = useBoard("candle-hop", "day", BOARD_LIMIT);
  const spots = useCommittedSpots(LANE_SYMBOLS);
  const nowSec = Math.floor(nowMs / MS);
  const minute = Math.floor(nowSec / 60);

  const items = useMemo<Item[]>(() => {
    const runs = [rider.data, hop.data].flatMap((board) =>
      (board?.rows ?? []).map((row, i) => ({
        key: `${board?.game}-${row.nickname}`,
        who: row.nickname,
        what: GAMES.hall.runLine(ARCADE.games[board?.game ?? "line-rider"].title, ARCADE.fmt(row.score)),
        tone: i === 0 ? ("best" as const) : ("run" as const),
      })),
    );
    const quotes: Item[] = [];
    if (bundle && minute > 0) {
      const live = practiceCandidates(bundle, minute * 60).filter((c) => c.trading);
      for (const asset of LANE_ASSETS) {
        const window = live.filter((c) => c.asset === asset).sort((a, b) => a.intervalSec - b.intervalSec)[0];
        const spot = spots.get(`${asset}-USD`) ?? null;
        const sigma = bundle.pricing.sigma[asset];
        if (!window || spot === null) continue;
        const quote = quoteWindow(
          { startSec: window.expirySec - window.intervalSec, expirySec: window.expirySec },
          bundle.windows.find((w) => w.id === window.marketId) ?? null,
          { spot, sigma: sigma ? Number(sigma) : null },
          minute * 60,
        );
        if (quote.up.askE4 === null) continue;
        quotes.push({
          key: window.marketId,
          who: asset,
          what: GAMES.hall.quoteLine(cadenceLabel(window.intervalSec), multipleOf(quote.up.askE4)),
          tone: "up",
        });
      }
    }
    // Interleaved, so a busy board never hides the market.
    const out: Item[] = [];
    for (let i = 0; i < Math.max(runs.length, quotes.length); i++) {
      const run = runs[i];
      const quote = quotes[i];
      if (quote) out.push(quote);
      if (run) out.push(run);
    }
    return out;
  }, [rider.data, hop.data, bundle, minute, spots]);

  if (items.length === 0) return <span className="hall-now hall-now--empty" aria-hidden />;
  return (
    <div className="hall-now" role="marquee" aria-label={GAMES.hall.nowPlaying}>
      <InfiniteSlider
        gapRem={MARQUEE_GAP_REM}
        durationSec={Math.max(MARQUEE_MIN_SEC, items.length * MARQUEE_SEC_PER_ITEM)}
        hoverDurationSec={MARQUEE_HOVER_SEC}
        still={reducedMotion}
      >
        {items.map((item) => (
          <span key={item.key} className="hall-now-item" data-tone={item.tone}>
            <span className="hall-now-dot" aria-hidden />
            <span className="hall-now-who">{item.who}</span>
            <span className="hall-now-what">{item.what}</span>
          </span>
        ))}
      </InfiniteSlider>
    </div>
  );
}
