"use client";

import { usePrice } from "@kakure/feeds";
import { cx } from "@kakure/ui-web";
import Link from "next/link";
import { NetworkWord } from "@/features/network/network-switch";
import { useOnline } from "@/lib/online";

export type RelayHealth = "live" | "reconnecting" | "connecting" | "offline";
type PriceState = ReturnType<typeof usePrice>;

export const HEALTH_WORD: Record<RelayHealth, string> = {
  live: "Prices live",
  reconnecting: "Relay reconnecting",
  connecting: "Connecting to prices",
  offline: "Offline",
};

/** The relay's state as the page sees it: live if any watched symbol is live, reconnecting if quotes went stale. */
export function relayHealth(online: boolean, states: readonly PriceState[]): RelayHealth {
  if (!online) return "offline";
  if (states.some((state) => state.status === "live")) return "live";
  if (states.some((state) => state.status === "stale")) return "reconnecting";
  return "connecting";
}

/**
 * The relay connection as the shell reads it: the four crypto symbols every window uses. Every client receives every
 * symbol from the relay (PD19), so watching these reveals nothing about what the visitor looks at.
 */
export function useRelayHealth(): RelayHealth {
  const online = useOnline();
  const btc = usePrice("BTC-USD");
  const eth = usePrice("ETH-USD");
  const sol = usePrice("SOL-USD");
  const zec = usePrice("ZEC-USD");
  return relayHealth(online, [btc, eth, sol, zec]);
}

/**
 * The top line's health chip (Mitoshi HealthChip, app-shell.css:324-334): the world and the price relay's state as
 * a dot and a word, linking to Status. The word is said, not shown, below 1024 px.
 */
export function HealthChip({ className }: { className?: string }) {
  const health = useRelayHealth();
  return (
    <Link href="/status" className={cx("kk-health", className)} data-state={health} title={HEALTH_WORD[health]}>
      <span aria-hidden className={cx("kk-health-dot", health === "live" && "kk-ping")} />
      <span className="kk-health-net">
        <NetworkWord />
      </span>
      <span className="kk-health-word">· {HEALTH_WORD[health]}</span>
    </Link>
  );
}
