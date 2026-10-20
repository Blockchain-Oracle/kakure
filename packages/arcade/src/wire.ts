import { sha256 } from "@noble/hashes/sha2.js";
import type { ArcadeGame } from "./field";
import { HOP_ENGINE_VERSION } from "./hop";
import { SLED_ENGINE_VERSION } from "./sled";
import type { Tape } from "./tape";

/**
 * The arcade API (plan §0 R4; Mitoshi `web/src/features/games/arcade/wire.ts` and `score.server.ts`), at `/arcade/v1/` on
 * the site's own origin. The site worker forwards it to the arcade service (`services/arcade`) as a fresh request with
 * no client headers, so the service never sees an IP. A player is a nickname bound to a device's Ed25519 key, claimed
 * once with proof of work (no captcha, no third party); a run is a seed the service issued with its tape, and a score
 * counts only once the service's replay reproduces it to the tick.
 */
export const ARCADE_PATH = "/arcade/v1";
export const ENGINE_VERSION: Readonly<Record<ArcadeGame, number>> = {
  "line-rider": SLED_ENGINE_VERSION,
  "candle-hop": HOP_ENGINE_VERSION,
};
/** The board a cabinet shows; the leaderboard page shows the longer one. */
export const BOARD_LIMIT = 10;
export const RANK_LIMIT = 50;
export const BOARD_PERIODS = ["day", "week", "all"] as const;
export type BoardPeriod = (typeof BOARD_PERIODS)[number];
export const NICKNAME_PATTERN = /^[A-Za-z0-9_-]{3,16}$/;
/** Leading zero bits a nickname claim's work must reach: about a quarter of a million hashes, under a second. */
export const POW_BITS = 18;
/** A signed request (a nickname claim, a Duel call) carries `at`, unix seconds, and is good this long either side. */
export const SIGNED_SKEW_SEC = 120;

/** `POST /arcade/v1/run/<game>`: a seed for the next run, with the real-price tape it rides (null: the seed's line). */
export interface RunIssued {
  seed: string;
  tape: Tape | null;
  engineVersion: number;
}

export interface BoardRow {
  nickname: string;
  score: number;
  calm: boolean;
  /** The day the run was played, `YYYYMMDD` (UTC): never a time. */
  day: number;
}

/** `GET /arcade/v1/board/<game>/<period>`. */
export interface Board {
  game: ArcadeGame;
  period: BoardPeriod;
  engineVersion: number;
  rows: BoardRow[];
}

/** `POST /arcade/v1/score`: Mitoshi's claim, plus the device key that signs it (`sig`, canonical JSON). */
export interface ScoreClaim {
  game: ArcadeGame;
  seed: string;
  engineVersion: number;
  durationMs: number;
  score: number;
  calm: boolean;
  trace: number[];
  /** The player's Ed25519 public key, hex. */
  player: string;
}

/** `POST /arcade/v1/me` with `{ game, player }` (a key stays out of paths): its nickname, best and all-time rank. */
export interface Standing {
  nickname: string | null;
  best: number | null;
  rank: number | null;
}

export interface ScoreAccepted {
  rank: number;
  isBest: boolean;
  best: number;
  board: Board;
}

/** `POST /arcade/v1/me`: whose standing, on which game's all-time board. */
export interface StandingRequest {
  game: ArcadeGame;
  player: string;
}

/**
 * `POST /arcade/v1/player`: claims a nickname for a device key (signed, with proof of work in `nonce`). `at` dates the
 * claim, so an old one can't be sent again later to undo a rename.
 */
export interface Registration {
  player: string;
  nickname: string;
  nonce: number;
  at: number;
}

/** What the work hashes: the key and the nickname (case-folded, as uniqueness is) with the nonce. */
export const powInput = (r: Pick<Registration, "player" | "nickname">, nonce: number): string =>
  `kakure-arcade:${r.player}:${r.nickname.toLowerCase()}:${nonce}`;

const BITS_PER_BYTE = 8;
const TOP_BIT = 0x80;

export function leadingZeroBits(bytes: Uint8Array): number {
  let bits = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      bits += BITS_PER_BYTE;
      continue;
    }
    for (let mask = TOP_BIT; (byte & mask) === 0; mask >>= 1) bits += 1;
    break;
  }
  return bits;
}

export function powMeets(r: Pick<Registration, "player" | "nickname">, nonce: number, bits = POW_BITS): boolean {
  return leadingZeroBits(sha256(new TextEncoder().encode(powInput(r, nonce)))) >= bits;
}

/** The first nonce that meets the work: the browser's half of a nickname claim. */
export function solvePow(r: Pick<Registration, "player" | "nickname">, bits = POW_BITS): number {
  let nonce = 0;
  while (!powMeets(r, nonce, bits)) nonce += 1;
  return nonce;
}
