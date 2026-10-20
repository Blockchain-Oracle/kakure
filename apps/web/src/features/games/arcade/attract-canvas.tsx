"use client";

// A game playing itself (R4-9, D-227; ported from Senryo:packages/arcade/src/attract.ts — "show the game itself"):
// the real engine and drawing under an autopilot, on a real-price tape when the server has one, a new run a beat after
// each ends. Silent, unranked, and only while on screen (IntersectionObserver); under reduced motion the cabinet shows
// its static scene instead.
import type { ArcadeGame } from "@kakure/arcade";
import { useEffect, useMemo, useRef, useState } from "react";
import { HopCanvas } from "./hop-canvas";
import { type ArcadeRun, localSeed } from "./run";
import { SledCanvas } from "./sled-canvas";
import "./arcade.css";

export interface AttractTape {
  feed: string;
  fromSec: number;
  toSec: number;
  points: readonly number[];
  moves: readonly number[];
}

const noop = () => undefined;

export function AttractCanvas({ game, tape }: { game: ArcadeGame; tape: AttractTape | null }) {
  const holder = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const run = useMemo<ArcadeRun>(
    () =>
      tape && tape.moves.length > 1
        ? {
            id: 1,
            seed: localSeed(),
            calm: false,
            moves: tape.moves,
            tapeMeta: { feed: tape.feed, fromSec: tape.fromSec, toSec: tape.toSec },
          }
        : { id: 1, seed: localSeed(), calm: false },
    [tape],
  );
  // The draws read the field's ink from `.ar-screen`'s triplets, so the canvas sits in one.
  return (
    <div ref={holder} className="ar-screen ar-attract-screen" aria-hidden>
      {game === "line-rider" ? (
        <SledCanvas run={run} autopilot paused={!visible} reduced={false} onHud={noop} onEnd={noop} onCue={noop} />
      ) : (
        <HopCanvas run={run} autopilot paused={!visible} reduced={false} onHud={noop} onEnd={noop} onCue={noop} />
      )}
    </div>
  );
}
