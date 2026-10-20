"use client";

import {
  type DeckCard,
  nextPracticeCard,
  PRACTICE_IDLE,
  PRACTICE_WATCH_SEC,
  type PracticeRound,
  type PracticeScore,
  type PracticeSide,
  practiceClosesAtMs,
  practiceScore,
  practiceTransition,
  priceE8,
  selectPracticeDeck,
} from "@kakure/arcade";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRealtime } from "@/features/data/use-realtime";
import { useNow } from "@/lib/time";
import { practiceCandidates } from "./candidates";
import { recordPracticeRound } from "./practice-store";

/**
 * One practice round, from the live Windows to the scoreboard (Mitoshi `usePracticeRound.ts`). The round's state is the
 * package's reducer; this hook adds the live feed and the two moments that read it: the entry price at a swipe, and the
 * card's own close 30 s after that swipe. A reading missing at either moment leaves the card unscored, never priced at
 * a made-up number.
 */
export type PracticeReadiness = "dealing" | "no-deck" | "unreadable" | "ready";

const MS = 1000;
/** The round scores a second after the watch even if a close never read. */
const SAFETY_SCORE_MS = 1_000;

function freshSeed(): string {
  return globalThis.crypto.randomUUID();
}

export function usePracticeRound() {
  const data = useRealtime();
  const nowMs = useNow();
  const [round, dispatch] = useReducer(practiceTransition, PRACTICE_IDLE);
  const [prices, setPrices] = useState<ReadonlyMap<string, string>>(new Map());
  const [dealNonce, setDealNonce] = useState(0);
  const dealtFor = useRef(-1);
  const bundle = data.status === "ready" ? data.bundle : null;
  const nowSec = Math.floor(nowMs / MS);

  // One deal per nonce, once the Windows and the clock have both answered; it retries each tick until one deals.
  useEffect(() => {
    if (dealtFor.current === dealNonce && round.cards.length > 0) return;
    if (!bundle || nowSec === 0) return;
    const cards = selectPracticeDeck(practiceCandidates(bundle, nowSec), nowSec);
    if (cards.length === 0) return;
    dealtFor.current = dealNonce;
    dispatch({ kind: "deal", seed: freshSeed(), cards });
  }, [dealNonce, bundle, nowSec, round.cards.length]);

  const deal = useCallback(() => setDealNonce((n) => n + 1), []);

  const reportPrice = useCallback((asset: string, price: string) => {
    setPrices((prior) => {
      if (prior.get(asset) === price) return prior;
      const next = new Map(prior);
      next.set(asset, price);
      return next;
    });
  }, []);
  const priceOf = useCallback((asset: string) => prices.get(asset) ?? null, [prices]);

  const pick = useCallback(
    (card: DeckCard, side: PracticeSide) => {
      const entryE8 = priceE8(prices.get(card.asset));
      // No reading, no entry: a swipe that can't be priced is refused rather than dated at zero.
      if (entryE8 === null) return;
      dispatch({ kind: "pick", pick: { cardIndex: card.index, side, entryE8, atMs: Date.now() } });
    },
    [prices],
  );

  // Each card closes 30 s after its own swipe, on the latest price (a ref, not the closure the swipe saw).
  const pricesRef = useRef(prices);
  pricesRef.current = prices;
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  // A new deal (its seed) clears the old deal's timers.
  useEffect(() => {
    const live = timers.current;
    return () => {
      for (const id of live.values()) clearTimeout(id);
      live.clear();
    };
  }, [round.seed]);
  useEffect(() => {
    for (const p of round.picks) {
      if (timers.current.has(p.cardIndex) || round.closes.some((c) => c.cardIndex === p.cardIndex)) continue;
      const asset = round.cards.find((c) => c.index === p.cardIndex)?.asset;
      const id = setTimeout(
        () => {
          const closeE8 = asset ? priceE8(pricesRef.current.get(asset)) : null;
          if (closeE8 !== null) dispatch({ kind: "close", close: { cardIndex: p.cardIndex, closeE8 } });
        },
        Math.max(0, p.atMs + PRACTICE_WATCH_SEC * MS - Date.now()),
      );
      timers.current.set(p.cardIndex, id);
    }
  }, [round.picks, round.closes, round.cards]);

  // The round scores once every swiped card has its close, or a second after the watch with whatever closed.
  useEffect(() => {
    if (round.phase !== "watching" || round.watchEndsAtMs === null) return;
    if (round.picks.every((p) => round.closes.some((c) => c.cardIndex === p.cardIndex))) {
      dispatch({ kind: "score" });
      return;
    }
    const id = setTimeout(
      () => dispatch({ kind: "score" }),
      Math.max(0, round.watchEndsAtMs + SAFETY_SCORE_MS - Date.now()),
    );
    return () => clearTimeout(id);
  }, [round.phase, round.watchEndsAtMs, round.picks, round.closes]);

  const score: PracticeScore | null = useMemo(() => (round.phase === "scored" ? practiceScore(round) : null), [round]);

  // The tally on this device counts each scored round once.
  const recorded = useRef("");
  useEffect(() => {
    if (!score || recorded.current === round.seed) return;
    recorded.current = round.seed;
    recordPracticeRound(score.winner === "you", score.youWon === round.cards.length && round.cards.length > 1);
  }, [score, round.seed, round.cards.length]);

  const readiness: PracticeReadiness =
    round.cards.length > 0
      ? "ready"
      : data.status === "error" || data.status === "unpublished"
        ? "unreadable"
        : bundle === null || nowSec === 0
          ? "dealing"
          : "no-deck";

  const watchLeftSec =
    round.phase === "watching" && round.watchEndsAtMs !== null && nowMs > 0
      ? Math.max(0, Math.ceil((round.watchEndsAtMs - nowMs) / MS))
      : PRACTICE_WATCH_SEC;

  return {
    round,
    readiness,
    active: nextPracticeCard(round),
    priceOf,
    assets: [...new Set(round.cards.map((card) => card.asset))],
    pick,
    deal,
    reportPrice,
    watchLeftSec,
    closesAtMs: (cardIndex: number) => practiceClosesAtMs(round, cardIndex),
    score,
    nowMs,
    bundle,
    retry: data.status === "error" || data.status === "unpublished" ? data.refetch : null,
  };
}

export type PracticeSession = ReturnType<typeof usePracticeRound>;
export type { PracticeRound };
