/** Where the cabinets' scenes put things, in their 320 × 180 box (Mitoshi `art/scenes.tsx`, by value). */
export const SCENE = {
  /** Candle Hop's candle pairs, along the scrolling strip. */
  candleXs: [40, 110, 180, 250, 320, 390, 460, 530],
  /** Lucky's three reels, and the step between faces on a reel. */
  reelXs: [70, 134, 198],
  faceStep: 28,
  /** Moonshot's stars. */
  stars: [
    [40, 30],
    [120, 60],
    [210, 24],
    [280, 70],
    [70, 140],
  ],
} as const;
