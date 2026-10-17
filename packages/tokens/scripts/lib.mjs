/**
 * Shared helpers for the token generator and the contrast gate.
 * Pure functions over tokens.json; no third-party dependencies.
 */
import { readFileSync } from "node:fs";

export const TOKENS_URL = new URL("../tokens.json", import.meta.url);

export const THEME_NAMES = ["light", "dark", "testnet-light", "testnet-dark"];
const META_KEY = /^_/;

export function readTokens() {
  return JSON.parse(readFileSync(TOKENS_URL, "utf8"));
}

/** Strips `_note`-style keys from an object. */
export function withoutMeta(object) {
  return Object.fromEntries(Object.entries(object).filter(([key]) => !META_KEY.test(key)));
}

/** Testnet layers only carry the keys they change; this returns every theme fully resolved. */
export function resolveThemes(tokens) {
  const resolved = {};
  for (const name of THEME_NAMES) {
    const theme = tokens.themes[name];
    const base = theme._extends ? withoutMeta(tokens.themes[theme._extends]) : {};
    resolved[name] = { ...base, ...withoutMeta(theme) };
  }
  return resolved;
}

/** The keys a layer overrides (used to emit only the difference in CSS). */
export function layerKeys(tokens, name) {
  return Object.keys(withoutMeta(tokens.themes[name]));
}

const HEX = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i;

export function parseHex(hex) {
  const match = HEX.exec(hex);
  if (!match) {
    throw new Error(`Not a #RRGGBB or #RRGGBBAA colour: ${hex}`);
  }
  const [, rgb, alpha] = match;
  const value = Number.parseInt(rgb, 16);
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
    a: alpha === undefined ? 1 : Number.parseInt(alpha, 16) / 0xff,
  };
}

/** Source-over composite of a (possibly translucent) colour on an opaque ground. */
export function composite(top, ground) {
  const a = top.a;
  return {
    r: Math.round(top.r * a + ground.r * (1 - a)),
    g: Math.round(top.g * a + ground.g * (1 - a)),
    b: Math.round(top.b * a + ground.b * (1 - a)),
    a: 1,
  };
}

function channel(value) {
  const c = value / 0xff;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance. */
export function luminance({ r, g, b }) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Closed-form damped spring from 0 to 1 (mass m, stiffness k, damping c, starting at rest).
 * Returns the displacement at time t in seconds.
 */
function springAt({ stiffness, damping, mass }, t) {
  const omega = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (zeta < 1) {
    const omegaD = omega * Math.sqrt(1 - zeta * zeta);
    const decay = Math.exp(-zeta * omega * t);
    return 1 - decay * (Math.cos(omegaD * t) + ((zeta * omega) / omegaD) * Math.sin(omegaD * t));
  }
  if (zeta === 1) {
    return 1 - Math.exp(-omega * t) * (1 + omega * t);
  }
  const root = Math.sqrt(zeta * zeta - 1);
  const r1 = -omega * (zeta - root);
  const r2 = -omega * (zeta + root);
  return 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
}

const SPRING_STEP_S = 0.001;
const SPRING_MAX_S = 3;
const SPRING_REST = 0.001;
const SPRING_SAMPLES = 48;
const MS_PER_S = 1000;
const LINEAR_DECIMALS = 4;

/**
 * Turns a spring into a CSS `linear()` easing plus the duration it needs, so springs run in CSS
 * (no animation library on the web; reduced motion stays a CSS concern, kawase.md §4.6).
 * Without overshoot the motion ends at the first arrival, like Reanimated's overshootClamping.
 */
export function springToCss(spring) {
  let settle = SPRING_MAX_S;
  let lastAway = 0;
  for (let t = SPRING_STEP_S; t <= SPRING_MAX_S; t += SPRING_STEP_S) {
    const x = springAt(spring, t);
    if (!spring.overshoot && x >= 1) {
      settle = t;
      break;
    }
    if (Math.abs(x - 1) > SPRING_REST) {
      lastAway = t;
    }
    settle = lastAway + SPRING_STEP_S;
  }
  const points = [];
  for (let i = 0; i <= SPRING_SAMPLES; i += 1) {
    const t = (settle * i) / SPRING_SAMPLES;
    let x = i === SPRING_SAMPLES ? 1 : springAt(spring, t);
    if (!spring.overshoot) {
      x = Math.min(x, 1);
    }
    points.push(Number(x.toFixed(LINEAR_DECIMALS)));
  }
  return { easing: `linear(${points.join(", ")})`, durationMs: Math.round(settle * MS_PER_S) };
}

export function camel(name) {
  return name.replace(/-([a-z0-9])/g, (_, letter) => letter.toUpperCase());
}
