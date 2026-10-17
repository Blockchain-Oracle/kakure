import type { StreamSymbol } from "@kakure/feeds/protocol";
import { createReactionEngine, createThrottle } from "@kakure/sounds";
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
    const play = createThrottle((reaction) => {
      if (AppState.currentState === "active")
        fire(reaction.cue, { ...(reaction.step === undefined ? {} : { step: reaction.step }) });
    });
    const unsubscribes = voices.map((voice) => {
      const engine = createReactionEngine(voice.direction);
      return prices.subscribe(voice.stream, () => {
        const state = prices.get(voice.stream);
        if (state.status !== "live") return;
        const reaction = engine.tick(Number(state.price), state.ts ?? Date.now());
        if (reaction) play(reaction);
      });
    });
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [signature, active]);
}
