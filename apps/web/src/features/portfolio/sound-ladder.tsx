"use client";

import { usePrice } from "@kakure/feeds";
import type { StreamSymbol } from "@kakure/feeds/protocol";
import { createThrottle, cueFor, fire, ReactionEngine } from "@kakure/sounds";
import { useEffect, useRef } from "react";
import { usePrefs } from "@/features/settings/prefs-store";

/**
 * The sound ladder while a position is open (C9, senryo.md §6.4): every live tick of the underlying goes through
 * the reaction engine; favourable steps climb the pentatonic ladder, adverse steps blip, fast moves surge or slump,
 * each with its haptic. One voice per open position; one cue per 160 ms across all of them. Silent while the tab is
 * hidden (the relay closes then), when the ladder or sound is off, and before the first tap unlocks audio.
 */
const play = createThrottle((cue) => fire(cue.cue, cue.step === undefined ? {} : { step: cue.step }));

function Voice({ id, stream, direction }: { id: string; stream: StreamSymbol; direction: "up" | "down" }) {
  const price = usePrice(stream);
  const engine = useRef<ReactionEngine | null>(null);
  const entry = useRef<number | null>(null);
  engine.current ??= new ReactionEngine();

  useEffect(() => {
    if (price.status !== "live" || !price.price || !price.ts) return;
    const now = Number(price.price);
    entry.current ??= now;
    // A pool ticket has no live value, so only the moves are heard: steps and surges, no callouts.
    const position = {
      key: id,
      side: direction === "up" ? 1 : -1,
      pnl: 0,
      margin: 0,
      entry: entry.current,
      line: null,
    } as const;
    for (const reaction of engine.current?.feed({ t: price.ts, price: now, position }) ?? []) {
      const cue = cueFor(reaction);
      if (cue) play(cue);
    }
  }, [price, id, direction]);

  return null;
}

export function SoundLadder({
  voices,
}: {
  voices: ReadonlyArray<{ key: string; stream: StreamSymbol; direction: "up" | "down" }>;
}) {
  const prefs = usePrefs();
  if (!prefs.ladder || !prefs.sound) return null;
  return (
    <>
      {voices.map((voice) => (
        <Voice key={voice.key} id={voice.key} stream={voice.stream} direction={voice.direction} />
      ))}
    </>
  );
}
