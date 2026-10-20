"use client";

import {
  chooseLuckyWindow,
  drawLucky,
  eligibleLuckyWindows,
  type LuckyCandidate,
  type LuckyDraw,
  luckySeed,
} from "@kakure/arcade";
import { type BundleV2, type LatestV2, type Network, quoteWindow } from "@kakure/domain";
import { useCallback, useState } from "react";
import { practiceCandidates } from "../practice/candidates";
import { MS_PER_SEC } from "./constants";
import { keepDraw } from "./lucky-store";

/**
 * One Lucky spin, from the tap to the dealt Window (Mitoshi `useLuckyDraw.ts`, drawn here on the device): the seed is
 * made at the tap, the draw is keyed by the latest signed bundle's hash, and the Window is the drawn asset's live one
 * whose drawn side pays closest to the drawn reach, from the public formula on the live price. Nothing is sent.
 */
export type LuckyPhase = "idle" | "spinning" | "landing" | "dealt" | "empty";

export interface LuckyDeal {
  draw: LuckyDraw;
  seed: string;
  bundleSeq: number;
  bundleHash: string;
  candidateHash: string;
  candidates: LuckyCandidate[];
  windowId: string | null;
  dealtAskE4: number | null;
  stakeZat: number;
}

/** A beat of tumbling before the reels start to land, so a draw made in a microsecond still reads as a spin. */
const TUMBLE_MS = 450;
const SIDE_KEY = { up: "up", down: "down" } as const;

export function useLucky(input: {
  network: Network;
  bundle: BundleV2 | null;
  latest: LatestV2 | null;
  spotOf: (asset: string) => number | null;
}) {
  const { network, bundle, latest, spotOf } = input;
  const [phase, setPhase] = useState<LuckyPhase>("idle");
  const [deal, setDeal] = useState<LuckyDeal | null>(null);

  const spin = useCallback(
    (stakeZat: number) => {
      if (!bundle || !latest) return;
      const nowSec = Math.floor(Date.now() / MS_PER_SEC);
      const eligible = eligibleLuckyWindows(
        practiceCandidates(bundle, nowSec).map((c) => ({
          id: c.marketId,
          asset: c.asset,
          intervalSec: c.intervalSec,
          expirySec: c.expirySec,
          trading: c.trading,
        })),
        nowSec,
      );
      if (eligible.length === 0) {
        setDeal(null);
        setPhase("empty");
        return;
      }
      const seed = luckySeed();
      const { draw, candidateHash } = drawLucky({ bundleHash: latest.bundleHash, seed, candidates: eligible });
      const spot = spotOf(draw.asset);
      const sigmaText = bundle.pricing.sigma[draw.asset as keyof typeof bundle.pricing.sigma];
      const quotes = eligible
        .filter((c) => c.asset === draw.asset)
        .map((c) => {
          const quote = quoteWindow(
            { startSec: c.expirySec - c.intervalSec, expirySec: c.expirySec },
            bundle.windows.find((w) => w.id === c.id) ?? null,
            { spot, sigma: sigmaText ? Number(sigmaText) : null },
            nowSec,
          );
          return { id: c.id, expirySec: c.expirySec, askE4: quote[SIDE_KEY[draw.side]].askE4 };
        })
        .filter((q): q is { id: string; expirySec: number; askE4: number } => q.askE4 !== null);
      const chosen = chooseLuckyWindow(quotes, draw.multiplier);
      const next: LuckyDeal = {
        draw,
        seed,
        bundleSeq: bundle.seq,
        bundleHash: latest.bundleHash,
        candidateHash,
        candidates: eligible,
        windowId: chosen?.id ?? null,
        dealtAskE4: chosen?.askE4 ?? null,
        stakeZat,
      };
      keepDraw({
        at: Date.now(),
        network,
        bundleSeq: next.bundleSeq,
        bundleHash: next.bundleHash,
        seed,
        candidateHash,
        candidates: eligible.length,
        draw,
        windowId: next.windowId,
        dealtAskE4: next.dealtAskE4,
        stakeZat,
        positionKey: null,
      });
      setDeal(null);
      setPhase("spinning");
      window.setTimeout(() => {
        setDeal(next);
        setPhase("landing");
      }, TUMBLE_MS);
    },
    [network, bundle, latest, spotOf],
  );

  const landed = useCallback(() => setPhase((p) => (p === "landing" ? "dealt" : p)), []);
  const reset = useCallback(() => {
    setPhase("idle");
    setDeal(null);
  }, []);

  return { phase, deal, spin, landed, reset };
}

/** The browser's own check of a deal: the same inputs give the same draw. */
export function verifyDeal(deal: LuckyDeal): boolean {
  const again = drawLucky({ bundleHash: deal.bundleHash, seed: deal.seed, candidates: deal.candidates });
  return (
    again.candidateHash === deal.candidateHash &&
    again.draw.asset === deal.draw.asset &&
    again.draw.side === deal.draw.side &&
    again.draw.multiplier === deal.draw.multiplier
  );
}
