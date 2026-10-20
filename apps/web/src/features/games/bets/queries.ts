"use client";

import type { BetsPeriod } from "@kakure/arcade";
import { useQuery } from "@tanstack/react-query";
import { readBetsBoard, readProfile } from "./api";

/** The board changes once a day, a profile when its player plays: both are read fresh at most every half minute. */
const STALE_MS = 30_000;

export const betsKeys = {
  board: (period: BetsPeriod) => ["arcade", "bets", period] as const,
  profile: (nickname: string) => ["arcade", "profile", nickname.toLowerCase()] as const,
};

export function useBetsBoard(period: BetsPeriod) {
  return useQuery({
    queryKey: betsKeys.board(period),
    queryFn: () => readBetsBoard(period),
    staleTime: STALE_MS,
    retry: 1,
  });
}

export function useProfile(nickname: string | null) {
  return useQuery({
    queryKey: betsKeys.profile(nickname ?? ""),
    queryFn: () => readProfile(nickname ?? ""),
    enabled: nickname !== null && nickname !== "",
    staleTime: STALE_MS,
    retry: false,
  });
}
