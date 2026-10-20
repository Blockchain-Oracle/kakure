"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { usePrefs } from "@/features/settings/prefs-store";
import { applyMaster, installAudioUnlock, pressSfx, releaseSfx, stopBgm } from "./audio";
import { gameIdFromPath } from "./catalog";
import { GamesProvider, useGames } from "./games-provider";
import { GamesRail } from "./games-rail";
import "./games.css";

// The settings sheet loads on its first open, so no /games first load carries it.
const GameSettingsSheet = dynamic(() => import("./settings-sheet").then((m) => m.GameSettingsSheet), {
  ssr: false,
  loading: () => null,
});

/**
 * The `/games` frame (Mitoshi `GamesShell.tsx`): settings, the rail, the accent and the reduced-motion switch, owned
 * once for every mode. The frame follows the theme; the arcade's field paints its own dark ground. Audio lives exactly
 * as long as the frame: unlocked on the first gesture, every control sounding its own press and release (Pips).
 */
const CONTROL = "button, a[href], [role='button'], [role='radio'], input[type='range']";
const SCOPE = ".gm-frame, .gm-sheet";

const isControl = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(SCOPE) !== null && target.closest(CONTROL) !== null;
const isPress = (event: KeyboardEvent) => event.key === "Enter" || event.key === " ";

export function GamesShell({ children }: { children: ReactNode }) {
  return (
    <GamesProvider>
      <GamesFrame>{children}</GamesFrame>
    </GamesProvider>
  );
}

function GamesFrame({ children }: { children: ReactNode }) {
  const { reducedMotion, accent, immersive, settingsOpen } = useGames();
  const pathname = usePathname();
  const prefs = usePrefs();
  // The strip owns the top on a game route and on Rank and History: one header per game screen.
  const ownsTop = gameIdFromPath(pathname) !== null || pathname === "/games/rank" || pathname === "/games/history";
  // Mounted from its first open on, so it can animate shut.
  const [settingsWanted, setSettingsWanted] = useState(false);
  if (settingsOpen && !settingsWanted) setSettingsWanted(true);

  useEffect(() => {
    const uninstall = installAudioUnlock();
    const onDown = (event: PointerEvent) => {
      if (isControl(event.target)) pressSfx();
    };
    const onUp = (event: PointerEvent) => {
      if (isControl(event.target)) releaseSfx();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (isPress(event) && !event.repeat && isControl(event.target)) pressSfx();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (isPress(event) && isControl(event.target)) releaseSfx();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      uninstall();
      stopBgm();
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // Kakure's Sounds switch is the games' master: the buses follow it.
  useEffect(() => applyMaster(prefs.sound), [prefs.sound]);

  return (
    <div
      className="gm-frame"
      data-reduced-motion={reducedMotion ? "true" : "false"}
      data-accent={accent}
      data-immersive={immersive ? "" : undefined}
      data-owns-top={ownsTop ? "" : undefined}
    >
      <GamesRail />
      {children}
      {settingsWanted ? <GameSettingsSheet /> : null}
    </div>
  );
}
