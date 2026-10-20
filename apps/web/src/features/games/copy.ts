import type { BoardPeriod } from "@kakure/arcade";
import type { EconomicKind, GameId } from "./catalog";

/**
 * Every word the games say (Mitoshi `features/games/copy.ts`, at its word count or fewer). The rules and the proof sit
 * behind each stage's ⓘ; on screen each element carries one short fragment. Nothing here promises an opponent, a
 * payout, a rank or a streak that a real record doesn't already carry, and no name here is ever an address.
 */
export const GAMES = {
  title: "Games",

  /** Each cabinet's sticker says whose money is at risk. */
  econ: { none: "Free", stake: "Your stake", house: "House pays" } satisfies Record<EconomicKind, string>,

  card: {
    play: "Play",
    soon: "Soon",
    windowsLive: (n: number) => (n === 1 ? "1 Window live" : `${n} Windows live`),
    top: (top: string, you: string | null) => (you === null ? `Top ${top}` : `Top ${top} · you ${you}`),
    noRuns: "No runs yet",
    boardOffline: "Board offline · play on",
    goTo: (n: number, total: number) => `${n} of ${total}`,
    soonLine: { duel: "Opens next: three calls, head to head" },
    luckyLine: "Drawn on your device · one real trade",
  },

  hall: {
    featured: "Next live Window",
    cadence: (label: string) => `${label} Window`,
    upPays: (multiple: string) => `Up pays ${multiple}`,
    play: "Play",
    continueTo: (name: string) => `Continue ${name} →`,
    noWindow: "No Window long enough yet",
    reading: "Reading the Windows…",
    offline: "Windows unreadable",
    unpublished: "No Windows on this network yet",
    nowPlaying: "Today's runs",
    runLine: (game: string, score: string) => `${game} ${score}`,
    quoteLine: (cadence: string, multiple: string) => `${cadence} · Up pays ${multiple}`,
  },

  streak: {
    label: "On this device",
    best: (n: number) => `Best streak ${n}`,
    winRate: (pct: number) => `${pct}% won`,
    noCalls: "No settled calls yet",
    arcadeBest: (name: string, score: string) => `${name} ${score}`,
    nickname: (name: string) => `Playing as ${name}`,
    pick: "Pick a nickname",
  },

  achievements: {
    title: "Achievements",
    count: (earned: number, total: number) => `${earned} of ${total}`,
    scope: "Counted on this device",
  },

  rail: { back: "Games", settings: "Game settings", sound: "Sound", mute: "Mute" },

  howToWords: { open: "How to play", got: "Got it" },
  /** Three fragments per mode: what a first-time player needs, then the proof line. */
  howTo: {
    practice: [
      "Swipe ↑ if it'll be higher in 30 s, ↓ if lower.",
      "Beat the coin's picks.",
      "Scored on the live price 30 s after each swipe · free, nothing leaves this device.",
    ],
    "line-rider": [
      "Sled the real chart: rises climb, drops fall, gaps open.",
      "Hold to press, let go to hop; lean ← → to flip.",
      "The tape is a signed prints file; the server replays your run before it ranks · no stake.",
    ],
    "candle-hop": [
      "Fly the real candles: each pair is a minute, up or down.",
      "Tap to lift; a body, a wick or the floor ends it.",
      "The tape is a signed prints file; the server replays your run before it ranks · no stake.",
    ],
    range: [
      "Pick a Window and a band.",
      "Closes inside: the house pays the multiple.",
      "Priced by the public formula, paid from your chips.",
    ],
    moonshot: ["Pick a side and a reach.", "Further pays more.", "Range's pricing, one edge open."],
    lucky: [
      "Reels draw a live asset, a side and a reach; you pick the stake.",
      "You see the live quote first; slide to place it as one ordinary trade.",
      "Drawn on this device from the signed bundle and your seed · nothing is sent until you place it.",
    ],
    duel: ["Three calls against another player.", "Picks stay sealed until lock."],
  } satisfies Record<GameId, readonly string[]>,

  settings: {
    title: "Game settings",
    sfx: "Sound",
    music: "Music",
    soundOff: "Sounds are off in Settings",
    turnOn: "Turn on",
    haptics: "Haptics",
    hapticsUnsupported: "No vibration on this device",
    motion: { label: "Motion", system: "Follow system", full: "Full", reduce: "Reduced" },
    accent: "Accent",
    network: "Network",
    close: "Done",
    foot: "Saved on this device · sounds by Kenney (CC0) · m6x11plus by Daniel Linssen",
  },

  rank: {
    title: "Rank",
    tabs: { "line-rider": "Line Rider", "candle-hop": "Candle Hop" },
    periodLabel: "Period",
    periods: { day: "Today", week: "This week", all: "All time" } satisfies Record<BoardPeriod, string>,
    reading: "Reading the board",
    failed: "The board didn't load",
    retry: "Try again",
    empty: { why: "No ranked runs yet", detail: "Server-checked runs rank here." },
    play: (game: string) => `Play ${game}`,
    you: "you",
    calm: "calm",
    played: (day: string) => `played ${day}`,
    foot: "Nicknames only: no address, no IP and no time of day is kept, only the day a run was played.",
  },

  history: {
    title: "History",
    runs: "Your runs",
    scope: "Kept on this device",
    empty: { why: "No runs yet", detail: "Your server-checked runs land here." },
    rank: (n: number) => `#${n}`,
    calm: "calm",
    best: "best",
    clear: "Clear this list",
  },
} as const;
