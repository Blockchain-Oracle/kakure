/**
 * What each mode is to a player standing in the hall (Mitoshi `features/games/catalog.ts` and core `games/types.ts`):
 * its route, name, whose money is at risk and whether it's open in this build. The economic kind is a fact of the mode,
 * not the screen: a mode whose kind is `none` never touches the wallet. A mode not built yet reads "Soon" and has no
 * Play until it is.
 */
export type GameId = "practice" | "line-rider" | "candle-hop" | "range" | "moonshot" | "lucky" | "duel";

/** `none` never moves money; `stake` is one real trade from your chips; `house` is a position the house prices. */
export type EconomicKind = "none" | "stake" | "house";

export interface GameEntry {
  id: GameId;
  name: string;
  href: string;
  economicKind: EconomicKind;
  /** The honest one-liner about whose money is at risk: the how-to's eyebrow, the sticker's title. */
  economicLabel: string;
  /** Built in this repository and open now. */
  open: boolean;
}

const ENTRIES: Readonly<Record<GameId, GameEntry>> = {
  practice: {
    id: "practice",
    name: "Beat the coin",
    href: "/games/practice",
    economicKind: "none",
    economicLabel: "Practice · no stake",
    open: true,
  },
  "line-rider": {
    id: "line-rider",
    name: "Line Rider",
    href: "/games/line-rider",
    economicKind: "none",
    economicLabel: "Arcade score · no stake",
    open: true,
  },
  "candle-hop": {
    id: "candle-hop",
    name: "Candle Hop",
    href: "/games/candle-hop",
    economicKind: "none",
    economicLabel: "Arcade score · no stake",
    open: true,
  },
  range: {
    id: "range",
    name: "Range",
    href: "/games/range",
    economicKind: "house",
    economicLabel: "A band priced by the house",
    open: true,
  },
  moonshot: {
    id: "moonshot",
    name: "Moonshot",
    href: "/games/moonshot",
    economicKind: "house",
    economicLabel: "A reach priced by the house",
    open: true,
  },
  lucky: {
    id: "lucky",
    name: "Lucky",
    href: "/games/lucky",
    economicKind: "stake",
    economicLabel: "One real trade from your chips",
    open: true,
  },
  duel: {
    id: "duel",
    name: "Duel",
    href: "/games/duel",
    economicKind: "none",
    economicLabel: "Head to head · no stake",
    open: true,
  },
};

/** The hall's rail order: the arcade first (it plays itself), then the house's games, then the rest. */
export const CABINET_ORDER: readonly GameId[] = [
  "line-rider",
  "candle-hop",
  "range",
  "moonshot",
  "lucky",
  "duel",
  "practice",
];

export function gameEntry(id: GameId): GameEntry {
  return ENTRIES[id];
}

/** The mode a route plays, or null on the hall, Rank and History (the rail's only routing). */
export function gameIdFromPath(pathname: string | null): GameId | null {
  if (!pathname?.startsWith("/games/")) return null;
  const id = pathname.slice("/games/".length).split("/")[0] ?? "";
  return id in ENTRIES ? (id as GameId) : null;
}
