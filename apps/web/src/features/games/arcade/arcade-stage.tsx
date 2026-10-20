"use client";

import type { ArcadeGame } from "@kakure/arcade";
import { Switch } from "@kakure/ui-web";
import { Play } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameScene } from "../art/scenes";
import { useGames } from "../games-provider";
import { NicknameSheet } from "../player/nickname-sheet";
import { useAttractTape } from "../player/queries";
import { ArcadeBoard } from "./arcade-board";
import { AttractCanvas } from "./attract-canvas";
import { PRELOAD_RUN_MS } from "./constants";
import { ARCADE } from "./copy";
import { useArcadeScore } from "./use-arcade-score";
import "./arcade.css";

// The run (3-2-1-GO, the HUD, the cards) is an island: fetched while the cabinet idles, mounted on Play.
const loadRunLayer = () => import("./run-layer").then((m) => m.RunLayer);
const RunLayer = dynamic(loadRunLayer, { ssr: false, loading: () => null });

/** Full screen and landscape are asked for inside the Play tap, as browsers require; refusals are fine. */
function goFullScreen(): void {
  const el = document.documentElement;
  if (!el.requestFullscreen || document.fullscreenElement) return;
  el.requestFullscreen({ navigationUI: "hide" }).then(
    () => {
      const orientation = screen.orientation as ScreenOrientation & { lock?: (to: string) => Promise<void> };
      void orientation.lock?.("landscape").catch(() => undefined);
    },
    () => undefined,
  );
}

/**
 * `/games/line-rider` and `/games/candle-hop`: the cabinet (Mitoshi `arcade/ArcadeStage.tsx`, from Senryo's
 * ArcadeScreen). The game plays itself on a real tape behind a big Play, your best and how it's scored, then the calm
 * switch and the board. Play hands the run to its own layer. With a nickname a run posts once the service's replay
 * reproduces it; without one it plays the same game and the card asks for one before it posts.
 */
export function ArcadeStage({ game }: { game: ArcadeGame }) {
  const { reducedMotion, feedback } = useGames();
  const { board, standing, nickname, ability, nextRun, post } = useArcadeScore(game);
  const attractTape = useAttractTape();
  const words = ARCADE.games[game];
  const [playing, setPlaying] = useState(false);
  const [calm, setCalm] = useState(false);
  const [sessionBest, setSessionBest] = useState<number | null>(null);
  const [nameOpen, setNameOpen] = useState(false);
  const nameAnswer = useRef<((claimed: boolean) => void) | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => void loadRunLayer(), PRELOAD_RUN_MS);
    return () => window.clearTimeout(t);
  }, []);
  // Reduced motion offers the calmer ramp; it stays a choice the player can flip either way.
  useEffect(() => {
    if (reducedMotion) setCalm(true);
  }, [reducedMotion]);

  const boardBest = standing.data?.best ?? null;
  const best = sessionBest === null ? boardBest : boardBest === null ? sessionBest : Math.max(sessionBest, boardBest);
  const onFinished = useCallback(
    (score: number) => setSessionBest((b) => (b === null ? score : Math.max(b, score))),
    [],
  );

  const askNickname = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        nameAnswer.current = resolve;
        setNameOpen(true);
      }),
    [],
  );
  const closeName = (claimed: boolean) => {
    setNameOpen(false);
    nameAnswer.current?.(claimed);
    nameAnswer.current = null;
  };

  const play = () => {
    feedback("tap");
    goFullScreen();
    setPlaying(true);
  };

  return (
    <div className="gm-page ar-cabinet">
      <div className="ar-attract">
        {reducedMotion || playing ? <GameScene game={game} /> : <AttractCanvas game={game} tape={attractTape} />}
        <span className="ar-attract-scrim" aria-hidden />
        <div className="ar-attract-plate">
          <button type="button" className="gm-cta ar-play" onClick={play}>
            <Play aria-hidden className="ar-play-icon" />
            {ARCADE.title.play}
          </button>
          <span className="ar-plate-best">
            {best === null ? ARCADE.title.noBest : ARCADE.title.best(ARCADE.fmt(best))}
          </span>
          <span className="ar-plate-free">{ARCADE.title.free}</span>
        </div>
      </div>
      <p className="ar-line">{words.line}</p>
      <div className="ar-cab-row">
        <div className="ar-calm">
          <span className="ar-calm-text">
            <span className="ar-calm-label">{ARCADE.calm.label}</span>
            <span className="ar-calm-hint">{ARCADE.calm.hint}</span>
          </span>
          <Switch label={ARCADE.calm.label} checked={calm} onChange={setCalm} />
        </div>
        {nickname ? null : (
          <button type="button" className="gm-cta gm-cta--quiet" onClick={() => void askNickname()}>
            {ARCADE.nickname.title}
          </button>
        )}
      </div>
      <ArcadeBoard board={board.data} failed={board.isError} nickname={nickname} standing={standing.data} />
      {playing ? (
        <RunLayer
          game={game}
          calm={calm}
          best={best}
          ability={ability}
          nextRun={nextRun}
          post={post}
          askNickname={askNickname}
          onFinished={onFinished}
          onClose={() => setPlaying(false)}
        />
      ) : null}
      <NicknameSheet open={nameOpen} onClose={() => closeName(false)} onClaimed={() => closeName(true)} />
    </div>
  );
}
