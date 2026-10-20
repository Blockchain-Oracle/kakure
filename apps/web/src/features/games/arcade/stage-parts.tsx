"use client";

import { RollingNumber } from "@kakure/ui-web";
import { Pause, Play, Trophy, Volume2, VolumeX, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useMuted, useMuteToggle } from "../audio";
import { CARD_READY_MS, GRIP_SEGMENTS } from "./constants";
import { ARCADE } from "./copy";

/**
 * The run's plates (Mitoshi `arcade/StageParts.tsx`, from Senryo): the HUD's top bar (the score rolling, the best, the
 * combo's heat, then 44 px sound, pause and exit), the 3-2-1-GO, the pause plate and the game-over card (score, a NEW
 * BEST stamp, where the service's replay ranked it, the run's numbers, Play again and Exit).
 */
export interface StageResult {
  score: number;
  isBest: boolean;
  /** The replay's verdict and rank, or why the run stayed local; null while it's being checked. */
  note: string | null;
  tone: "refused" | null;
  stats: readonly { label: string; value: string }[];
  /** The service's word that this run is the nickname's best: only a replayed, recorded run earns it. */
  earned: boolean;
}

export function StageTop({
  score,
  combo,
  best,
  canPause,
  onPause,
  onExit,
}: {
  score: number;
  combo: string | null;
  best: number | null;
  canPause: boolean;
  onPause: () => void;
  onExit: () => void;
}) {
  const muted = useMuted();
  const toggleMute = useMuteToggle();
  return (
    <div className="as-top">
      <div className="as-score-col">
        <RollingNumber value={ARCADE.fmt(score)} className="as-score" />
        {best !== null ? <span className="as-dim">{ARCADE.title.best(ARCADE.fmt(best))}</span> : null}
      </div>
      {combo ? (
        <span key={combo} className="as-combo">
          {combo}
        </span>
      ) : (
        <span />
      )}
      <div className="as-icons">
        <button
          type="button"
          className="as-icon"
          aria-pressed={muted}
          aria-label={muted ? ARCADE.stage.sound : ARCADE.stage.mute}
          onClick={toggleMute}
        >
          {muted ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
        </button>
        {canPause ? (
          <button type="button" className="as-icon" aria-label={ARCADE.stage.pause} onClick={onPause}>
            <Pause aria-hidden />
          </button>
        ) : null}
        <button type="button" className="as-icon" aria-label={ARCADE.stage.exit} onClick={onExit}>
          <X aria-hidden />
        </button>
      </div>
    </div>
  );
}

const CELLS = Array.from({ length: GRIP_SEGMENTS }, (_, i) => i);

/** The sled's hop charge as a segmented 8-bit bar (21st.dev theorcdev/8-bit-xp-bar, revamped): ten cells. */
export function GripMeter({ grip }: { grip: number }) {
  const lit = Math.ceil(Math.max(0, Math.min(1, grip)) * GRIP_SEGMENTS);
  return (
    <div className="as-grip" data-full={grip >= 1 || undefined}>
      <span className="as-grip-k">{ARCADE.stage.grip}</span>
      <meter className="sr-only" min={0} max={GRIP_SEGMENTS} value={lit} aria-label={ARCADE.stage.grip} />
      <span className="as-grip-cells" aria-hidden>
        {CELLS.map((cell) => (
          <span key={cell} data-on={cell < lit || undefined} />
        ))}
      </span>
    </div>
  );
}

export function Countdown({ n, dealing }: { n: number; dealing: boolean }) {
  return (
    <div className="as-count" aria-live="assertive">
      <span key={n} data-go={n === 0 || undefined}>
        {n === 0 ? ARCADE.stage.go : n}
      </span>
      {dealing ? <span className="as-dealing">{ARCADE.stage.dealing}</span> : null}
    </div>
  );
}

export function PausePlate({ onResume, onExit }: { onResume: () => void; onExit: () => void }) {
  return (
    <div className="as-plate">
      <div className="as-card">
        <span className="as-card-title">{ARCADE.stage.paused}</span>
        <button type="button" className="gm-cta as-cta" onClick={onResume}>
          <Play aria-hidden className="as-cta-icon" /> {ARCADE.stage.resume}
        </button>
        <button type="button" className="gm-cta gm-cta--quiet as-ghost" onClick={onExit}>
          {ARCADE.stage.exit}
        </button>
      </div>
    </div>
  );
}

export function OverPlate({
  title,
  result,
  extra,
  onAgain,
  onExit,
}: {
  title: string;
  result: StageResult;
  /** The nickname call to action, when the run waits on one. */
  extra: ReactNode;
  onAgain: () => void;
  onExit: () => void;
}) {
  // A key still held from the run (Space) mustn't land on the focused Play again: the card listens after a beat.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), CARD_READY_MS);
    return () => window.clearTimeout(t);
  }, []);
  const when = (act: () => void) => () => {
    if (ready) act();
  };
  return (
    <div className="as-plate" role="dialog" aria-label={`${title} · ${ARCADE.over.over}`}>
      <div className="as-card">
        <span className="as-dim as-card-eyebrow">{title}</span>
        <span className="as-score as-score--big">{ARCADE.fmt(result.score)}</span>
        {result.isBest ? <span className="as-stamp">{ARCADE.over.newBest}</span> : null}
        {result.earned ? (
          <span className="as-earned">
            <span className="as-earned-ring" aria-hidden>
              <Trophy />
            </span>
            <span className="as-earned-text">{ARCADE.stage.earned}</span>
          </span>
        ) : null}
        <span className="as-dim" data-tone={result.tone ?? undefined} aria-live="polite">
          {result.note ?? ARCADE.over.checking}
        </span>
        <dl className="as-stats">
          {result.stats.map((s) => (
            <div key={s.label}>
              <dt>{s.label}</dt>
              <dd>{s.value}</dd>
            </div>
          ))}
        </dl>
        {extra}
        <button type="button" className="gm-cta as-cta" onClick={when(onAgain)}>
          {ARCADE.over.again}
        </button>
        <button type="button" className="gm-cta gm-cta--quiet as-ghost" onClick={when(onExit)}>
          {ARCADE.stage.exit}
        </button>
      </div>
    </div>
  );
}
