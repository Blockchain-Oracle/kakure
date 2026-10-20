import type { ArcadeGame } from "@kakure/arcade";
import { MS_PER_SEC, TOP_TEN } from "./constants";

/**
 * Everything the arcade says (Mitoshi `features/games/arcade/copy.ts`). The line that survives every screen is the
 * honesty line: a score counts once the arcade service has replayed the run, it's tied to a nickname and never to an
 * address, and no money rides on it.
 */
export const ARCADE = {
  honesty: "Server-checked · nickname only · no stake",

  games: {
    "line-rider": {
      title: "Line Rider",
      line: "Sled the real chart",
      control: "Hold to press · let go to hop · lean ← →",
    },
    "candle-hop": { title: "Candle Hop", line: "Fly the real candles", control: "Tap or Space to hop" },
  } satisfies Record<ArcadeGame, { title: string; line: string; control: string }>,

  stage: {
    go: "GO",
    dealing: "Dealing the tape",
    grip: "Charge",
    earned: "Your best on the board",
    sound: "Sound on",
    mute: "Mute",
    pause: "Pause",
    paused: "Paused",
    resume: "Resume",
    exit: "Exit",
    length: "Length",
    seed: "Seed",
    /** Under the run: whose signed prints the tape is, and when (the hours, as the floor's labels show them). */
    tapeOf: (feed: string, fromSec: number, toSec: number) => {
      const t = (s: number) =>
        new Date(s * MS_PER_SEC).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      return `${feed} prints ${t(fromSec)}–${t(toSec)}`;
    },
    ownLine: "The seed's own line",
  },

  hud: { combo: (mult: number) => `×${Number.isInteger(mult) ? mult : mult.toFixed(1)}` },

  title: {
    play: "Play",
    best: (score: string) => `Best ${score}`,
    noBest: "No run yet",
    free: "Free · server-checked",
  },

  over: {
    newBest: "NEW BEST",
    ranked: (rank: number) => (rank <= TOP_TEN ? `Ranked #${rank}` : `Rank #${rank}`),
    over: "Run over",
    topOfBoard: "Top of the board",
    checking: "Checking the run…",
    refused: (why: string) => `Not recorded: ${why}`,
    noName: "Pick a nickname to rank this run",
    offline: "The board didn't answer · kept on this device",
    again: "Play again",
    seed: (seed: string) => `seed ${seed}`,
    length: (sec: string) => `${sec}s`,
  },

  board: {
    title: "Top runs",
    empty: "No scores yet. Set the first.",
    you: "you",
    calm: "calm",
    loading: "Reading the board…",
    unreachable: "Board offline · play on",
    more: "All ranks",
  },

  calm: { label: "Calmer ramp", hint: "Slower ramp · marked on the board" },

  share: { label: "Share", foot: "Server-checked run · no stake" },

  nickname: {
    title: "Pick a nickname",
    lead: "Your runs rank under it. It's tied to a key made on this device, never to an address or a wallet.",
    label: "Nickname",
    rule: "3–16 letters, digits, _ or -",
    claim: "Claim it",
    working: "Proving the work…",
    taken: "Taken. Try another.",
    done: (name: string) => `You're ${name}`,
    note: "The claim carries a small proof of work instead of a captcha, so nothing third-party loads.",
    forget: "Forget this device clears the key, and the nickname with it.",
  },

  fmt: (n: number) => Math.round(n).toLocaleString("en-US"),
} as const;
