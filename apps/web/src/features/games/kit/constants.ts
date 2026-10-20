/** The games kit's figures (Mitoshi `components/kit`, `components/ui/{confetti-burst,leaderboard-*}`, AccountAvatar). */

/** The ring face's path length and its geometry in a 100-unit box. */
export const RING_LENGTH = 100;
export const RING = { centre: 50, radius: 46, stroke: 6 } as const;
/** The ring turns the accent in a Window's last tenth. */
export const RING_URGENT = 0.1;
export const SEC_PER_MIN = 60;
export const SEC_PER_HOUR = 3_600;
export const MS_PER_SEC = 1_000;

/** The marble: a 80-unit box, three blurred shapes seeded by the name (after boring-avatars' "marble", MIT). */
export const MARBLE = {
  size: 80,
  blur: 7,
  shiftRange: 8,
  scaleRange: 4,
  scaleBase: 1.2,
  scaleStep: 10,
  turn: 360,
} as const;
export const MARBLE_HASH_MULT = 31;
export const MARBLE_SHAPE_A = "M32.414 59.35L50.376 70.5H72.5v-71H33.728L26.5 13.381l19.057 27.08L32.414 59.35z";
export const MARBLE_SHAPE_B =
  "M22.216 24L0 46.75l14.108 38.129L78 86l-3.081-59.276-22.378 4.005 12.972 20.186-23.35 27.395L22.215 24z";
export const DECIMAL = 10;

/** One confetti burst: 36 particles over 1.8 s, a 100° fan upwards, Motion's physics kept. */
export const CONFETTI = {
  count: 36,
  durationSec: 1.8,
  frames: 36,
  spreadDeg: 100,
  substeps: 3,
  gravity: 3,
  drag: 0.91,
  speedLo: 9,
  speedHi: 15,
  sizeLo: 6,
  sizeHi: 11,
  stripWidth: 0.3,
  stripLength: 2,
  rectWidth: 0.7,
  fadeFrom: 0.5,
  tiltTurns: 2,
} as const;
export const DEG_PER_HALF_TURN = 180;
/** The podium's places; the list crowns the same three. */
export const PODIUM_PLACES = 3;
