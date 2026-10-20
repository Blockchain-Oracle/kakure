/** The share card's layout (Owarine `share-png.ts`'s 1600×1000 card, as Mitoshi's cream stub), in card pixels. */
export const CARD = {
  w: 1600,
  h: 1000,
  pad: 96,
  radius: 64,
  inset: 24,
  callPx: 92,
  resultPx: 260,
  metaPx: 38,
  sealPx: 180,
  brandPx: 84,
  taglinePx: 34,
  urlPx: 30,
  qrSize: 220,
  qrQuiet: 1,
  minFontPx: 24,
  fontStep: 4,
  leftShare: 0.62,
  callY: 250,
  resultY: 520,
  metaY: 610,
  meta2Y: 660,
  brandY: 330,
  taglineY: 386,
  tagline2Y: 430,
  urlY: 500,
  qrY: 540,
  perforationGap: 28,
  perforationRadius: 7,
  sealAlpha: 0.12,
  urlAlpha: 0.7,
} as const;

/** X post wording by ROI (Owarine's tiers, never an amount). */
export const ROI_TIERS = { moon: 100, great: 25, rough: -50 } as const;

/** The card is always paper (light) whatever the theme, so it carries the light theme's up and down inks. */
export const CARD_WIN = "#2E6B4F";
export const CARD_LOSE = "#C2381F";
/** A download's object URL is released after this long. */
export const REVOKE_MS = 5_000;

/** Font weights on the card. */
export const WEIGHT = { semi: 600, bold: 800, black: 900 } as const;
