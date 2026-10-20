import type { PracticeCandidate } from "@kakure/arcade";
import { type BundleV2, currentAndNext, LANES, windowPhase } from "@kakure/domain";

/**
 * Every Window as Practice reads it (Mitoshi `usePracticeRound`'s candidates over the venue's lanes): each lane's
 * current and next Window, trading when it's live in the signed bundle. Practice deals from these and scores on the
 * live price, never on the Window's settlement.
 */
export function practiceCandidates(bundle: BundleV2 | null, nowSec: number): PracticeCandidate[] {
  const states = new Map((bundle?.windows ?? []).map((w) => [w.id, w]));
  return LANES.flatMap((lane) =>
    currentAndNext(lane, nowSec).map((window) => ({
      marketId: window.id,
      asset: lane.asset,
      intervalSec: lane.cadenceSec,
      expirySec: window.expirySec,
      trading: windowPhase(window, states.get(window.id) ?? null, nowSec) === "live",
    })),
  );
}

/** How many Windows trade right now, on every lane: the Practice cabinet's live fact. */
export const windowsLive = (candidates: readonly PracticeCandidate[], nowSec: number): number =>
  candidates.filter((c) => c.trading && c.expirySec > nowSec).length;
