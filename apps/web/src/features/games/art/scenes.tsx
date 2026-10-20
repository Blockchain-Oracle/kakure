"use client";

import { useId } from "react";
// Ported from Mitoshi `features/games/art/scenes.tsx` (Senryo's apps/web/public/games/*.svg and GameScene.tsx):
// each cabinet shows the game itself, moving: the sled on the price line with sparks, the coin through a candle canyon,
// the reels tumbling behind the payline while the lever swings, a card flipping on the table. Recoloured to Mitoshi:
// Senryo's acid green is profit, its coral loss, its gold the cabinet trim, the coin vermilion; the arena stays dark in
// both themes (the colours live in hall.css). Three scenes are new, in the same grammar: Range's band, Moonshot's
// rocket, Duel's two cards facing off. Still under reduced motion (hall.css).
import type { GameId } from "../catalog";
import { SCENE } from "./constants";
import "./scenes.css";

const LINE =
  "M0,120 L40,112 L80,118 L120,98 L160,104 L200,86 L240,92 L280,110 L320,102 L360,120 L400,128 L440,112 L480,118 L520,100 L560,108 L600,120 L640,112 L680,118";

function Ground({ id }: { id: string }) {
  return (
    <>
      <defs>
        <radialGradient id={`${id}g`} cx="50%" cy="0%" r="90%">
          <stop offset="0%" className="sc-hi" />
          <stop offset="100%" className="sc-lo" />
        </radialGradient>
      </defs>
      <rect width="320" height="180" fill={`url(#${id}g)`} />
    </>
  );
}

function LineRider({ id }: { id: string }) {
  return (
    <>
      <Ground id={id} />
      <g className="sc-scroll-line">
        <path d={`${LINE} L680,180 L0,180 Z`} className="sc-up-fill" opacity=".08" />
        <path d={LINE} className="sc-up-stroke" fill="none" strokeWidth="8" strokeOpacity=".18" />
        <path d={LINE} className="sc-up-stroke" fill="none" strokeWidth="3" strokeLinejoin="round" />
      </g>
      <g className="sc-bob">
        <rect x="92" y="84" width="34" height="6" rx="3" className="sc-ink" />
        <circle cx="109" cy="74" r="7" className="sc-accent" />
        <path d="M86 92 Q96 98 132 92" className="sc-trim-stroke" strokeWidth="2" fill="none" />
      </g>
      <circle className="sc-spark sc-up" cx="88" cy="92" r="2" />
      <circle className="sc-spark sc-spark-1 sc-up" cx="88" cy="92" r="2" />
      <circle className="sc-spark sc-spark-2 sc-up" cx="88" cy="92" r="2" />
    </>
  );
}

function CandleHop({ id }: { id: string }) {
  return (
    <>
      <Ground id={id} />
      <g className="sc-scroll-candles">
        {SCENE.candleXs.map((x, i) =>
          i % 2 === 0 ? (
            <g key={x} transform={`translate(${x} 0)`}>
              <rect width="24" height="30" rx="3" className="sc-up" />
              <rect y="100" width="24" height="80" rx="3" className="sc-down" />
              <line x1="12" x2="12" y1="0" y2="38" className="sc-ink-stroke" strokeOpacity=".4" />
            </g>
          ) : (
            <g key={x} transform={`translate(${x} 0)`}>
              <rect width="24" height="50" rx="3" className="sc-down" />
              <rect y="116" width="24" height="64" rx="3" className="sc-up" />
              <line x1="12" x2="12" y1="0" y2="58" className="sc-ink-stroke" strokeOpacity=".4" />
            </g>
          ),
        )}
      </g>
      <g className="sc-flap">
        <circle cx="96" cy="92" r="13" className="sc-accent" />
        <circle cx="96" cy="92" r="7" fill="none" className="sc-ink-stroke" strokeWidth="2" />
      </g>
    </>
  );
}

const FACES = ["₿", "▲", "×5", "Ξ", "▼", "×25"];

function Lucky({ id }: { id: string }) {
  const strip = [...FACES, ...FACES];
  return (
    <>
      <Ground id={id} />
      <defs>
        <clipPath id={`${id}w`}>
          <rect width="52" height="84" rx="8" />
        </clipPath>
      </defs>
      <rect x="52" y="34" width="216" height="112" rx="16" fill="none" className="sc-trim-stroke" strokeWidth="3" />
      {SCENE.reelXs.map((x, r) => (
        <g key={x} transform={`translate(${x} 48)`}>
          <rect width="52" height="84" rx="8" className="sc-raised" />
          <g clipPath={`url(#${id}w)`}>
            <g className={`sc-reel sc-reel-${r}`}>
              {strip.map((face, i) => (
                <text key={i} x="26" y={SCENE.faceStep + i * SCENE.faceStep} textAnchor="middle" className="sc-face">
                  {face}
                </text>
              ))}
            </g>
          </g>
        </g>
      ))}
      <line x1="60" x2="260" y1="90" y2="90" className="sc-trim-stroke" strokeOpacity=".6" strokeWidth="2" />
      <g className="sc-lever">
        <rect x="282" y="52" width="6" height="56" rx="3" className="sc-trim" />
        <circle cx="285" cy="50" r="9" className="sc-accent" />
      </g>
    </>
  );
}

function Card({ up, transform, className }: { up: boolean; transform: string; className?: string }) {
  return (
    <g transform={transform}>
      <g className={className}>
        <rect x="-26" y="-40" width="52" height="76" rx="8" className="sc-raised sc-trim-stroke" />
        <path
          d={up ? "M-12 4 L0 -12 L12 4" : "M-12 -8 L0 8 L12 -8"}
          className={up ? "sc-up-stroke" : "sc-down-stroke"}
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
        />
      </g>
    </g>
  );
}

function Practice({ id }: { id: string }) {
  return (
    <>
      <Ground id={id} />
      <Card up transform="translate(84 96) rotate(-14)" />
      <Card up={false} transform="translate(122 96) rotate(-7)" />
      <Card up transform="translate(160 96)" className="sc-cardflip" />
      <Card up={false} transform="translate(198 96) rotate(7)" />
      <Card up transform="translate(236 96) rotate(14)" />
    </>
  );
}

function Range({ id }: { id: string }) {
  return (
    <>
      <Ground id={id} />
      <rect x="0" y="70" width="320" height="44" className="sc-band" />
      <line x1="0" x2="320" y1="70" y2="70" className="sc-trim-stroke" strokeDasharray="6 6" />
      <line x1="0" x2="320" y1="114" y2="114" className="sc-trim-stroke" strokeDasharray="6 6" />
      <g className="sc-scroll-line">
        <path
          d={LINE}
          transform="translate(0 -14)"
          className="sc-ink-stroke"
          fill="none"
          strokeWidth="3"
          strokeLinejoin="round"
        />
      </g>
      <circle cx="250" cy="92" r="6" className="sc-accent sc-pulse" />
    </>
  );
}

function Moonshot({ id }: { id: string }) {
  return (
    <>
      <Ground id={id} />
      <line x1="0" x2="320" y1="40" y2="40" className="sc-trim-stroke" strokeDasharray="4 8" />
      {SCENE.stars.map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" className="sc-ink sc-twinkle" />
      ))}
      <g className="sc-rocket">
        <path d="M160 70 L172 100 L160 96 L148 100 Z" className="sc-accent" />
        <rect x="154" y="100" width="12" height="18" rx="3" className="sc-ink" />
        <path d="M156 120 L160 140 L164 120 Z" className="sc-up sc-flame" />
      </g>
    </>
  );
}

function Duel({ id }: { id: string }) {
  return (
    <>
      <Ground id={id} />
      <Card up transform="translate(112 92) rotate(-10)" className="sc-face-off-l" />
      <Card up={false} transform="translate(208 92) rotate(10)" className="sc-face-off-r" />
      <text x="160" y="98" textAnchor="middle" className="sc-vs">
        VS
      </text>
    </>
  );
}

const SCENES: Readonly<Record<GameId, (p: { id: string }) => React.JSX.Element>> = {
  practice: Practice,
  lucky: Lucky,
  duel: Duel,
  range: Range,
  moonshot: Moonshot,
  "line-rider": LineRider,
  "candle-hop": CandleHop,
};

/** One cabinet's 16:9 scene; decorative — the cabinet's own name is the label. */
export function GameScene({ game, className }: { game: GameId; className?: string }) {
  const id = useId().replace(/[:«»]/g, "");
  const Scene = SCENES[game];
  return (
    <svg
      viewBox="0 0 320 180"
      className={`sc ${className ?? ""}`}
      aria-hidden
      focusable="false"
      preserveAspectRatio="xMidYMid slice"
    >
      <Scene id={id} />
    </svg>
  );
}
