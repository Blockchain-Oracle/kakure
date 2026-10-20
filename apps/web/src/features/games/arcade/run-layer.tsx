"use client";

import type { ArcadeGame, RunIssued } from "@kakure/arcade";
import { Share2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SITE_ORIGIN } from "@/constants";
import { renderShareCard, saveCard } from "@/features/terminal/share/card";
import { startBgm, stopBgm } from "../audio";
import { useGames } from "../games-provider";
import "./run-layer.css";
import { pixelFont } from "../pixel-font";
import { countSfx, hopCrashSfx, hopScoreSfx, milestoneSfx, regainSfx, rideCrashSfx, rideStartSfx } from "./arcade-sfx";
import { COUNT_FROM, COUNT_MS, FLIP_TICK_BASE, LENGTH_DECIMALS, MS_PER_SEC } from "./constants";
import { ARCADE } from "./copy";
import type { HopCue } from "./hop/hop-run";
import { HopCanvas } from "./hop-canvas";
import { type ArcadeRun, localSeed, type RunEnd } from "./run";
import type { SledCue } from "./sled/sled-scene";
import { SledCanvas, type SledHud } from "./sled-canvas";
import { Countdown, GripMeter, OverPlate, PausePlate, type StageResult, StageTop } from "./stage-parts";
import type { PostAbility, PostOutcome } from "./use-arcade-score";

/**
 * The run's own full-screen layer (Mitoshi `arcade/RunLayer.tsx`, from Senryo's ArcadeStage): it counts 3-2-1-GO with
 * its beeps while the service deals a seed and its tape, starts the music and plays the engine. A run that won't be
 * posted can pause (the button, Esc, P); a posted run can't (Senryo's rule). Then the game-over card with the
 * service's replay verdict. A run without a nickname waits on the card for one, then posts.
 */
type Phase = "countdown" | "playing" | "paused" | "over";

export interface RunLayerProps {
  game: ArcadeGame;
  calm: boolean;
  best: number | null;
  ability: PostAbility;
  nextRun: () => Promise<RunIssued | null>;
  post: (end: RunEnd) => Promise<PostOutcome>;
  /** Opens the nickname sheet; resolves true once one is claimed. */
  askNickname: () => Promise<boolean>;
  onFinished: (score: number) => void;
  onClose: () => void;
}

function noteOf(
  ability: PostAbility,
  posting: boolean,
  outcome: PostOutcome | null,
): Pick<StageResult, "note" | "tone"> {
  if (outcome?.kind === "posted") {
    return { note: outcome.rank === 1 ? ARCADE.over.topOfBoard : ARCADE.over.ranked(outcome.rank), tone: null };
  }
  if (outcome?.kind === "refused") return { note: ARCADE.over.refused(outcome.why), tone: "refused" };
  if (posting) return { note: null, tone: null };
  return { note: ability === "noName" ? ARCADE.over.noName : ARCADE.over.offline, tone: null };
}

export function RunLayer({
  game,
  calm,
  best,
  ability,
  nextRun,
  post,
  askNickname,
  onFinished,
  onClose,
}: RunLayerProps) {
  const { reducedMotion, feedback } = useGames();
  const words = ARCADE.games[game];
  const [phase, setPhase] = useState<Phase>("countdown");
  const [count, setCount] = useState(COUNT_FROM);
  const [issued, setIssued] = useState<RunIssued | null | undefined>(undefined);
  const [run, setRun] = useState<ArcadeRun | null>(null);
  const [hud, setHud] = useState({ score: 0, combo: 1, grip: 0 });
  const [result, setResult] = useState<StageResult | null>(null);
  const [waitingName, setWaitingName] = useState<RunEnd | null>(null);
  const lastEnd = useRef<RunEnd | null>(null);
  const streak = useRef(0);
  const runId = useRef(0);
  const canPause = ability !== "yes";

  // Each countdown asks for a fresh seed (one score per seed); the run waits on GO until it's dealt.
  useEffect(() => {
    if (phase !== "countdown" || count !== COUNT_FROM) return;
    let alive = true;
    setIssued(undefined);
    void nextRun().then((answer) => {
      if (alive) setIssued(answer);
    });
    return () => {
      alive = false;
    };
  }, [phase, count, nextRun]);

  useEffect(() => {
    if (phase !== "countdown") return;
    if (count > 0) {
      countSfx(false);
      const t = window.setTimeout(() => setCount((n) => n - 1), COUNT_MS);
      return () => window.clearTimeout(t);
    }
    if (issued === undefined) return;
    countSfx(true);
    const t = window.setTimeout(() => {
      startBgm();
      if (game === "line-rider") rideStartSfx();
      streak.current = 0;
      runId.current += 1;
      const tape = issued?.tape ?? null;
      setRun(
        issued
          ? {
              id: runId.current,
              seed: issued.seed,
              calm,
              ...(tape ? { tape: tape.points, moves: tape.moves, tapeMeta: tape } : {}),
            }
          : { id: runId.current, seed: localSeed(), calm },
      );
      setPhase("playing");
    }, COUNT_MS);
    return () => window.clearTimeout(t);
  }, [phase, count, issued, game, calm]);

  const posted = issued !== null;
  const settle = useCallback(
    (end: RunEnd, outcome: PostOutcome | null, posting: boolean) => {
      const isBest = best !== null && end.score > best;
      setResult({
        score: end.score,
        isBest,
        stats: [
          {
            label: ARCADE.stage.length,
            value: ARCADE.over.length((end.durationMs / MS_PER_SEC).toFixed(LENGTH_DECIMALS)),
          },
          { label: ARCADE.stage.seed, value: end.seed },
        ],
        earned: outcome?.kind === "posted" && outcome.isBest,
        ...noteOf(posted ? ability : "unavailable", posting, outcome),
      });
    },
    [ability, best, posted],
  );

  const onEnd = useCallback(
    (end: RunEnd) => {
      if (game === "line-rider") {
        rideCrashSfx();
        feedback("crash");
      }
      stopBgm();
      onFinished(end.score);
      lastEnd.current = end;
      setPhase("over");
      if (best !== null && end.score > best) feedback("card-win");
      if (!posted) return settle(end, null, false);
      if (ability === "noName") {
        setWaitingName(end);
        return settle(end, null, false);
      }
      settle(end, null, true);
      void post(end).then((outcome) => settle(end, outcome, false));
    },
    [ability, best, feedback, game, onFinished, post, posted, settle],
  );

  const claimThenPost = async () => {
    const end = waitingName;
    if (!end || !(await askNickname())) return;
    setWaitingName(null);
    settle(end, null, true);
    settle(end, await post(end), false);
  };

  const onSledHud = useCallback((h: SledHud) => setHud({ score: h.score, combo: h.combo, grip: h.charge }), []);
  const onHopHud = useCallback((score: number) => setHud({ score, combo: 1, grip: 0 }), []);
  const onSledCue = useCallback(
    (cue: SledCue) => {
      if (cue.kind === "hop") feedback("tap");
      else if (cue.kind === "gap") hopScoreSfx(cue.n - 1);
      else if (cue.kind === "land") {
        regainSfx();
        if (cue.hard) feedback("confirm");
      } else if (cue.kind === "combo") milestoneSfx(cue.combo * 2);
      else if (cue.kind === "milestone") milestoneSfx(cue.m);
      else if (cue.kind === "flip") {
        milestoneSfx(cue.n + FLIP_TICK_BASE);
        feedback("confirm");
      }
    },
    [feedback],
  );
  const onHopCue = useCallback(
    (cue: HopCue) => {
      if (cue === "flap") feedback("tap");
      else if (cue === "score") hopScoreSfx(streak.current++);
      else {
        hopCrashSfx();
        feedback("crash");
      }
    },
    [feedback],
  );

  // Esc / P pause a run that may pause; the page under the layer holds still; leaving ends the music and full screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Escape" || e.key === "p" || e.key === "P") && canPause) {
        setPhase((p) => (p === "playing" ? "paused" : p));
      }
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      stopBgm();
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, [canPause]);

  const again = () => {
    feedback("tap");
    setResult(null);
    setWaitingName(null);
    setHud({ score: 0, combo: 1, grip: 0 });
    setCount(COUNT_FROM);
    setPhase("countdown");
  };

  const share = () => {
    const end = lastEnd.current;
    if (!end) return;
    const url = `${SITE_ORIGIN}/games/${game}`;
    void renderShareCard({
      call: words.title,
      score: ARCADE.fmt(end.score),
      when: new Date().toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }),
      url,
      foot: ARCADE.share.foot,
    }).then((blob) => saveCard(blob, `kakure-${game}-${Math.round(end.score)}.png`));
  };

  const paused = phase === "paused" || phase === "over";
  const combo = game === "line-rider" && hud.combo > 1 ? ARCADE.hud.combo(hud.combo) : null;
  const tape = issued?.tape ?? null;
  const hint =
    phase === "playing" || phase === "countdown"
      ? [words.control, tape ? ARCADE.stage.tapeOf(tape.feed, tape.fromSec, tape.toSec) : null]
          .filter(Boolean)
          .join(" · ")
      : "";

  return createPortal(
    <div
      className={`as-layer gm-stage-layer ${pixelFont.variable}`}
      data-phase={phase}
      data-reduced-motion={reducedMotion ? "true" : "false"}
    >
      <div className="ar-screen as-screen as-screen--full" data-phase={phase === "playing" ? "playing" : "title"}>
        {game === "line-rider" ? (
          <SledCanvas
            run={run}
            paused={paused}
            reduced={reducedMotion}
            onHud={onSledHud}
            onEnd={onEnd}
            onCue={onSledCue}
          />
        ) : (
          <HopCanvas
            run={run}
            paused={paused}
            reduced={reducedMotion}
            onHud={onHopHud}
            onEnd={onEnd}
            onCue={onHopCue}
          />
        )}
      </div>
      <div className="as-hud">
        <StageTop
          score={hud.score}
          combo={combo}
          best={best}
          canPause={canPause && phase === "playing"}
          onPause={() => setPhase("paused")}
          onExit={onClose}
        />
        <div className="as-foot">
          {game === "line-rider" ? <GripMeter grip={hud.grip} /> : null}
          <span className="as-dim as-hint">{hint}</span>
        </div>
      </div>
      {phase === "countdown" ? <Countdown n={count} dealing={count === 0 && issued === undefined} /> : null}
      {phase === "paused" ? <PausePlate onResume={() => setPhase("playing")} onExit={onClose} /> : null}
      {phase === "over" && result ? (
        <OverPlate
          title={words.title}
          result={result}
          onAgain={again}
          onExit={onClose}
          extra={
            <>
              {waitingName ? (
                <button type="button" className="gm-cta as-cta as-name" onClick={() => void claimThenPost()}>
                  {ARCADE.over.noName}
                </button>
              ) : null}
              <button type="button" className="gm-cta gm-cta--quiet as-ghost" onClick={share}>
                <Share2 aria-hidden className="as-cta-icon" /> {ARCADE.share.label}
              </button>
            </>
          }
        />
      ) : null}
    </div>,
    document.body,
  );
}
