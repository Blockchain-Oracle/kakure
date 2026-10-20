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
import { dropPicks, freshSalt, type HeldPicks, heldPicks, holdPicks } from "./picks-store";

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
 * The picks for one match: made one card at a time on the device, held with their salt once all are in, then sent as a
 * commitment whenever the service's view says this seat hasn't committed while picks are open, and revealed as soon
 * as it says both are committed. The service's view decides, so a commitment lost on the way is simply sent again
 * (the first one in stands). A reload in between resumes from the held picks.
 */
export function useDuelPicks(match: DuelMatchView | undefined, seat: 0 | 1 | null) {
  const qc = useQueryClient();
  const matchId = match?.id ?? null;
  const [picks, setPicks] = useState<DuelPick[]>([]);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  /** One write at a time, with the held picks; its answer replaces the match on screen. */
  const send = useCallback(
    (matchId: string, write: (held: HeldPicks) => Promise<DuelMatchView>) => {
      const held = heldPicks(matchId);
      if (!held || busy.current) return;
      busy.current = true;
      setError(null);
      write(held)
        .then((view) => qc.setQueryData(duelKeys.match(matchId), view))
        .catch((cause) => setError(cause instanceof ArcadeError ? cause.message : String(cause)))
        .finally(() => {
          busy.current = false;
        });
    },
    [qc],
  );

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
      holdPicks({ matchId: match.id, picks: next, salt: freshSalt() });
      send(match.id, (held) => commitPicks(match.id, held.picks, held.salt));
    },
    [match, picks],
  );

  // From the service's view: commit while this seat hasn't, reveal once both have, drop the picks once it's past both.
  useEffect(() => {
    if (!match || seat === null) return;
    const held = heldPicks(match.id);
    if (!held) return;
    if (match.status === "picking" && !match.seats[seat].committed) {
      send(match.id, (h) => commitPicks(match.id, h.picks, h.salt));
    } else if (match.status === "revealing" && !match.seats[seat].revealed) {
      send(match.id, (h) => revealPicks(match.id, h.picks, h.salt));
    } else if (!LIVE.has(match.status) || match.status === "settling") {
      dropPicks();
    }
  }, [match, seat, send]);

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
