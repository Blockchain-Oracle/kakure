/**
 * The black hole's dials (21st.dev yura/blackhole-hero-section #23956 defaults unless noted). Units are horizon
 * radii: r = 1 is the event horizon, the disc starts at the innermost stable orbit (3).
 */

/** Mitoshi's vermilion (#E04D26) between a cream-hot rim and a deep ember edge (Kakure's recolour). */
export const GAS = { hot: "#FFE4D6", mid: "#E04D26", cool: "#5A1608" } as const;

export const CAMERA = { distance: 24, roll: -20 } as const;
export const DISK = {
  inner: 3,
  outer: 15,
  thickness: 0.26,
  density: 1,
  spin: 0.06,
  grain: 0.48,
  doppler: 0.35,
} as const;
/** The sky sphere: rays past this radius and heading out are gone for good. */
export const SKY = { distanceFactor: 1.35, discFactor: 2.4 } as const;

export const LOOK = {
  glow: 1,
  glowScale: 0.26,
  exposure: 0.92,
  vignette: 0.28,
  scrimStrength: 0.9,
  bloomThreshold: 0.85,
} as const;

export const RENDER = {
  maxDpr: 1.5,
  /** History weight per frame: buries the noise without dragging a tail behind the moving gas. */
  blendAlpha: 0.14,
  /** Bloom is scaled down before it goes into 8 bits (no half floats), and back after. */
  ldrPack: 0.12,
  bloomShift: 2,
  wideBlur: 2.6,
  /** Frames averaged into a still. */
  stillPasses: 16,
  /** The simulation clock a still is taken at (seconds), so the gas has wound into its spirals. */
  stillClock: 6,
  maxFrameS: 0.05,
  seedSlots: 64,
  seedStep: 17.13,
  ditherFps: 60,
  ditherWrap: 1000,
} as const;

/** A renderer with no GPU (SwiftShader, llvmpipe…) gets one still at these settings, never a loop. */
export const SOFTWARE = { steps: 130, scale: 0.34 } as const;
export const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|microsoft basic/i;

/** The batch drop: the disc brightens by `gain` and settles back with time constant `tau` (seconds). */
export const FLARE = { gain: 0.9, tau: 0.9 } as const;

/** Sub-pixel aims from the Halton 2,3 sequence: they cover the pixel far more evenly than random draws. */
export const HALTON: ReadonlyArray<readonly [number, number]> = [
  [0.5, 0.333],
  [0.25, 0.667],
  [0.75, 0.111],
  [0.125, 0.444],
  [0.625, 0.778],
  [0.375, 0.222],
  [0.875, 0.556],
  [0.0625, 0.889],
];

/** sRGB → linear light (the shader works in linear and gamma-encodes at the end). */
export const SRGB = { knee: 0.04045, slope: 12.92, offset: 0.055, scale: 1.055, gamma: 2.4, max: 255 } as const;

/** Where the copy sits: the composite darkens that edge so text reads over the picture. */
export const SCRIM_DIR = { left: 1, top: 3 } as const;

export const DEG = Math.PI / 180;

/**
 * The hero's two framings (yura's demo): desktop puts the hole high and right with the copy on a left scrim; a phone
 * turns it through 90° (hole low, copy high, veil from the top) with a wider field and fewer steps. Keep the focus in
 * step with `--fx`/`--fy` in styles/hero.css, which place the CSS ring before WebGL draws.
 */
export const VIEWS = {
  wide: { focus: [0.7, 0.46], scrim: "left", elevation: -5.5, fov: 42, steps: 260, resolution: 0.62 },
  narrow: { focus: [0.5, 0.72], scrim: "top", elevation: -7, fov: 58, steps: 180, resolution: 0.5 },
} as const;
