"use client";

import { buzz, cueFor, fire, ReactionEngine, setMusicTense } from "@kakure/sounds";
import { type RefObject, useEffect, useRef } from "react";
import type { FrameInfo } from "./chart/live-chart";
import { zatToNumber } from "./format";
import type { LivePosition } from "./positions";
import type { ReactionOverlayHandle } from "./ui/reaction-overlay";

/**
 * What the ear and the overlay say about the position on screen (Owarine `useChartFeedback.ts`, Tradash's dispatch
 * table): the reaction engine fed at the commit rate (≤ 5 Hz) with its sounds and haptics, the edge flash and callouts
 * when reactions are on, and the tense music while the position is down 5 % or more. Silent with nothing held.
 */
const TENSE_ROI = -0.05;

export function useTradeFeedback(input: {
  active: LivePosition | null;
  spot: number | null;
  symbol: string;
  line: number | null;
  reactionsEnabled: boolean;
}): { overlayHandle: RefObject<ReactionOverlayHandle | null>; onFrame: RefObject<(info: FrameInfo | null) => void> } {
  const { active, spot, symbol, line, reactionsEnabled } = input;
  const engine = useRef(new ReactionEngine());
  const overlayHandle = useRef<ReactionOverlayHandle | null>(null);
  const onFrame = useRef<(info: FrameInfo | null) => void>((info) => overlayHandle.current?.frame(info));
  // Read inside the price effect, which runs only when the committed price changes.
  const latest = useRef({ active, line, reactionsEnabled });
  latest.current = { active, line, reactionsEnabled };

  useEffect(() => {
    engine.current.reset();
  }, [symbol]);

  useEffect(() => {
    if (spot === null) return;
    const { active: held, line: level, reactionsEnabled: show } = latest.current;
    const priced = held?.side && held.pnlZat !== null && held.stakeZat > 0;
    const position =
      held && priced
        ? {
            key: held.key,
            side: held.side === "U" ? (1 as const) : (-1 as const),
            pnl: zatToNumber(held.pnlZat ?? 0),
            margin: zatToNumber(held.stakeZat),
            entry: held.record.entrySpot ?? spot,
            line: level,
          }
        : null;
    for (const r of engine.current.feed({ t: performance.now(), price: spot, position })) {
      if (r.kind === "callout") {
        if (r.tone === "warn") buzz("warn");
        if (show) overlayHandle.current?.callout(r.tone, r.emoji, r.text);
        continue;
      }
      const cue = cueFor(r);
      if (cue) fire(cue.cue, cue.step === undefined ? {} : { step: cue.step });
      if (r.kind === "surge" && show) overlayHandle.current?.flash(r.favorable, r.mega);
    }
  }, [spot]);

  const tense =
    active !== null && active.pnlZat !== null && active.stakeZat > 0
      ? active.pnlZat / active.stakeZat <= TENSE_ROI
      : false;
  useEffect(() => setMusicTense(tense), [tense]);
  useEffect(() => () => setMusicTense(false), []);

  return { overlayHandle, onFrame };
}
