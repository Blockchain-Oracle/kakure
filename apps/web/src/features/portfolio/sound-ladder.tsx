"use client";

import { usePrice } from "@kakure/feeds";
import type { StreamSymbol } from "@kakure/feeds/protocol";
import { createReactionEngine, createThrottle, fire, type ReactionEngine } from "@kakure/sounds";
import { useEffect, useRef } from "react";
import { usePrefs } from "@/features/settings/prefs-store";

/**
 * The sound ladder while a position is open (C9, senryo.md §6.4): every live tick of the underlying goes through
 * the reaction engine; favourable steps climb the pentatonic ladder, adverse steps blip, fast moves surge or slump,
 * each with its haptic. One voice per open position; one cue per 160 ms across all of them. Silent while the tab is
 * hidden (the relay closes then), when the ladder or sound is off, and before the first tap unlocks audio.
 */
const play = createThrottle((reaction) =>
  fire(reaction.cue, reaction.step === undefined ? {} : { step: reaction.step }),
);

function Voice({ stream, direction }: { stream: StreamSymbol; direction: "up" | "down" }) {
  const price = usePrice(stream);
  const engine = useRef<ReactionEngine | null>(null);
  engine.current ??= createReactionEngine(direction);

  useEffect(() => {
    if (price.status !== "live" || !price.price || !price.ts) return;
    const reaction = engine.current?.tick(Number(price.price), price.ts);
    if (reaction) play(reaction);
  }, [price]);

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
        <Voice key={voice.key} stream={voice.stream} direction={voice.direction} />
      ))}
    </>
  );
}
