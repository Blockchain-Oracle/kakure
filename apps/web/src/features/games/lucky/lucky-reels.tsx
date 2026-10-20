"use client";

import { LUCKY_MULTIPLIERS, type LuckyDraw, type LuckySide } from "@kakure/arcade";
import { LANE_ASSETS } from "@kakure/domain";
import { Mark } from "@kakure/ui-web";
import { useEffect, useRef, useState } from "react";
import { assetFor } from "@/features/markets/assets";
import { useGames } from "../games-provider";
import { CardLine } from "../practice/card-line";
import { LOCKIN_MS, STOPS_MS } from "./constants";
import { LUCKY } from "./copy";
import { reelLock, reelPick, reelTick } from "./reel-sfx";
import { SlotReel } from "./slot-reel";

const SIDES: readonly LuckySide[] = ["up", "down"];

/**
 * Lucky's three reels: asset, side, reach (Mitoshi `lucky/LuckyReels.tsx`, Owarine's 720 / 980 / 1,240 ms stagger with
 * thunks that climb). Each asset face carries its last half hour (Owarine's reel plate: the mark and a line). The last
 * reel lands, the pick is held lit a beat, then the deal; the draw is announced once, politely.
 */
export function LuckyReels({
  cycling,
  landing,
  held,
  target,
  onLanded,
}: {
  cycling: boolean;
  landing: boolean;
  /** The deal is up: the reels hold the drawn row. */
  held: boolean;
  target: LuckyDraw | null;
  onLanded: () => void;
}) {
  const { feedback, reducedMotion } = useGames();
  const [spinId, setSpinId] = useState(0);
  const [said, setSaid] = useState("");
  const stopped = useRef(0);
  const landedRef = useRef(onLanded);
  landedRef.current = onLanded;

  useEffect(() => {
    if (!cycling) return;
    stopped.current = 0;
    setSpinId((n) => n + 1);
  }, [cycling]);

  const live = (landing || held) && target !== null;
  const spinning = cycling || landing;
  const onLand = (index: number) => () => {
    reelLock(index, index === STOPS_MS.length - 1);
    feedback("confirm");
    stopped.current += 1;
    if (stopped.current < STOPS_MS.length || !target) return;
    window.setTimeout(
      () => {
        reelPick();
        setSaid(LUCKY.reels.announce(target.asset, LUCKY.side[target.side], target.multiplier));
        landedRef.current();
      },
      reducedMotion ? 0 : LOCKIN_MS,
    );
  };

  return (
    <fieldset className="lk-reels">
      <legend className="sr-only">{LUCKY.title}</legend>
      <SlotReel<string>
        items={LANE_ASSETS}
        target={live ? target.asset : null}
        spinId={spinId}
        label={LUCKY.reels.asset}
        stopAfterMs={STOPS_MS[0]}
        spinning={spinning}
        reduced={reducedMotion}
        tone="asset"
        onTick={reelTick}
        onLand={onLand(0)}
        face={(asset) => (
          <span className="lk-slot-face lk-slot-face--asset">
            <span className="lk-slot-face">
              <Mark mark={assetFor({ kind: "close", subject: asset }).mark} label={asset} size="inline" />
              {asset}
            </span>
            <CardLine asset={asset} className="lk-slot-line" />
          </span>
        )}
      />
      <SlotReel<LuckySide>
        items={SIDES}
        target={live ? target.side : null}
        spinId={spinId}
        label={LUCKY.reels.side}
        stopAfterMs={STOPS_MS[1]}
        spinning={spinning}
        reduced={reducedMotion}
        tone={live ? target.side : undefined}
        onLand={onLand(1)}
        face={(side) => (
          <span className="lk-slot-face" data-side={side}>
            {side === "up" ? "▲" : "▼"} {LUCKY.side[side]}
          </span>
        )}
      />
      <SlotReel<number>
        items={LUCKY_MULTIPLIERS}
        target={live ? target.multiplier : null}
        spinId={spinId}
        label={LUCKY.reels.reach}
        stopAfterMs={STOPS_MS[2]}
        spinning={spinning}
        reduced={reducedMotion}
        tone="reach"
        onLand={onLand(2)}
        face={(m) => <span className="lk-slot-face lk-slot-face--reach">{LUCKY.reels.multiple(m)}</span>}
      />
      <span className="sr-only" aria-live="polite">
        {said}
      </span>
    </fieldset>
  );
}
