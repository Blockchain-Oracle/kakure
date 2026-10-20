"use client";

import type { DuelMatchView, DuelPick, DuelState } from "@kakure/arcade";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArcadeError } from "../player/api";
import {
  commitPicks,
  joinQueue,
  leaveQueue,
  readDuelBoard,
  readDuelHistory,
  readDuelRecent,
  readDuelState,
  readMatch,
  revealPicks,
} from "./api";
import { dropPicks, freshSalt, heldPicks, holdPicks } from "./picks-store";

/**
 * The Duel's client state (Mitoshi `duel/useDuel.ts`, over the arcade's HTTP instead of a chain): the queue polled
 * every 2 s while waiting (the poll is also what keeps your place), the match every 2 s while it's live, and the two
 * writes the browser makes on its own: the commitment once all three picks are in, the reveal once both are committed.
 */
export const duelKeys = {
  state: ["arcade", "duel", "state"] as const,
  match: (id: string | null) => ["arcade", "duel", "match", id] as const,
  board: ["arcade", "duel", "board"] as const,
  recent: ["arcade", "duel", "recent"] as const,
  history: ["arcade", "duel", "history"] as const,
};

const POLL_MS = 2_000;
const SLOW_MS = 15_000;
const FLOOR_MS = 30_000;
const LIVE = new Set(["picking", "revealing", "settling"]);

export function useDuelState(enabled: boolean) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: duelKeys.state,
    queryFn: readDuelState,
    enabled,
    refetchInterval: (query) => (query.state.data?.status === "waiting" ? POLL_MS : SLOW_MS),
    retry: 1,
  });
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (action: () => Promise<DuelState>) => {
      setError(null);
      try {
        qc.setQueryData(duelKeys.state, await action());
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [qc],
  );
  return {
    state: q.data ?? null,
    failed: q.isError,
    error,
    find: () => run(joinQueue),
    leave: () => run(leaveQueue),
  };
}

export function useDuelMatch(matchId: string | null) {
  return useQuery({
    queryKey: duelKeys.match(matchId),
    queryFn: () => readMatch(matchId ?? ""),
    enabled: matchId !== null,
    refetchInterval: (query) => (!query.state.data || LIVE.has(query.state.data.status) ? POLL_MS : false),
    retry: 1,
  });
}

/**
 * The picks for one match: made one card at a time on the device, committed as a hash once all are in, revealed as
 * soon as the service says both are committed. A reload in between resumes from the held picks.
 */
export function useDuelPicks(match: DuelMatchView | undefined, seat: 0 | 1 | null) {
  const qc = useQueryClient();
  const matchId = match?.id ?? null;
  const [picks, setPicks] = useState<DuelPick[]>([]);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (!matchId) return;
    setPicks(heldPicks(matchId)?.picks ?? []);
  }, [matchId]);

  const pick = useCallback(
    (side: DuelPick) => {
      if (!match || picks.length >= match.deck.length) return;
      const next = [...picks, side];
      setPicks(next);
      if (next.length < match.deck.length) return;
      const held = { matchId: match.id, picks: next, salt: freshSalt(), committed: false };
      holdPicks(held);
      busy.current = true;
      commitPicks(match.id, next, held.salt)
        .then((view) => {
          holdPicks({ ...held, committed: true });
          qc.setQueryData(duelKeys.match(match.id), view);
        })
        .catch((cause) => setError(cause instanceof ArcadeError ? cause.message : String(cause)))
        .finally(() => {
          busy.current = false;
        });
    },
    [match, picks, qc],
  );

  // Reveal once both are committed; drop the held picks once the match is past revealing.
  useEffect(() => {
    if (!match || seat === null || busy.current) return;
    const held = heldPicks(match.id);
    if (match.status === "revealing" && held && !match.seats[seat].revealed) {
      busy.current = true;
      revealPicks(match.id, held.picks, held.salt)
        .then((view) => qc.setQueryData(duelKeys.match(match.id), view))
        .catch((cause) => setError(cause instanceof ArcadeError ? cause.message : String(cause)))
        .finally(() => {
          busy.current = false;
        });
    } else if (match.status === "picking" && held && !held.committed && !match.seats[seat].committed) {
      busy.current = true;
      commitPicks(match.id, held.picks, held.salt)
        .then((view) => {
          holdPicks({ ...held, committed: true });
          qc.setQueryData(duelKeys.match(match.id), view);
        })
        .catch((cause) => setError(cause instanceof ArcadeError ? cause.message : String(cause)))
        .finally(() => {
          busy.current = false;
        });
    } else if (!LIVE.has(match.status) || match.status === "settling") {
      if (held) dropPicks();
    }
  }, [match, seat, qc]);

  return { picks, pick, error };
}

export function useDuelBoard() {
  return useQuery({ queryKey: duelKeys.board, queryFn: readDuelBoard, staleTime: FLOOR_MS, retry: 1 });
}

export function useDuelRecent() {
  return useQuery({ queryKey: duelKeys.recent, queryFn: readDuelRecent, refetchInterval: FLOOR_MS, retry: 1 });
}

export function useDuelHistory(enabled: boolean) {
  return useQuery({ queryKey: duelKeys.history, queryFn: readDuelHistory, enabled, staleTime: FLOOR_MS, retry: 1 });
}
