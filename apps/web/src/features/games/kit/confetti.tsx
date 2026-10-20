"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";
import { CONFETTI, DEG_PER_HALF_TURN, MS_PER_SEC } from "./constants";
import "./kit.css";

/**
 * One celebration burst over a winning verdict (Mitoshi `components/ui/confetti-burst.tsx`, from 21st.dev
 * motiondotdev/motion-confetti): fired once by the host, particles in the brand's inks, the source's physics kept,
 * flown on the Web Animations API, and nothing at all under reduced motion.
 */
const COLORS = ["var(--vermilion)", "var(--paper)", "var(--foreground)", "var(--up)"] as const;
const SHAPES = ["circle", "rect", "strip"] as const;
const FULL_TURN_DEG = DEG_PER_HALF_TURN * 2;

interface Particle {
  frames: Keyframe[];
  size: number;
  color: string;
  shape: (typeof SHAPES)[number];
}

const between = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const pickOf = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)] as T;

function flight(angle: number, speed: number, rotation: number, tilt: number): Keyframe[] {
  const frames: Keyframe[] = [];
  let x = 0;
  let y = 0;
  let v = speed;
  for (let i = 0; i <= CONFETTI.frames; i++) {
    const t = i / CONFETTI.frames;
    if (i > 0) {
      for (let k = 0; k < CONFETTI.substeps; k++) {
        x += Math.cos(angle) * v;
        y += Math.sin(angle) * v + CONFETTI.gravity;
        v *= CONFETTI.drag;
      }
    }
    frames.push({
      transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotateY(${(tilt * FULL_TURN_DEG * t).toFixed(0)}deg) rotate(${rotation}deg)`,
      opacity: t <= CONFETTI.fadeFrom ? 1 : Math.max(0, 1 - (t - CONFETTI.fadeFrom) * 2),
    });
  }
  return frames;
}

function Dot({ particle }: { particle: Particle }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const run = ref.current?.animate(particle.frames, {
      duration: CONFETTI.durationSec * MS_PER_SEC,
      easing: "linear",
      fill: "forwards",
    });
    return () => run?.cancel();
  }, [particle]);
  const { size, shape } = particle;
  const style: CSSProperties = {
    width: shape === "strip" ? size * CONFETTI.stripWidth : shape === "rect" ? size * CONFETTI.rectWidth : size,
    height: shape === "strip" ? size * CONFETTI.stripLength : size,
    background: particle.color,
    borderRadius: shape === "circle" ? "50%" : 1,
  };
  return <span ref={ref} className="gm-confetti-dot" style={style} />;
}

export function ConfettiBurst({ fire, reduced }: { fire: boolean; reduced: boolean }) {
  const [particles, setParticles] = useState<Particle[] | null>(null);
  useEffect(() => {
    if (!fire || reduced) return;
    const spread = (CONFETTI.spreadDeg * Math.PI) / DEG_PER_HALF_TURN;
    setParticles(
      Array.from({ length: CONFETTI.count }, () => ({
        frames: flight(
          -Math.PI / 2 + (spread / 2 - Math.random() * spread),
          between(CONFETTI.speedLo, CONFETTI.speedHi),
          Math.random() * FULL_TURN_DEG,
          Math.random() * CONFETTI.tiltTurns,
        ),
        size: between(CONFETTI.sizeLo, CONFETTI.sizeHi),
        color: pickOf(COLORS),
        shape: pickOf(SHAPES),
      })),
    );
    const done = window.setTimeout(() => setParticles(null), CONFETTI.durationSec * MS_PER_SEC);
    return () => window.clearTimeout(done);
  }, [fire, reduced]);
  if (!particles) return null;
  return (
    <span aria-hidden className="gm-confetti">
      {particles.map((particle, i) => (
        <Dot key={i} particle={particle} />
      ))}
    </span>
  );
}
