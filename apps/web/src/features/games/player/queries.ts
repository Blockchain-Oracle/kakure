"use client";

import type { ArcadeGame, BoardPeriod } from "@kakure/arcade";
import { useQuery } from "@tanstack/react-query";
import { readAttractTape, readBoard, readStanding } from "./api";
import { BOARD_STALE_MS, STANDING_STALE_MS, TAPE_STALE_MS } from "./constants";

/**
 * The arcade's reads as queries (kept in memory, never persisted: data-provider.tsx). A read that fails reads as
 * absent, and the screen says so; nothing stands in for a board that didn't answer.
 */
export const arcadeKeys = {
  all: ["arcade"] as const,
  board: (game: ArcadeGame, period: BoardPeriod, limit: number) => ["arcade", "board", game, period, limit] as const,
  standing: (game: ArcadeGame) => ["arcade", "standing", game] as const,
  tape: () => ["arcade", "tape"] as const,
};

export function useBoard(game: ArcadeGame, period: BoardPeriod, limit: number) {
  return useQuery({
    queryKey: arcadeKeys.board(game, period, limit),
    queryFn: () => readBoard(game, period, limit),
    staleTime: BOARD_STALE_MS,
    retry: 1,
  });
}

/** This device's standing on one game (its key's nickname, best and all-time rank). */
export function useStanding(game: ArcadeGame) {
  return useQuery({
    queryKey: arcadeKeys.standing(game),
    queryFn: () => readStanding(game),
    staleTime: STANDING_STALE_MS,
    retry: 1,
  });
}

/** A real-price tape for the attract loops; null when the service has none or didn't answer. */
export function useAttractTape() {
  const q = useQuery({ queryKey: arcadeKeys.tape(), queryFn: readAttractTape, staleTime: TAPE_STALE_MS, retry: 1 });
  return q.data ?? null;
}
