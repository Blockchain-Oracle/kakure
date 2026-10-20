"use client";

import type { Network, Trading } from "@kakure/domain";
import { fire } from "@kakure/sounds";
import { useEffect, useRef } from "react";
import { NETWORK_COIN } from "@/constants";
import type { PositionRecord } from "@/features/wallet/records";
import { resumeWallet } from "@/features/wallet/spending";
import { collect, lastExpiry } from "@/features/wallet/trading";
import { livePnlText, zatToNumber } from "./format";
import { toast } from "./toasts";

/**
 * Keeps this device's positions in step with the mint (Owarine `useExitFills.ts` and `useSeatPkg.ts`): on open it
 * finishes whatever a closed tab left in flight; while an exit is armed it asks the mint every 5 s whether it fired;
 * once a Window has settled it redeems the positions on it. A fired exit or a settled position is announced once, with
 * its sound and, on a win, confetti.
 */
const POLL_ARMED_MS = 5_000;
const POLL_SETTLED_MS = 10_000;
const SETTLE_GRACE_SEC = 20;
const MS = 1000;
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

  // Armed exits: ask the mint whether they fired.
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => {
      const { trading: t, records: rs } = latest.current;
      if (!t) return;
      for (const r of rs) if (r.state === "armed") void collect(network, t, r.key).catch(() => undefined);
    }, POLL_ARMED_MS);
    return () => clearInterval(id);
  }, [ready, network]);

  // Settled Windows: redeem what rode on them.
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => {
      const { trading: t, records: rs } = latest.current;
      if (!t) return;
      const nowSec = Date.now() / MS;
      const due = rs.some(
        (r) => r.state === "open" && r.certificate && lastExpiry(r.certificate) + SETTLE_GRACE_SEC < nowSec,
      );
      if (due) void resumeWallet(network, t).catch(() => undefined);
    }, POLL_SETTLED_MS);
    return () => clearInterval(id);
  }, [ready, network]);
}
