// Ported from Mitoshi `features/games/arcade/sled/sled-draw.ts` (itself Senryo's `packages/arcade/src/sled-draw.ts`), on
// Kakure's field ink (up for a rise, down for a fall, the vermilion rider); the font is the games' pixel face.
/**
 * The sled's drawing (R7.2, research 10 §3): a side camera with the sled at 30 % of the width, the price line as neon
 * terrain — green where the price rose, coral where it fell, the minutes it was recorded along the floor — gaps with
 * their edges lit, a ski trail, the sled and its rider, the charge ring while pressing, sparks, dust and fragments,
 * floating words, speed streaks, combo heat, and the shake and flash. World units are the field's (FIELD_H tall);
 * everything is drawn from the scene and nothing in it steers the run.
 */
import { FIELD_H, SLED, tapeIndexAt } from "@kakure/arcade";
import { tint } from "../ink";
import type { ArcadeView } from "../use-arcade-loop";
import type { SledScene } from "./sled-scene";

type Ctx2D = CanvasRenderingContext2D;

const LOOK = {
  sledAt: 0.3,
  /** A narrow (portrait) screen still sees this much ahead: the field shrinks and more sky and ground show. */
  minWidth: 420,
  topMargin: 60,
  bottomMargin: 30,
  camEase: 0.12,
  lineWidth: 4,
  glow: 18,
  headGlow: 18,
  gridY: 45,
  labelEvery: 15,
  labelSize: 9,
  labelLift: 8,
  gapEdge: 46,
  gapLabelLift: 20,
  gapLabelSize: 11,
  runner: 4.5,
  body: 3.5,
  head: 7,
  ring: 11,
  ringWidth: 2.5,
  nose: 7,
  strut: 8,
  textSize: 16,
  streakFrom: 450,
  streaks: 7,
  streakLength: 90,
  heatPerCombo: 0.05,
  heatMax: 0.35,
  flashAlpha: 0.35,
  fillTop: 0.1,
  fillBottom: 0.015,
  /** The minutes sit under the score, clear of the HUD's bottom line. */
  labelTop: 60,
  trailChunks: 4,
  trailAlpha: 0.55,
  gridAlpha: 0.05,
  labelAlpha: 0.35,
  scarf: 9,
  scarfWave: 0.012,
  flashFloor: 0.02,
  textFade: 18,
} as const;

const HALF = 0.5;
const TWO = 2;
const FULL_TURN = Math.PI * TWO;
const QUARTER_TURN = Math.PI * HALF;
const MS = 1000;
const clock = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export function drawSled(view: ArcadeView, sc: SledScene, alpha: number, nowMs: number): void {
  const { ctx, w, h, dpr } = view;
  const { s, prev, ink } = sc;
  const k = Math.min(h / FIELD_H, w / LOOK.minWidth);
  const visibleW = w / k;
  const visibleH = h / k;
  const baseY = -(visibleH - FIELD_H) * HALF;
  // Interpolated sled.
  const bx = mix(prev.bx, s.b.x, alpha);
  const by = mix(prev.by, s.b.y, alpha);
  const fx = mix(prev.fx, s.f.x, alpha);
  const fy = mix(prev.fy, s.f.y, alpha);
  const rx = mix(prev.rx, s.r.x, alpha);
  const ry = mix(prev.ry, s.r.y, alpha);
  const midX = (bx + fx) * HALF;
  // The camera: the sled at 30 % of the width; up with a high flight, down into a gap.
  const camX = midX - visibleW * LOOK.sledAt;
  let wantY = Math.min(baseY, ry - LOOK.topMargin);
  if (ry > baseY + visibleH - LOOK.bottomMargin) wantY = ry - (visibleH - LOOK.bottomMargin);
  sc.camY += (wantY - sc.camY) * LOOK.camEase;
  const shakeX = (Math.random() * TWO - 1) * sc.shake;
  const shakeY = (Math.random() * TWO - 1) * sc.shake;

  // Ground.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, ink.raised);
  sky.addColorStop(1, ink.arena);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  if (s.combo > 1) {
    const heat = Math.min(LOOK.heatMax, (s.combo - 1) * LOOK.heatPerCombo);
    const glow = ctx.createRadialGradient(w * HALF, h, 0, w * HALF, h, h);
    glow.addColorStop(0, tint(ink.accent, heat));
    glow.addColorStop(1, tint(ink.accent, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
  }

  // World.
  ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (-camX * k + shakeX), dpr * (-sc.camY * k + shakeY));
  const top = sc.camY;
  const bottom = sc.camY + visibleH;
  ctx.strokeStyle = tint(ink.ink, LOOK.gridAlpha);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let y = Math.floor(top / LOOK.gridY) * LOOK.gridY; y < bottom; y += LOOK.gridY) {
    ctx.moveTo(camX, y);
    ctx.lineTo(camX + visibleW, y);
  }
  ctx.stroke();
  const font = view.palette.font;
  drawMinutes(ctx, sc, camX, visibleW, bottom, font);
  drawLine(ctx, sc, camX, visibleW, bottom, font);
  drawTrail(ctx, sc);
  drawRider(ctx, sc, { bx, by, fx, fy, rx, ry }, nowMs);
  for (const q of sc.particles) {
    ctx.fillStyle = tint(q.color, q.life / q.max);
    ctx.fillRect(q.x - q.size * HALF, q.y - q.size * HALF, q.size, q.size);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `800 ${LOOK.textSize}px ${font}`;
  for (const t of sc.texts) {
    ctx.fillStyle = tint(t.color, Math.min(1, t.life / LOOK.textFade));
    ctx.fillText(t.text, t.x, t.y);
  }

  // Screen: speed streaks and the wipeout's flash.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (s.speed > LOOK.streakFrom && !s.over && !sc.still) {
    const a = Math.min(1, (s.speed - LOOK.streakFrom) / LOOK.streakFrom) * HALF;
    ctx.strokeStyle = tint(ink.ink, a * HALF);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < LOOK.streaks; i++) {
      const y = Math.random() * h;
      const x = Math.random() * w;
      ctx.moveTo(x, y);
      ctx.lineTo(x + LOOK.streakLength, y);
    }
    ctx.stroke();
  }
  if (sc.flash > LOOK.flashFloor) {
    ctx.fillStyle = tint(ink.down, sc.flash * LOOK.flashAlpha);
    ctx.fillRect(0, 0, w, h);
  }
}

/** When the prints were recorded, along the floor every fifteen moves. */
function drawMinutes(ctx: Ctx2D, sc: SledScene, camX: number, visibleW: number, bottom: number, font: string) {
  const n = sc.tape.moves.length;
  if (n === 0) return;
  const perMin = SLED.seg * SLED.tapeSegs;
  const every = perMin * LOOK.labelEvery;
  ctx.fillStyle = tint(sc.ink.ink, LOOK.labelAlpha);
  ctx.strokeStyle = tint(sc.ink.ink, LOOK.gridAlpha);
  ctx.font = `600 ${LOOK.labelSize}px ${font}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.beginPath();
  for (let x = Math.ceil(camX / every) * every; x < camX + visibleW; x += every) {
    ctx.moveTo(x, sc.camY);
    ctx.lineTo(x, bottom);
    // The print under x, timed by the tape's own span (one move per recorded print).
    const atSec =
      sc.tape.fromSec + ((tapeIndexAt(sc.s, x, n) + 1) * (sc.tape.toSec - sc.tape.fromSec)) / Math.max(1, n);
    ctx.fillText(clock.format(atSec * MS), x + LOOK.labelLift / TWO, sc.camY + LOOK.labelTop);
  }
  ctx.stroke();
}

/** The price line: filled below, lit green where it rose and coral where it fell, open at the gaps. */
function drawLine(ctx: Ctx2D, sc: SledScene, camX: number, visibleW: number, bottom: number, font: string) {
  const { s, ink } = sc;
  const i0 = Math.max(0, Math.floor(camX / SLED.seg) - s.head);
  const i1 = Math.min(s.pts.length - 1, Math.ceil((camX + visibleW) / SLED.seg) - s.head + 1);
  const xOf = (i: number) => (s.head + i) * SLED.seg;
  const yOf = (i: number) => s.pts[i] as number;
  // Fill under the solid stretches.
  const fill = ctx.createLinearGradient(0, SLED.yTop, 0, bottom);
  fill.addColorStop(0, tint(ink.ink, LOOK.fillTop));
  fill.addColorStop(1, tint(ink.ink, LOOK.fillBottom));
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (let i = i0; i < i1; i++) {
    if (s.open[i]) continue;
    ctx.moveTo(xOf(i), bottom);
    ctx.lineTo(xOf(i), yOf(i));
    ctx.lineTo(xOf(i + 1), yOf(i + 1));
    ctx.lineTo(xOf(i + 1), bottom);
  }
  ctx.fill();
  // The line in runs of one colour.
  ctx.lineWidth = LOOK.lineWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.shadowBlur = LOOK.glow;
  let color = ink.up;
  let open = false;
  ctx.beginPath();
  for (let i = i0; i < i1; i++) {
    if (s.open[i]) {
      open = true;
      continue;
    }
    const rising = yOf(i + 1) < yOf(i);
    const next = yOf(i + 1) === yOf(i) ? color : rising ? ink.up : ink.down;
    if (next !== color) {
      stroke(ctx, color);
      color = next;
      ctx.beginPath();
      ctx.moveTo(xOf(i), yOf(i));
    }
    if (open || i === i0) ctx.moveTo(xOf(i), yOf(i));
    open = false;
    ctx.lineTo(xOf(i + 1), yOf(i + 1));
  }
  stroke(ctx, color);
  // Gap edges, lit, and the word over the drop.
  ctx.lineWidth = LOOK.lineWidth / TWO;
  for (let i = i0; i < i1; i++) {
    if (!s.open[i] || s.open[i - 1]) continue;
    let j = i;
    while (j < i1 && s.open[j]) j++;
    const edge = ctx.createLinearGradient(0, yOf(i), 0, yOf(i) + LOOK.gapEdge);
    edge.addColorStop(0, ink.down);
    edge.addColorStop(1, tint(ink.down, 0));
    ctx.strokeStyle = edge;
    ctx.beginPath();
    ctx.moveTo(xOf(i), yOf(i));
    ctx.lineTo(xOf(i), yOf(i) + LOOK.gapEdge);
    ctx.moveTo(xOf(j), yOf(j));
    ctx.lineTo(xOf(j), yOf(j) + LOOK.gapEdge);
    ctx.stroke();
    ctx.fillStyle = ink.down;
    ctx.font = `800 ${LOOK.gapLabelSize}px ${font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("GAP", (xOf(i) + xOf(j)) * HALF, Math.min(yOf(i), yOf(j)) - LOOK.gapLabelLift);
  }
  ctx.shadowBlur = 0;
}

function stroke(ctx: Ctx2D, color: string) {
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.stroke();
}

function drawTrail(ctx: Ctx2D, sc: SledScene) {
  const t = sc.trail;
  if (t.length < TWO) return;
  const chunk = Math.ceil(t.length / LOOK.trailChunks);
  ctx.lineWidth = TWO;
  for (let c = 0; c < LOOK.trailChunks; c++) {
    const from = c * chunk;
    const to = Math.min(t.length - 1, from + chunk);
    if (to <= from) continue;
    ctx.strokeStyle = tint(sc.ink.range, ((c + 1) / LOOK.trailChunks) * LOOK.trailAlpha);
    ctx.beginPath();
    for (const [i, q] of t.slice(from, to + 1).entries()) {
      if (i === 0) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
  }
}

/** The sled (runners with a curled nose, two struts) and the rider (body, glowing head, a scarf, the charge ring). */
function drawRider(
  ctx: Ctx2D,
  sc: SledScene,
  p: { bx: number; by: number; fx: number; fy: number; rx: number; ry: number },
  nowMs: number,
) {
  const { s, ink } = sc;
  const dx = p.fx - p.bx;
  const dy = p.fy - p.by;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // The normal toward the rider's side.
  const nx = uy;
  const ny = -ux;
  const mx = (p.bx + p.fx) * HALF;
  const my = (p.by + p.fy) * HALF;
  ctx.strokeStyle = ink.ink;
  ctx.lineCap = "round";
  ctx.lineWidth = LOOK.runner;
  ctx.beginPath();
  ctx.moveTo(p.bx, p.by);
  ctx.lineTo(p.fx, p.fy);
  ctx.quadraticCurveTo(p.fx + ux * LOOK.nose, p.fy + uy * LOOK.nose, p.fx + nx * LOOK.nose, p.fy + ny * LOOK.nose);
  ctx.stroke();
  ctx.lineWidth = LOOK.body;
  ctx.beginPath();
  ctx.moveTo(p.bx + ux * LOOK.strut, p.by + uy * LOOK.strut);
  ctx.lineTo(mx + nx * LOOK.strut, my + ny * LOOK.strut);
  ctx.lineTo(p.fx - ux * LOOK.strut, p.fy - uy * LOOK.strut);
  ctx.moveTo(mx + nx * LOOK.strut, my + ny * LOOK.strut);
  ctx.lineTo(p.rx, p.ry);
  ctx.stroke();
  // The scarf streams back from the head.
  const wave = Math.sin(nowMs * LOOK.scarfWave) * LOOK.scarf * HALF;
  ctx.strokeStyle = tint(ink.accent, LOOK.trailAlpha);
  ctx.beginPath();
  ctx.moveTo(p.rx, p.ry);
  ctx.lineTo(p.rx - ux * LOOK.scarf * TWO, p.ry - uy * LOOK.scarf * TWO + wave);
  ctx.stroke();
  ctx.shadowBlur = LOOK.headGlow;
  ctx.shadowColor = ink.accent;
  ctx.fillStyle = ink.accent;
  ctx.beginPath();
  ctx.arc(p.rx, p.ry, LOOK.head, 0, FULL_TURN);
  ctx.fill();
  ctx.shadowBlur = 0;
  if (s.grounded && s.held && s.heldTicks > 0 && !s.over) {
    const charge = Math.min(1, s.heldTicks / SLED.hopChargeTicks);
    ctx.strokeStyle = charge >= 1 ? ink.up : ink.ink;
    ctx.lineWidth = LOOK.ringWidth;
    ctx.beginPath();
    ctx.arc(p.rx, p.ry, LOOK.ring, -QUARTER_TURN, -QUARTER_TURN + FULL_TURN * charge);
    ctx.stroke();
  }
}
