"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { reducedMotionFrom, usePrefs } from "@/features/settings/prefs-store";
import { type FeedbackCue, fireFeedback } from "./feedback";
import { type AccentChoice, useAccent } from "./settings";

/**
 * The games frame's state (Mitoshi `GamesProvider.tsx`): the accent, the one reduced-motion answer every stage reads
 * (the player's explicit choice beats the OS either way), the settings sheet, and immersion: while a round or a run is
 * live the frame wears `data-immersive` and, on a phone, the shell's top line and dock step aside.
 */
interface GamesContextValue {
  accent: AccentChoice;
  /** What the OS asks for right now, so settings can say which way "Follow system" resolves. */
  systemPrefersReduced: boolean;
  reducedMotion: boolean;
  feedback: (cue: FeedbackCue) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  immersive: boolean;
  setImmersive: (on: boolean) => void;
}

const GamesContext = createContext<GamesContextValue | null>(null);
const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

function useSystemPrefersReduced(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(REDUCE_QUERY);
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return reduced;
}

export function GamesProvider({ children }: { children: ReactNode }) {
  const prefs = usePrefs();
  const accent = useAccent();
  const systemPrefersReduced = useSystemPrefersReduced();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const reducedMotion = reducedMotionFrom(prefs.motion, systemPrefersReduced);
  const feedback = useCallback((cue: FeedbackCue) => fireFeedback(cue), []);

  const value = useMemo<GamesContextValue>(
    () => ({
      accent,
      systemPrefersReduced,
      reducedMotion,
      feedback,
      settingsOpen,
      setSettingsOpen,
      immersive,
      setImmersive,
    }),
    [accent, systemPrefersReduced, reducedMotion, feedback, settingsOpen, immersive],
  );
  return <GamesContext.Provider value={value}>{children}</GamesContext.Provider>;
}

/** Throws outside `/games`, which is the point: a stage without the frame has no settings to obey. */
export function useGames(): GamesContextValue {
  const value = useContext(GamesContext);
  if (!value) throw new Error("useGames must be used inside the /games layout");
  return value;
}

/** A stage holds the frame immersive while `on` (a round dealt and not scored, a run playing); leaving releases it. */
export function useImmersive(on: boolean): void {
  const { setImmersive } = useGames();
  useEffect(() => {
    setImmersive(on);
    return () => setImmersive(false);
  }, [on, setImmersive]);
}
