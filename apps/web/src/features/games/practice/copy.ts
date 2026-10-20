import { PRACTICE_WATCH_SEC } from "@kakure/arcade";

/**
 * Everything Practice says, "Beat the coin" (Mitoshi `practice/copy.ts`). The honesty line (scored on the live price
 * 30 s after each swipe, not at the Window's settlement) lives in the ⓘ how-to; on the stage each element carries one
 * short fragment.
 */
export const PRACTICE = {
  title: "Beat the coin",
  card: {
    eyebrow: (asset: string) => `will ${asset} be higher`,
    question: `in ${PRACTICE_WATCH_SEC} s?`,
    live: "Live",
    pays: "Up pays now",
    noPrice: "Waiting for the live price",
    coach: { up: `↑ higher in ${PRACTICE_WATCH_SEC} s`, down: "↓ lower" },
  },
  versus: { you: "You", coin: "Coin" },
  strip: {
    label: "Your deck",
    now: "Now",
    noPrice: "No price",
    tile: {
      upcoming: (t: string, n: number, of: number) => `${t}, card ${n} of ${of}`,
      active: (t: string, n: number, of: number) => `${t}, card ${n} of ${of}, now`,
      racing: (t: string, you: "up" | "down", coin: "up" | "down", left: number | null) =>
        `${t}, you ${you}, coin ${coin}${left === null ? "" : `, ${left} seconds left`}`,
      scored: (t: string, r: "won" | "lost" | "flat") => `${t}, ${r}`,
      unscored: (t: string) => `${t}, no price`,
    },
  },
  wait: {
    dealing: "Dealing live Windows",
    price: "Waiting for the price",
    lineRider: "Play Line Rider",
    retry: "Try again",
  },
  deal: {
    none: { title: "No Window long enough", body: "A card needs two minutes left. The next one opens soon." },
    offline: { title: "Windows didn't load", body: "Nothing signed arrived from the site." },
  },
  watch: { label: "Watching the race", left: (sec: number) => `${sec}s`, leader: "leads" },
  result: {
    title: "Round over",
    you: "You",
    bot: "Coin",
    botNote: "A coin flip, not a player.",
    won: "You beat the coin",
    lost: "The coin took it",
    tied: "Level",
    call: { up: "Up", down: "Down" },
    cardResult: { won: "Won", lost: "Lost", flat: "Flat" },
    flatNote: "Flat is nobody's card.",
    unscored: (n: number) => `${n} unscored · no price`,
    again: "Play again",
    toReal: "Call it for real",
    toArcade: "Play Line Rider",
  },
  scope: "Free · nothing leaves this device",
} as const;
