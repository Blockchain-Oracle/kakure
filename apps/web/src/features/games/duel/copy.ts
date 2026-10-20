import { DUEL_PICK_SEC } from "@kakure/arcade";

/**
 * Everything the Duel says (Mitoshi `duel/copy.ts`, at its word count or fewer). The free duel has no pot: the stage
 * says the state and the one action; the rules (commitments, outcomes, Elo) sit behind ⓘ.
 */
export const DUEL = {
  title: "Duel",
  entry: {
    find: "Find a duel",
    note: `Three live Windows · ${DUEL_PICK_SEC} s to call them · more right calls wins`,
    needName: "Pick a nickname to duel",
  },
  queue: {
    title: "Finding an opponent",
    leave: "Leave",
    waited: (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")} waiting`,
    band: "The search widens the longer you wait",
  },
  lobby: { you: "You", opponent: "Opponent", vs: "VS", rating: (n: number) => `${n} Elo` },
  pick: {
    eyebrow: (asset: string) => `${asset} · duel`,
    question: "Higher at the close?",
    closes: "Picks close",
    opponent: "Opponent",
    opponentPicking: "Picking",
    opponentIn: "Locked in",
    left: (sec: number) => `${sec}s`,
  },
  sealed: {
    title: "Your calls are sealed",
    waiting: "Waiting on your opponent",
    revealing: "Both locked in · opening the calls",
    note: "Only a hash of your calls left this device. Neither your opponent nor the arcade can read them until both of you are locked in.",
  },
  result: {
    you: "You",
    opponent: "Opponent",
    right: (n: number, of: number) => `${n} of ${of} right`,
    won: "You won the duel",
    lost: "Your opponent won",
    tie: "A draw",
    void: "No result · every card refunded, or nobody called",
    forfeitWon: "Your opponent didn't call in time · you win, your rating holds",
    forfeitLost: "You didn't call in time · it counts as a loss",
    waiting: "Each card settles at its Window's close",
    settlesIn: (clock: string) => `settles in ${clock}`,
    outcome: { U: "Up", D: "Down", refund: "Refund" } as Record<string, string>,
    side: { up: "Up", down: "Down" } as Record<string, string>,
    none: "—",
    delta: (n: number) => `${n >= 0 ? "+" : ""}${n} Elo`,
    again: "Duel again",
  },
  share: {
    label: "Share",
    call: (opponent: string) => `Duel vs ${opponent}`,
    score: (mine: number, theirs: number) => `${mine}–${theirs}`,
    foot: (verdict: string) => `${verdict.split(" · ")[0]} · free, on live Windows`,
  },
  tile: { title: "Your duel is live", vs: (who: string) => `vs ${who}`, resume: "Resume →" },
  floor: {
    label: "Duel floor",
    waitingNow: "Waiting now",
    waiting: (n: number) => (n === 0 ? "Nobody waiting · be first" : n === 1 ? "1 waiting" : `${n} waiting`),
    yourRating: (n: number) => `Your rating ${n}`,
    lastDuels: "Last duels",
    vs: (a: string, b: string) => `${a} vs ${b}`,
    wonBy: (who: string) => `won by ${who}`,
    draw: "draw",
    empty: "No duel decided yet. The first one starts the list.",
    ladder: "See the ladder",
  },
  offline: "The duel didn't answer. Try again in a moment.",
} as const;
