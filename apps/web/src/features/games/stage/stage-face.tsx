"use client";

import type { DeckCard } from "@kakure/arcade";
import { cadenceLabel } from "@kakure/domain";
import { Mark } from "@kakure/ui-web";
import { Clock } from "lucide-react";
import type { ReactNode } from "react";
import { assetFor } from "@/features/markets/assets";
import { BearMark, BullMark, CoinMark } from "../art/pixel-art";
import { formatLeft, RingFace } from "../kit/countdown-ring";
import { STAGE } from "./copy";

const MS = 1000;
/** Flicky's ramp on every clock: calm, then the accent inside ten minutes, the down colour inside two, a pulse at 30 s. */
const NEAR_SEC = 600;
const LAST_SEC = 120;
const PULSE_SEC = 30;

export function clockUrgency(remainingSec: number): { level: "calm" | "near" | "last"; pulse: boolean } {
  return {
    level: remainingSec <= LAST_SEC ? "last" : remainingSec <= NEAR_SEC ? "near" : "calm",
    pulse: remainingSec > 0 && remainingSec <= PULSE_SEC,
  };
}

export interface StagePill {
  label: string;
  value: ReactNode;
  tone?: "up" | "down" | "live";
}

/**
 * One card's face in Flicky's five bands (Mitoshi `stage/StageFace.tsx`): the title banner (the pair, its length,
 * N/M), the art window behind a CRT face (the coin at rest, the bull on an upward drag, the bear on a downward one), the
 * live line, the quote box (an eyebrow, the question, the clock) and the two stat pills; the deck draws the calls.
 * `watch` is Practice's question, "in 30 s?", one full ring that starts with the swipe.
 */
export function StageFace({
  card,
  place,
  eyebrow,
  question,
  pills,
  nowMs,
  line,
  coach,
  clock = { kind: "window" },
}: {
  card: DeckCard;
  place: { position: number; total: number };
  eyebrow: string;
  question: ReactNode;
  pills: readonly StagePill[];
  nowMs: number;
  line?: ReactNode;
  coach?: { up: string; down: string } | null;
  clock?: { kind: "window" } | { kind: "watch"; sec: number };
}) {
  const remainingSec = card.expirySec - Math.floor(nowMs / MS);
  const urgency = clockUrgency(remainingSec);
  const info = assetFor({ kind: "close", subject: card.asset });
  return (
    <>
      <div className="st-band st-band--title">
        <span className="st-title-asset">
          <Mark mark={info.mark} label={card.asset} size="inline" />
          {STAGE.pair(card.asset)}
        </span>
        {clock.kind === "window" ? <span className="st-cadence">{cadenceLabel(card.intervalSec)}</span> : null}
        <span className="st-title-place">
          {place.position}/{place.total}
        </span>
      </div>

      {coach ? (
        <>
          <span className="st-coach st-coach--up" aria-hidden>
            {coach.up}
          </span>
          <span className="st-coach st-coach--down" aria-hidden>
            {coach.down}
          </span>
        </>
      ) : null}
      <div className="st-art crt-screen" data-has-line={line ? "" : undefined} aria-hidden>
        <span className="st-art-screw st-art-screw--tl" />
        <span className="st-art-screw st-art-screw--tr" />
        <span className="st-art-screw st-art-screw--bl" />
        <span className="st-art-screw st-art-screw--br" />
        <CoinMark className="st-art-idle" />
        <BullMark className="st-art-up" />
        <BearMark className="st-art-down" />
      </div>

      {line ? <div className="st-line">{line}</div> : null}

      <div className="st-band st-band--quote">
        <span className="st-quote-inset" aria-hidden />
        <p className="st-eyebrow">{eyebrow}</p>
        <p className="st-question">{question}</p>
        {clock.kind === "watch" ? (
          <span className="st-watch-ring" aria-hidden>
            <RingFace fraction={1}>
              <span className="gm-ring-left">{`${clock.sec}s`}</span>
            </RingFace>
          </span>
        ) : (
          <p className="st-clock" role="timer" data-urgency={urgency.level} data-pulse={urgency.pulse || undefined}>
            <Clock aria-hidden />
            {nowMs === 0
              ? STAGE.clockPending
              : remainingSec <= 0
                ? STAGE.settling
                : STAGE.settlesIn(formatLeft(remainingSec * MS))}
          </p>
        )}
      </div>

      <div className="st-pills">
        {pills.map((pill) => (
          <div key={pill.label} className="st-band st-pill">
            <span className="st-pill-k">{pill.label}</span>
            <span className="st-pill-v" data-tone={pill.tone}>
              {pill.value}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
