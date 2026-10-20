/** Range and Moonshot constants (Owarine `range/presets.ts`, Mitoshi `games/moonshot`). */

/** Tight · Balanced · Wide: the reference's half-widths in BTC dollars at its 5-minute anchor. */
export const RANGE_PRESETS = [
  { key: "tight", label: "Tight", half: 15 },
  { key: "balanced", label: "Balanced", half: 30 },
  { key: "wide", label: "Wide", half: 55 },
] as const;

/** The grid a centre may snap to, in dollars; the reference's $5 is one of them. */
export const NICE_UNITS = [
  0.000_01, 0.000_02, 0.000_05, 0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5,
  10, 20, 50, 100, 200, 500,
] as const;

/** Moonshot's reaches: what a right call pays, about (Mitoshi's aim pad, ×2 … ×25). */
export const MOONSHOT_REACHES = [2, 3, 5, 10, 25] as const;
