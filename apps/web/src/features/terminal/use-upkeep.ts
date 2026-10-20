"use client";

import type { Network, Trading } from "@kakure/domain";
import { fire } from "@kakure/sounds";
import { useEffect, useRef } from "react";
import { NETWORK_COIN } from "@/constants";
import type { PositionRecord } from "@/features/wallet/records";
import { resumeWallet } from "@/features/wallet/spending";
import { collect, lastExpiry, redeem } from "@/features/wallet/trading";
import { ARMED_CHECK_SEC, LATE_SPREAD_SEC, REDEEM_AFTER_SEC, RETRY_SEC, UPKEEP_TICK_MS } from "./constants";
import { livePnlText, zatToNumber } from "./format";
import { toast } from "./toasts";

/**
 * Keeps this device's positions in step with the mint (Owarine `useExitFills.ts` and `useSeatPkg.ts`): on open it
 * finishes whatever a closed tab left in flight; while an exit is armed it asks the mint now and then whether it fired;
 * once a Window has settled it redeems the positions on it. A fired exit or a settled position is announced once, with
 * its sound and, on a win, confetti.
 *
 * Every position keeps its own random time for each call, and calls go one at a time, so the mint never sees a
 * device's positions redeemed or checked together, or on a device's own fixed rhythm (privacy re-audit V3). The times
 * live for the tab, across its pages.
 */
const MS = 1000;

const dueAt = new Map<string, number>();
const draw = ([lo, hi]: readonly [number, number]) => (lo + Math.random() * (hi - lo)) * MS;

/** The one call due next, if any: its key and whether it's a redeem or an armed check. */
function nextCall(records: readonly PositionRecord[], now: number): { key: string; redeem: boolean } | null {
  const live = new Set<string>();
  let next: { key: string; redeem: boolean; at: number } | null = null;
  for (const r of records) {
    if (r.pending || !r.certificate) continue;
    const settledFor = now - lastExpiry(r.certificate) * MS;
    const redeemable = r.state === "open" && settledFor > REDEEM_AFTER_SEC[0] * MS;
    if (r.state !== "armed" && !redeemable) continue;
    live.add(r.key);
    if (!dueAt.has(r.key)) {
      const planned = lastExpiry(r.certificate) * MS + draw(REDEEM_AFTER_SEC);
      dueAt.set(
        r.key,
        r.state === "armed" ? now + draw(ARMED_CHECK_SEC) : planned > now ? planned : now + draw(LATE_SPREAD_SEC),
      );
    }
    const at = dueAt.get(r.key) ?? now;
    if (at <= now && (!next || at < next.at)) next = { key: r.key, redeem: r.state === "open", at };
  }
  for (const key of dueAt.keys()) if (!live.has(key)) dueAt.delete(key);
  return next;
}
const WHAT_FIRED: Record<string, string> = {
  trail: "Trailing stop hit",
  stop: "Stop hit",
  takeProfit: "Take-profit hit",
  settled: "Settled",
  redeem: "Settled",
};

const assetOf = (record: PositionRecord) =>
  record.certificate?.window?.split("-")[0]?.toUpperCase() ?? (record.certificate?.kind === "parlay" ? "Parlay" : "");

export function useUpkeep(
  network: Network,
  trading: Trading | null,
  records: readonly PositionRecord[],
  ready: boolean,
) {
  const seen = useRef(new Map<string, PositionRecord["state"]>());
  const started = useRef(false);
  const latest = useRef({ trading, records });
  latest.current = { trading, records };
  const coin = NETWORK_COIN[network];

  // Announce positions that became paid without this tab closing them (a fired exit, a settlement).
  useEffect(() => {
    const before = seen.current;
    const next = new Map<string, PositionRecord["state"]>();
    for (const r of records) {
      next.set(r.key, r.state);
      const was = before.get(r.key);
      if (was === undefined || was === r.state || r.state !== "paid" || !r.certificate) continue;
      if (r.how === "close") continue;
      const pnl = zatToNumber(Number(r.paidZat ?? 0) - Number(r.certificate.stakeZat));
      fire(pnl > 0 ? "win" : "loss");
      toast({
        kind: pnl > 0 ? "success" : "info",
        title: `${WHAT_FIRED[r.how ?? ""] ?? "Paid"} · ${assetOf(r)}`,
        description:
          r.how === "trail" || r.how === "stop" || r.how === "takeProfit"
            ? `The mint sold it at its bid: ${livePnlText(pnl)} ${coin}, back as chips.`
            : `${livePnlText(pnl)} ${coin}, back as chips.`,
        confetti: pnl > 0,
      });
    }
    seen.current = next;
  }, [records, coin]);

  // Finish what a closed tab left in flight, once the wallet and the signed trading info are in.
  useEffect(() => {
    if (!ready || !trading || started.current) return;
    started.current = true;
    void resumeWallet(network, trading).catch(() => undefined);
  }, [ready, trading, network]);

  // Armed exits and settled Windows: one call at a time, each at its position's own random time.
  useEffect(() => {
    if (!ready) return;
    let busy = false;
    const id = setInterval(() => {
      const { trading: t, records: rs } = latest.current;
      if (!t || busy) return;
      const now = Date.now();
      const call = nextCall(rs, now);
      if (!call) return;
      busy = true;
      dueAt.set(call.key, now + draw(call.redeem ? RETRY_SEC : ARMED_CHECK_SEC));
      (call.redeem ? redeem(network, t, call.key) : collect(network, t, call.key))
        .catch(() => undefined)
        .finally(() => {
          busy = false;
        });
    }, UPKEEP_TICK_MS);
    return () => clearInterval(id);
  }, [ready, network]);
}
