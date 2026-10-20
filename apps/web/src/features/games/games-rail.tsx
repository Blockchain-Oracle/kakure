"use client";

import { ChevronLeft, CircleHelp, SlidersHorizontal, Volume2, VolumeX } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NetworkChip } from "@/features/network/network-switch";
import { useMuted, useMuteToggle } from "./audio";
import { type EconomicKind, gameEntry, gameIdFromPath } from "./catalog";
import { GAMES } from "./copy";
import { useGames } from "./games-provider";
import { Sticker, type StickerTone } from "./kit/sticker";
import { rememberGame } from "./last-game";

// The how-to loads on its first open, so the rail carries no sheet into first load.
const HowToSheet = dynamic(() => import("./how-to-sheet").then((m) => m.HowToSheet), {
  ssr: false,
  loading: () => null,
});

/** The cabinet sticker's tone by whose money is at risk: free reads up, your stake the accent, the house's quiet. */
export const ECON_TONE: Readonly<Record<EconomicKind, StickerTone>> = { none: "up", stake: "accent", house: "surface" };

export function SettingsButton() {
  const { setSettingsOpen, feedback } = useGames();
  return (
    <button
      type="button"
      className="gm-rail-icon"
      aria-label={GAMES.rail.settings}
      title={GAMES.rail.settings}
      onClick={() => {
        feedback("tap");
        setSettingsOpen(true);
      }}
    >
      <SlidersHorizontal aria-hidden />
    </button>
  );
}

function Back() {
  return (
    <Link href="/games" className="gm-rail-icon" aria-label={GAMES.rail.back} title={GAMES.rail.back}>
      <ChevronLeft aria-hidden />
    </Link>
  );
}

/**
 * The one strip every game stage carries (Mitoshi `GamesRail.tsx`): back, the mode's name and its sticker, then ?,
 * sound and settings. Rank and History carry back, their title and settings. The hall has no rail: its own head
 * carries the title. On a phone the strip owns the top, so the network chip rides here.
 */
export function GamesRail() {
  const pathname = usePathname();
  const id = gameIdFromPath(pathname);
  const [howTo, setHowTo] = useState(false);
  const [howToWanted, setHowToWanted] = useState(false);
  const muted = useMuted();
  const toggleMute = useMuteToggle();
  useEffect(() => rememberGame(pathname), [pathname]);

  const page =
    pathname === "/games/rank" ? GAMES.rank.title : pathname === "/games/history" ? GAMES.history.title : null;
  if (page) {
    return (
      <div className="gm-rail">
        <div className="gm-rail-inner">
          <Back />
          <h1 className="gm-rail-mode">{page}</h1>
          <div className="gm-rail-right">
            <span className="gm-rail-net">
              <NetworkChip />
            </span>
            <SettingsButton />
          </div>
        </div>
      </div>
    );
  }
  if (!id) return null;
  const entry = gameEntry(id);
  return (
    <>
      {howToWanted ? <HowToSheet id={id} open={howTo} onClose={() => setHowTo(false)} /> : null}
      <div className="gm-rail">
        <div className="gm-rail-inner">
          <Back />
          <h1 className="gm-rail-mode">{entry.name}</h1>
          <Sticker tone={ECON_TONE[entry.economicKind]} title={entry.economicLabel}>
            {GAMES.econ[entry.economicKind]}
          </Sticker>
          <div className="gm-rail-right">
            <span className="gm-rail-net">
              <NetworkChip />
            </span>
            <button
              type="button"
              className="gm-rail-icon"
              aria-label={GAMES.howToWords.open}
              title={GAMES.howToWords.open}
              onClick={() => {
                setHowToWanted(true);
                setHowTo(true);
              }}
            >
              <CircleHelp aria-hidden />
            </button>
            <button
              type="button"
              className="gm-rail-icon gm-rail-mute"
              aria-pressed={muted}
              aria-label={muted ? GAMES.rail.sound : GAMES.rail.mute}
              title={muted ? GAMES.rail.sound : GAMES.rail.mute}
              onClick={toggleMute}
            >
              {muted ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
            </button>
            <SettingsButton />
          </div>
        </div>
      </div>
    </>
  );
}
