"use client";

import { useEffect, useRef } from "react";
import { CAMERA, DEG, DISK, FLARE, GAS, HALTON, LOOK, RENDER, SCRIM_DIR, SKY, SOFTWARE } from "./constants";
import { fullFrameTriangle, type Gl, hexToLinear, link, makeTarget, openContext, type Prog, type Target } from "./gl";
import { BLEND_FRAG, BLUR_FRAG, BRIGHT_FRAG, COMPOSITE_FRAG, SCENE_FRAG } from "./shaders";

/**
 * The black hole under the landing's hero: "bets go in, only the odds escape" (plan §0, beyond the references #1).
 *
 * From 21st.dev yura/blackhole-hero-section (#23956), installed with `21st add` and reskinned: every pixel fires one
 * ray and walks it backwards through Schwarzschild space (u'' + u = 3M·u²), so the halo over the shadow is the far
 * side of the accretion disc bent over the top, not a drawn ring. Kept: the ray march, the Keplerian gas and its
 * two-clock wind, Doppler beaming, the temporal average, the bloom chain and the composite. Changed for Kakure: the
 * gas runs vermilion, the camera is fixed, a software renderer or reduced motion (system or in-app) gets one settled
 * still frame instead of a loop, the canvas fades in once its first frame exists, and `flareAt` brightens the disc
 * for a moment when a signed batch lands (the batch drop, plan §0 #3).
 */
export interface BlackHoleView {
  /** Where the hole sits, as fractions of width and height from the top left. */
  focus: readonly [number, number];
  /** The edge the copy sits on; the composite darkens it. */
  scrim: keyof typeof SCRIM_DIR;
  elevation: number;
  fov: number;
  steps: number;
  resolution: number;
}

const MS_PER_S = 1000;
/** Pixel centre (jitter is an offset from it) and half the field of view. */
const HALF = 0.5;

type Targets = { scene: Target; histA: Target; histB: Target; bloomA: Target; bloomB: Target };

function motionReduced(): boolean {
  return document.documentElement.dataset.motion === "reduce" || matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function BlackHole({
  view,
  flareAt,
  className,
}: {
  view: BlackHoleView;
  /** `performance.now()` of the latest batch drop (0: none yet). */
  flareAt: number;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef({ view, flareAt });
  live.current = { view, flareAt };

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    const opened = canvas ? openContext(canvas) : null;
    if (!host || !canvas || !opened) return;
    const { ctx, software, format } = opened;
    const still = software || motionReduced();
    const programs = [SCENE_FRAG, BLEND_FRAG, BRIGHT_FRAG, BLUR_FRAG, COMPOSITE_FRAG].map((source) =>
      link(ctx, source),
    );
    const [scene, blend, bright, blur, composite] = programs;
    if (!scene || !blend || !bright || !blur || !composite) return;
    const vbo = fullFrameTriangle(ctx);
    const colours = { hot: hexToLinear(GAS.hot), mid: hexToLinear(GAS.mid), cool: hexToLinear(GAS.cool) };

    let targets: Targets | null = null;
    let frames = 0;
    let size = { w: 0, h: 0 };

    const dropTargets = () => {
      for (const t of targets ? Object.values(targets) : []) {
        ctx.deleteTexture(t.tex);
        ctx.deleteFramebuffer(t.fb);
      }
      targets = null;
      frames = 0;
    };

    const resize = (): boolean => {
      const rect = host.getBoundingClientRect();
      const dpr = software ? 1 : Math.min(window.devicePixelRatio || 1, RENDER.maxDpr);
      const w = Math.max(2, Math.round(rect.width * dpr));
      const h = Math.max(2, Math.round(rect.height * dpr));
      if (targets && w === size.w && h === size.h) return false;
      size = { w, h };
      canvas.width = w;
      canvas.height = h;
      dropTargets();
      const scale = software ? SOFTWARE.scale : live.current.view.resolution;
      const sw = Math.max(2, Math.round(w * scale));
      const sh = Math.max(2, Math.round(h * scale));
      const full = () => makeTarget(ctx, format, sw, sh);
      const quarter = () =>
        makeTarget(ctx, format, Math.max(2, sw >> RENDER.bloomShift), Math.max(2, sh >> RENDER.bloomShift));
      const [s, a, b, ba, bb] = [full(), full(), full(), quarter(), quarter()];
      if (s && a && b && ba && bb) targets = { scene: s, histA: a, histB: b, bloomA: ba, bloomB: bb };
      return true;
    };

    const render = (t: number, now: number) => {
      if (!targets) return;
      const { view: v, flareAt: flare } = live.current;
      const since = (now - flare) / MS_PER_S;
      const boost = flare > 0 && since >= 0 ? FLARE.gain * Math.exp(-since / FLARE.tau) : 0;
      drawScene(ctx, scene, targets.scene, v, t, frames, software, 1 + boost, colours, format.hdr);
      const shown = foldHistory(ctx, blend, targets, frames);
      frames++;
      bloom(ctx, bright, blur, shown, targets, format);
      drawComposite(ctx, composite, shown, targets.bloomA, size, v, t, format);
    };

    let clock = still ? RENDER.stillClock : 0;
    let raf = 0;
    let last = 0;
    let visible = true;
    const settle = () => {
      for (let i = 0; i < RENDER.stillPasses; i++) render(clock, 0);
    };
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (visible) {
        clock += last ? Math.min(RENDER.maxFrameS, (now - last) / MS_PER_S) : 0;
        render(clock, now);
      }
      last = now;
    };

    resize();
    if (still) settle();
    else raf = requestAnimationFrame(tick);
    host.dataset.ready = "true";

    const resizeObserver = new ResizeObserver(() => {
      if (resize() && still) settle();
    });
    resizeObserver.observe(host);
    const intersection = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? true;
    });
    intersection.observe(host);
    const onVisibility = () => {
      visible = !document.hidden;
      last = 0;
    };
    // A dead context paints white: hide the canvas and leave the CSS ring behind it.
    const onLost = (event: Event) => {
      event.preventDefault();
      cancelAnimationFrame(raf);
      delete host.dataset.ready;
    };
    document.addEventListener("visibilitychange", onVisibility);
    canvas.addEventListener("webglcontextlost", onLost);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onLost);
      dropTargets();
      ctx.deleteBuffer(vbo);
      for (const prog of programs) if (prog) ctx.deleteProgram(prog.program);
      // The context stays alive on purpose: StrictMode runs effects twice on one canvas, and a lost context would be
      // handed back dead to the next getContext.
    };
  }, []);

  return (
    <div ref={hostRef} aria-hidden className={className}>
      <canvas ref={canvasRef} className="lp-hole-canvas" />
    </div>
  );
}

function pass(ctx: Gl, prog: Prog, target: Target | null, size: { w: number; h: number }) {
  ctx.useProgram(prog.program);
  ctx.bindFramebuffer(ctx.FRAMEBUFFER, target ? target.fb : null);
  ctx.viewport(0, 0, target ? target.w : size.w, target ? target.h : size.h);
}

function bind(ctx: Gl, tex: WebGLTexture, unit: number) {
  ctx.activeTexture(ctx.TEXTURE0 + unit);
  ctx.bindTexture(ctx.TEXTURE_2D, tex);
}

const TRIANGLE_VERTICES = 3;
const draw = (ctx: Gl) => ctx.drawArrays(ctx.TRIANGLES, 0, TRIANGLE_VERTICES);

/** The ray march into `target`. The camera sits just off the disc's plane looking at the hole, rolled diagonal. */
function drawScene(
  ctx: Gl,
  prog: Prog,
  target: Target,
  v: BlackHoleView,
  t: number,
  frame: number,
  software: boolean,
  brightness: number,
  colours: Record<"hot" | "mid" | "cool", [number, number, number]>,
  hdr: boolean,
) {
  const el = v.elevation * DEG;
  const camX = CAMERA.distance * Math.cos(el);
  const camY = CAMERA.distance * Math.sin(el);
  const fx = -Math.cos(el);
  const fy = -Math.sin(el);
  // right = cross(forward, +y), normalised; up = cross(right, forward); then both turned by the roll.
  const rz = -fx / Math.abs(fx);
  const ux = -rz * fy;
  const uy = rz * fx;
  const cr = Math.cos(CAMERA.roll * DEG);
  const sr = Math.sin(CAMERA.roll * DEG);
  const aim = HALTON[frame % HALTON.length] ?? [HALF, HALF];
  const u = prog.u;
  pass(ctx, prog, target, { w: target.w, h: target.h });
  ctx.uniform2f(u.uRes ?? null, target.w, target.h);
  ctx.uniform1f(u.uTime ?? null, t);
  ctx.uniform3f(u.uCamPos ?? null, camX, camY, 0);
  ctx.uniform3f(u.uRight ?? null, ux * sr, uy * sr, rz * cr);
  ctx.uniform3f(u.uUp ?? null, ux * cr, uy * cr, -rz * sr);
  ctx.uniform3f(u.uFwd ?? null, fx, fy, 0);
  ctx.uniform1f(u.uTanHalf ?? null, Math.tan(v.fov * HALF * DEG));
  ctx.uniform2f(u.uFocus ?? null, v.focus[0], 1 - v.focus[1]);
  ctx.uniform1f(u.uSteps ?? null, software ? SOFTWARE.steps : v.steps);
  ctx.uniform1f(u.uSkyR ?? null, Math.max(CAMERA.distance * SKY.distanceFactor, DISK.outer * SKY.discFactor));
  ctx.uniform1f(u.uDiskIn ?? null, DISK.inner);
  ctx.uniform1f(u.uDiskOut ?? null, DISK.outer);
  ctx.uniform1f(u.uThick ?? null, DISK.thickness);
  ctx.uniform1f(u.uDensity ?? null, DISK.density);
  ctx.uniform1f(u.uSpin ?? null, DISK.spin * Math.PI * 2);
  ctx.uniform1f(u.uGrain ?? null, DISK.grain);
  ctx.uniform1f(u.uBright ?? null, brightness);
  ctx.uniform1f(u.uDoppler ?? null, DISK.doppler);
  ctx.uniform3f(u.uHot ?? null, ...colours.hot);
  ctx.uniform3f(u.uMid ?? null, ...colours.mid);
  ctx.uniform3f(u.uCool ?? null, ...colours.cool);
  ctx.uniform1f(u.uEncode ?? null, hdr ? 0 : 1);
  ctx.uniform2f(u.uJitter ?? null, aim[0] - HALF, aim[1] - HALF);
  ctx.uniform1f(u.uSeed ?? null, (frame % RENDER.seedSlots) * RENDER.seedStep);
  draw(ctx);
}

/** Folds the new frame into the running average and returns the target that now holds it. */
function foldHistory(ctx: Gl, prog: Prog, targets: Targets, frame: number): Target {
  pass(ctx, prog, targets.histB, targets.histB);
  bind(ctx, targets.scene.tex, 0);
  bind(ctx, targets.histA.tex, 1);
  ctx.uniform1i(prog.u.uCur ?? null, 0);
  ctx.uniform1i(prog.u.uPrev ?? null, 1);
  ctx.uniform1f(prog.u.uAlpha ?? null, frame === 0 ? 1 : RENDER.blendAlpha);
  draw(ctx);
  const shown = targets.histB;
  targets.histB = targets.histA;
  targets.histA = shown;
  return shown;
}

/** The bright pass at a quarter size, then two rounds of separable blur, the second wider. */
function bloom(
  ctx: Gl,
  bright: Prog,
  blur: Prog,
  shown: Target,
  targets: Targets,
  format: { hdr: boolean; pack: number },
) {
  const { bloomA, bloomB } = targets;
  pass(ctx, bright, bloomA, bloomA);
  bind(ctx, shown.tex, 0);
  ctx.uniform1i(bright.u.uTex ?? null, 0);
  ctx.uniform2f(bright.u.uTexel ?? null, 1 / shown.w, 1 / shown.h);
  ctx.uniform1f(bright.u.uDecode ?? null, format.hdr ? 0 : 1);
  ctx.uniform1f(bright.u.uPack ?? null, format.pack);
  ctx.uniform1f(bright.u.uThreshold ?? null, LOOK.bloomThreshold);
  draw(ctx);
  const step = (src: Target, dst: Target, dx: number, dy: number) => {
    pass(ctx, blur, dst, dst);
    bind(ctx, src.tex, 0);
    ctx.uniform1i(blur.u.uTex ?? null, 0);
    ctx.uniform2f(blur.u.uStep ?? null, dx / dst.w, dy / dst.h);
    draw(ctx);
  };
  step(bloomA, bloomB, 1, 0);
  step(bloomB, bloomA, 0, 1);
  step(bloomA, bloomB, RENDER.wideBlur, 0);
  step(bloomB, bloomA, 0, RENDER.wideBlur);
}

function drawComposite(
  ctx: Gl,
  prog: Prog,
  shown: Target,
  bloomed: Target,
  size: { w: number; h: number },
  v: BlackHoleView,
  t: number,
  format: { hdr: boolean; pack: number },
) {
  const c = prog.u;
  pass(ctx, prog, null, size);
  bind(ctx, shown.tex, 0);
  bind(ctx, bloomed.tex, 1);
  ctx.uniform1i(c.uScene ?? null, 0);
  ctx.uniform1i(c.uBloom ?? null, 1);
  ctx.uniform1f(c.uDecode ?? null, format.hdr ? 0 : 1);
  ctx.uniform1f(c.uPack ?? null, format.pack);
  ctx.uniform1f(c.uGlow ?? null, LOOK.glow * LOOK.glowScale);
  ctx.uniform1f(c.uExposure ?? null, LOOK.exposure);
  ctx.uniform1f(c.uVignette ?? null, LOOK.vignette);
  ctx.uniform1f(c.uScrimDir ?? null, SCRIM_DIR[v.scrim]);
  ctx.uniform1f(c.uScrimAmt ?? null, LOOK.scrimStrength);
  ctx.uniform1f(c.uSeed ?? null, (t * RENDER.ditherFps) % RENDER.ditherWrap);
  draw(ctx);
}
