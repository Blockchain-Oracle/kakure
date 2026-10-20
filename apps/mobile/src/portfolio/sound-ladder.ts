import type { StreamSymbol } from "@kakure/feeds/protocol";
import { createThrottle, cueFor, ReactionEngine } from "@kakure/sounds";
import { useEffect } from "react";
import { AppState } from "react-native";
import { prices } from "@/data/price-history-source";
import { fire } from "@/feedback/fire";

/**
 * The sound ladder (C9; senryo.md §6.4): while a position is open and this screen is showing, each favourable
 * step of its underlying climbs a major-pentatonic ladder, an adverse run plays the low blip, and fast moves
 * surge or slump, each with its haptic. One cue per 160 ms bucket across all positions ("a climb, not a buzz").
 * It never invents a move: no tick, no sound.
 */
export interface Voice {
  key: string;
  stream: StreamSymbol;
  direction: "up" | "down";
}

export function useSoundLadder(voices: readonly Voice[], active: boolean): void {
  const signature = voices.map((voice) => `${voice.key}:${voice.stream}:${voice.direction}`).join("|");
  useEffect(() => {
    if (!active || voices.length === 0) return;
    const play = createThrottle((cue) => {
      if (AppState.currentState === "active") fire(cue.cue, { ...(cue.step === undefined ? {} : { step: cue.step }) });
    });
    const unsubscribes = voices.map((voice) => {
      // The shared reaction engine (packages/sounds, Owarine's model). A pool ticket has no live value, so only the
      // moves are heard: steps and surges, no callouts, as on the web's Portfolio.
      const engine = new ReactionEngine();
      let entry: number | null = null;
      return prices.subscribe(voice.stream, () => {
        const state = prices.get(voice.stream);
        if (state.status !== "live") return;
        const price = Number(state.price);
        entry ??= price;
        const position = {
          key: voice.key,
          side: voice.direction === "up" ? 1 : -1,
          pnl: 0,
          margin: 0,
          entry,
          line: null,
        } as const;
        for (const reaction of engine.feed({ t: state.ts ?? Date.now(), price, position })) {
          const cue = cueFor(reaction);
          if (cue) play(cue);
        }
      });
    });
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [signature, active]);
}
