/**
 * Every word the swipe stage says (Mitoshi `stage/copy.ts`), for Practice now and the Duel next. The gesture is
 * vertical because the question is: up means the price rises, down means it falls (and a horizontal swipe fights a
 * phone's own back gesture).
 */
export const STAGE = {
  up: "Up",
  down: "Down",
  hint: "Swipe ↑ or ↓",
  hintHeld: "Not playable now · reason above",
  hintLocked: (side: "up" | "down") =>
    `${side === "up" ? "Up" : "Down"} locked · try ${side === "up" ? "Down" : "Up"}.`,
  locked: "locked",
  cardOf: (n: number, total: number) => `Card ${n} of ${total}`,
  cardLabel: (asset: string, cadence: string) => `${asset}, ${cadence} Window`,
  pair: (asset: string) => `${asset} / USD`,
  settlesIn: (clock: string) => `settles in ${clock}`,
  settling: "settling…",
  clockPending: "–:––",
  announce: (n: number, total: number, asset: string, cadence: string) =>
    `Card ${n} of ${total}. ${asset}, ${cadence} Window.`,
  empty: { title: "Nothing to play", body: "Every card played." },
} as const;
