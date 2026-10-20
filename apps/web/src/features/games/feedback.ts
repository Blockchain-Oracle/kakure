"use client";

import { hapticsAvailable } from "@kakure/sounds";
import { getPrefs } from "@/features/settings/prefs-store";
import { playSfx, type SfxName } from "./audio";
import { VIBRATE_MS } from "./constants";

/**
 * One cue, two channels (Mitoshi `features/games/feedback.ts`): the sample it plays and the buzz it gives. `tap` and
 * `confirm` are buzzes only (every control already sounds its own press and release, and a swipe has its own sounds);
 * `deny` is the refusal sample; `crash` is a buzz only, since the arcade synthesizes its own crash. Haptics obey
 * Kakure's Haptics setting.
 */
export type FeedbackCue = "tap" | "confirm" | "deny" | "crash" | SfxName;

const SAMPLE: Readonly<Record<FeedbackCue, SfxName | null>> = {
  tap: null,
  confirm: null,
  deny: "card-loss",
  crash: null,
  "swipe-up": "swipe-up",
  "swipe-down": "swipe-down",
  "card-win": "card-win",
  "card-loss": "card-loss",
  "match-found": "match-found",
  "duel-win": "duel-win",
  "duel-lose": "duel-lose",
  click: "click",
  "modal-open": "modal-open",
  "modal-close": "modal-close",
};

export function fireFeedback(cue: FeedbackCue): void {
  const sample = SAMPLE[cue];
  if (sample) playSfx(sample);
  const ms = VIBRATE_MS[cue];
  if (ms > 0 && getPrefs().haptics && hapticsAvailable()) {
    try {
      navigator.vibrate(ms);
    } catch {
      // Best effort: a device that refuses isn't an error the player needs to hear about.
    }
  }
}
