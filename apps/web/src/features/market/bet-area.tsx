"use client";

import type { AddressList, Bundle, Market, Network } from "@kakure/domain";
import { viewTicket } from "@kakure/query";
import { Pill } from "@kakure/ui-web";
import Link from "next/link";
import { NETWORK_COIN } from "@/constants";
import { BetLauncher } from "@/features/bet/bet-launcher";
import { coinAmount, isBettable, sideWord } from "@/features/markets/market-view";
import { STATUS_LABEL, STATUS_TONE } from "@/features/tickets/status";
import { useTickets } from "@/features/tickets/use-tickets";
import { formatDateTime } from "@/lib/time";

/** Betting on the detail page: the Up/Down plates while betting is open, otherwise why not; then your tickets. */
export function BetArea({
  market,
  bundle,
  addresses,
  network,
  now,
}: {
  market: Market;
  bundle: Bundle;
  addresses: AddressList | null;
  network: Network;
  now: number;
}) {
  const tickets = useTickets(network);
  const mine = Array.isArray(tickets) ? tickets.filter((ticket) => ticket.marketId === market.id) : [];
  return (
    <>
      {isBettable(market, now) ? (
        <BetLauncher market={market} addresses={addresses} network={network} />
      ) : (
        <section
          className="rounded-group border border-border bg-card p-5 text-row-detail text-muted-foreground"
          aria-label="Betting"
        >
          {market.state === "scheduled"
            ? `Betting opens ${formatDateTime(market.opensAt)}. The QR can be built once it does.`
            : "Betting is closed for this market. Open markets are on the markets list."}
        </section>
      )}
      {mine.length > 0 ? (
        <section className="rounded-group border border-border bg-card p-5" aria-labelledby="mine-title">
          <h2 id="mine-title" className="font-display text-title text-foreground">
            Your tickets here
          </h2>
          <ul className="mt-3 flex flex-col gap-2">
            {mine.map((ticket) => {
              const view = viewTicket(ticket, bundle, now);
              return (
                <li key={ticket.hash}>
                  <Link
                    href={`/portfolio#${ticket.hash}`}
                    className="flex items-center justify-between gap-3 rounded-row bg-raised-2 px-4 py-3 outline-none hover:bg-row-pressed focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="text-row-strong text-foreground">
                      {sideWord(ticket.side)} · {coinAmount(BigInt(ticket.sizeZat), NETWORK_COIN[network])}
                    </span>
                    <Pill tone={STATUS_TONE[view.status]}>{STATUS_LABEL[view.status]}</Pill>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </>
  );
}
