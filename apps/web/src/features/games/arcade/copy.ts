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
    or: "or",
    x: {
      button: "Sign in with X",
      note: "Your X handle becomes your name on the boards. X learns you signed in to Kakure; Kakure's arcade keeps your handle and a salted hash of your X id, never a token, and can see your handle beside your runs, duels and any calls you publish.",
      working: "Signing in with X…",
      workingDetail: "The arcade checks the sign-in with X, reads your handle and lets go of X's token.",
      done: (name: string) => `You're ${name} on the boards`,
      doneDetail: "Your runs, duels and any calls you publish rank under your X handle from now on.",
      failed: "The sign-in didn't finish",
      stale: "This sign-in didn't start in this tab. Start it again from a nickname sheet.",
      denied: "X said no, so nothing changed.",
      back: "Back to the games",
      profile: "Your profile",
    },
  },

  fmt: (n: number) => Math.round(n).toLocaleString("en-US"),
} as const;
