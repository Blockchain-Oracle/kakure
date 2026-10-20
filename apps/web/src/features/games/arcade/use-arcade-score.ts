"use client";

import { type ArcadeGame, BOARD_LIMIT, ENGINE_VERSION, type RunIssued } from "@kakure/arcade";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { ArcadeError, issueRun, postScore } from "../player/api";
import { keepRun, today, useNickname } from "../player/player-store";
import { arcadeKeys, useBoard, useStanding } from "../player/queries";
import type { RunEnd } from "./run";

/**
 * The cabinet's board and the post (Mitoshi `useArcadeScore.ts`, on a device key instead of a wallet session). `ability`
 * says before a run what will happen to its score: posted under the nickname, waiting on one, or kept here because the
 * board didn't answer. A posted run is kept on this device too, for History.
 */
export type PostAbility = "yes" | "noName" | "unavailable" | "opening";

export type PostOutcome = { kind: "posted"; rank: number; isBest: boolean } | { kind: "refused"; why: string };

export function useArcadeScore(game: ArcadeGame) {
  const client = useQueryClient();
  const board = useBoard(game, "all", BOARD_LIMIT);
  const standing = useStanding(game);
  const nickname = useNickname() ?? standing.data?.nickname ?? null;

  const ability: PostAbility = board.isError
    ? "unavailable"
    : board.data === undefined
      ? "opening"
      : nickname
        ? "yes"
        : "noName";

  /** A seed and its tape for the next run; null when the service didn't answer (the run then posts nothing). */
  const nextRun = useCallback((): Promise<RunIssued | null> => issueRun(game).catch(() => null), [game]);

  const post = useCallback(
    async (end: RunEnd): Promise<PostOutcome> => {
      try {
        const accepted = await postScore({
          game,
          seed: end.seed,
          engineVersion: ENGINE_VERSION[game],
          durationMs: end.durationMs,
          score: end.score,
          calm: end.calm,
          trace: end.trace,
        });
        keepRun({ game, score: end.score, rank: accepted.rank, best: accepted.isBest, calm: end.calm, day: today() });
        void client.invalidateQueries({ queryKey: arcadeKeys.all });
        return { kind: "posted", rank: accepted.rank, isBest: accepted.isBest };
      } catch (cause) {
        void client.invalidateQueries({ queryKey: arcadeKeys.standing(game) });
        return { kind: "refused", why: cause instanceof ArcadeError ? cause.message : "the post didn't go through" };
      }
    },
    [client, game],
  );

  return { board, standing, nickname, ability, nextRun, post };
}
