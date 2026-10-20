"use client";

import { ARCADE_GAMES } from "@kakure/arcade";
import { useNetwork } from "@/features/network/network-store";
import type { PositionRecord } from "@/features/wallet/records";
import { useWallet } from "@/features/wallet/wallet-store";
import { type KeptRun, useKeptRuns } from "../player/player-store";
import { type PracticeTally, usePracticeTally } from "../practice/practice-store";

/**
 * What this device has done in the games and the terminal (plan §0 R4: the streak strip and the achievements are
 * computed on the device): settled calls from the vault's own positions, the arcade runs the service accepted, and
 * Practice's tally. Nothing here is sent anywhere; a badge follows from a record this device already keeps.
 */
export interface CallRecord {
  settled: number;
  won: number;
  bestStreak: number;
  /** Whole percent of settled calls won; null before the first. */
  winPct: number | null;
}

const PERCENT = 100;
/** A call held to its Window's close: redeemed after settlement, or collected once its exit or the close fired. */
const HELD_TO_CLOSE = new Set(["redeem", "settled"]);

export function callRecord(positions: readonly PositionRecord[]): CallRecord {
  const calls = positions
    .filter((p) => p.state === "paid" && HELD_TO_CLOSE.has(p.how ?? "") && p.certificate)
    .map((p) => ({ at: p.paidAt ?? p.createdAt, paid: Number(p.paidZat ?? 0), stake: Number(p.certificate?.stakeZat) }))
    // A refund (paid back the stake) is no verdict.
    .filter((c) => c.paid !== c.stake)
    .sort((a, b) => a.at - b.at);
  let streak = 0;
  let bestStreak = 0;
  let won = 0;
  for (const call of calls) {
    if (call.paid > call.stake) {
      won += 1;
      streak += 1;
      bestStreak = Math.max(bestStreak, streak);
    } else {
      streak = 0;
    }
  }
  return {
    settled: calls.length,
    won,
    bestStreak,
    winPct: calls.length === 0 ? null : Math.round((won / calls.length) * PERCENT),
  };
}

export interface Achievement {
  id: string;
  title: string;
  /** What it takes, in the player's terms: shown locked or not, so a locked badge is a goal. */
  how: string;
  have: number;
  need: number;
  earned: boolean;
}

const TOP_TEN = 10;
const HOT_STREAK = 3;
const REGULAR_ROUNDS = 5;

interface Facts {
  calls: CallRecord;
  runs: readonly KeptRun[];
  practice: PracticeTally;
}

const RULES: ReadonlyArray<{ id: string; title: string; how: string; need: number; have: (f: Facts) => number }> = [
  { id: "coin", title: "Beat the coin", how: "Win a Practice round", need: 1, have: (f) => f.practice.won },
  { id: "sweep", title: "Clean sweep", how: "Win a Practice round 5–0", need: 1, have: (f) => f.practice.sweeps },
  {
    id: "regular",
    title: "Regular",
    how: "Play five Practice rounds",
    need: REGULAR_ROUNDS,
    have: (f) => f.practice.played,
  },
  {
    id: "debut",
    title: "Arcade debut",
    how: "Rank a server-checked run",
    need: 1,
    have: (f) => (f.runs.length > 0 ? 1 : 0),
  },
  {
    id: "both",
    title: "Both machines",
    how: "Rank a run in both arcade games",
    need: ARCADE_GAMES.length,
    have: (f) => new Set(f.runs.map((r) => r.game)).size,
  },
  {
    id: "top-ten",
    title: "Top ten",
    how: "Rank a run in an all-time top ten",
    need: 1,
    have: (f) => (f.runs.some((r) => r.rank <= TOP_TEN) ? 1 : 0),
  },
  { id: "first-call", title: "First call", how: "Hold a call to its close", need: 1, have: (f) => f.calls.settled },
  { id: "winner", title: "Called it", how: "Win a call at its close", need: 1, have: (f) => f.calls.won },
  {
    id: "hot",
    title: "Hot streak",
    how: "Win three calls in a row",
    need: HOT_STREAK,
    have: (f) => f.calls.bestStreak,
  },
];

export function achievementsOf(facts: Facts): Achievement[] {
  return RULES.map((rule) => {
    const have = Math.min(rule.need, rule.have(facts));
    return { id: rule.id, title: rule.title, how: rule.how, have, need: rule.need, earned: have >= rule.need };
  });
}

/** This device's facts on the network it's on. */
export function useDeviceFacts(): Facts & { walletReady: boolean } {
  const wallet = useWallet(useNetwork());
  const runs = useKeptRuns();
  const practice = usePracticeTally();
  return { calls: callRecord(wallet.positions), runs, practice, walletReady: wallet.status === "ready" };
}
