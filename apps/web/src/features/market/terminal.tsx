"use client";

import type { AddressList, Bundle, Market, Network, Side } from "@kakure/domain";
import { usePrice } from "@kakure/feeds";
import { Mark, Pill, RollingNumber, Sheet } from "@kakure/ui-web";
import { BookText, Search } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { type ReactNode, useCallback, useState } from "react";
import { NETWORK_COIN, NETWORK_LABEL } from "@/constants";
import { LiveWindowChart } from "@/features/chart/live-window-chart";
import { assetFor } from "@/features/markets/assets";
import { referencePrice, sidesOf, statePill } from "@/features/markets/market-view";
import { BetTicket, type TicketChoice } from "@/features/ticket/bet-ticket";
import { formatCountdown } from "@/lib/time";
import { BatchHistory } from "./batch-history";
import { formatUsd, SOURCE_NAME } from "./live-price";
import { MarketFacts } from "./market-facts";
import { RulesPanel } from "./rules-panel";

const BetSheet = dynamic(() => import("@/features/bet/bet-sheet"), { ssr: false });

const LIVE_STATES = new Set<Market["state"]>(["scheduled", "open", "closing"]);
const PERCENT = 100;
const CHANGE_DECIMALS = 2;

/**
 * The trade terminal (plan §0 R2; Owarine/Mitoshi terminal, Refero: Coinbase BTC, Kraken web): the live Window chart
 * fills the stage, the asset chip rolls its price, lanes switch between this asset's markets, and the ticket sits
 * beside it. Rules, timings and the batch history live behind one "Rules & proof" button, not on the page.
 */
export function Terminal({
  market,
  bundle,
  addresses,
  network,
  now,
  freshness,
  hero = false,
}: {
  market: Market;
  bundle: Bundle;
  addresses: AddressList | null;
  network: Network;
  now: number;
  freshness: ReactNode;
  /** On the markets page: a shorter chart and a link to the full terminal (`/trade`) instead of the lanes. */
  hero?: boolean;
}) {
  const asset = assetFor(market);
  const [choice, setChoice] = useState<TicketChoice>({
    side: sidesOf(market)[0] as Side,
    sizeZat: 10_000_000n,
  });
  const [paying, setPaying] = useState(false);
  const [rules, setRules] = useState(false);
  const closePay = useCallback(() => setPaying(false), []);
  const reference = referenceOf(market);
  const pill = statePill(market, now);
  const cutoff = Date.parse(market.cutoffAt);
  const closes = Date.parse(market.closesAt);
  const countdown =
    now < cutoff
      ? `Betting closes in ${formatCountdown(cutoff - now)}`
      : now < closes
        ? `Settles in ${formatCountdown(closes - now)}`
        : pill.label;

  return (
    <div className="grid grid-cols-1 gap-4 wide:grid-cols-[minmax(0,1fr)_380px]">
      <section
        aria-label={`${asset.symbol} chart`}
        className="flex min-w-0 flex-col overflow-hidden rounded-group border border-border bg-card"
      >
        <header className="flex flex-wrap items-center gap-3 px-4 pt-4">
          <div className="flex items-center gap-2.5 rounded-pill bg-background py-1.5 pr-4 pl-1.5">
            <Mark mark={asset.mark} label={asset.symbol} size="row" />
            {asset.stream ? <AssetPrice stream={asset.stream} reference={reference.value} /> : null}
          </div>
          {hero ? (
            <Link
              href={`/trade#${network}/${market.id}`}
              className="text-chip-label text-muted-foreground hover:text-foreground"
            >
              Open terminal →
            </Link>
          ) : (
            <Lanes market={market} bundle={bundle} network={network} />
          )}
          <button
            type="button"
            onClick={() => setRules(true)}
            className="kk-press ml-auto flex h-9 items-center gap-1.5 rounded-pill bg-background px-3 text-chip-label text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <BookText aria-hidden className="size-4" /> Rules &amp; proof
          </button>
        </header>
        <h1 className="px-4 pt-3 font-display text-body-strong text-foreground">
          {headline(market, asset.symbol, reference)}
        </h1>
        {asset.stream ? (
          <LiveWindowChart
            symbol={asset.stream}
            label={`${asset.symbol} price since the window opened`}
            className={hero ? "h-[260px] w-full wide:h-[340px]" : "h-[300px] w-full wide:h-[440px]"}
            spec={{
              opensAt: Date.parse(market.opensAt),
              closesAt: closes,
              reference: reference.value,
              referenceLabel: reference.label,
            }}
          />
        ) : (
          <div className="grid h-[300px] place-items-center text-row-detail text-muted-foreground">
            Resolved from Zcash chain data, not from a price.
          </div>
        )}
        <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-3">
          <Pill tone={pill.tone} indicator={pill.pulse ? "pulse" : false}>
            {pill.label}
          </Pill>
          <span className="font-mono text-num-sm text-foreground">{countdown}</span>
          <span className="text-meta text-muted-foreground">
            {market.ticketCount} {market.ticketCount === 1 ? "ticket" : "tickets"} · {NETWORK_LABEL[network]}
          </span>
          <Link
            href={`/portfolio#find`}
            className="ml-auto flex items-center gap-1.5 text-meta text-muted-foreground hover:text-foreground"
          >
            <Search aria-hidden className="size-3.5" /> Find my ticket
          </Link>
        </footer>
      </section>

      <aside className="flex min-w-0 flex-col gap-3">
        <BetTicket
          market={market}
          coin={NETWORK_COIN[network]}
          now={now}
          choice={choice}
          onChoice={setChoice}
          onBet={() => setPaying(true)}
        />
        {freshness}
      </aside>

      {paying ? (
        <BetSheet
          market={market}
          addresses={addresses}
          network={network}
          side={choice.side}
          size={choice.sizeZat}
          onClose={closePay}
        />
      ) : null}
      <Sheet open={rules} onClose={() => setRules(false)} title="Rules & proof">
        <div className="flex flex-col gap-4">
          <p className="text-body text-foreground">{market.rules.question}</p>
          <MarketFacts market={market} now={now} />
          <RulesPanel market={market} />
          <BatchHistory market={market} bundle={bundle} now={now} />
        </div>
      </Sheet>
    </div>
  );
}

/** The asset chip's rolling price and its change against the line the market is judged on. */
function AssetPrice({
  stream,
  reference,
}: {
  stream: NonNullable<ReturnType<typeof assetFor>["stream"]>;
  reference: number | null;
}) {
  const price = usePrice(stream);
  if (!price.price) return <span className="text-meta text-muted-foreground">Connecting…</span>;
  const value = Number(price.price);
  const change = reference ? ((value - reference) / reference) * PERCENT : null;
  return (
    <div className="flex items-baseline gap-2">
      <RollingNumber value={formatUsd(price.price)} className="numbers font-mono text-num-md text-foreground" />
      {change === null ? null : (
        <span className={`font-mono text-num-sm ${change >= 0 ? "text-up" : "text-down"}`}>
          {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(CHANGE_DECIMALS)}%
        </span>
      )}
      <span className="hidden text-micro text-muted-foreground wide:inline">
        {SOURCE_NAME[price.src ?? "coinbase"]}
      </span>
    </div>
  );
}

/** This asset's live markets as lanes: Hourly, Daily, then the strike ladder (Range). The fragment picks one. */
function Lanes({ market, bundle, network }: { market: Market; bundle: Bundle; network: Network }) {
  const siblings = bundle.markets
    .filter((m) => m.subject === market.subject && m.kind === market.kind && LIVE_STATES.has(m.state))
    .sort((a, b) => laneRank(a) - laneRank(b) || Number(a.strike ?? 0) - Number(b.strike ?? 0));
  if (siblings.length <= 1) return null;
  return (
    <nav
      aria-label="Markets for this asset"
      className="flex min-w-0 flex-wrap items-center gap-1 rounded-pill bg-background p-1"
    >
      {siblings.map((m) => (
        <a
          key={m.id}
          href={`#${network}/${m.id}`}
          aria-current={m.id === market.id ? "page" : undefined}
          className={`kk-press flex h-8 items-center rounded-pill px-3 text-chip-label outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            m.id === market.id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {laneLabel(m)}
        </a>
      ))}
    </nav>
  );
}

/** Hourly first, then daily, then the strike ladder; within each, the open window before the upcoming one. */
function laneRank(m: Market): number {
  const lane = m.strike ? 2 : m.window === "1h" ? 0 : 1;
  return lane * 2 + (m.state === "scheduled" ? 1 : 0);
}

function laneLabel(m: Market): string {
  if (m.strike) return `>$${Number(m.strike).toLocaleString("en-US")}`;
  const upcoming = m.state === "scheduled";
  if (m.window === "1h") return upcoming ? "Next hour" : "Hourly";
  if (m.window === "1d") return upcoming ? "Tomorrow" : "Daily";
  return "Session";
}

/** The line a close is judged against, with its label for the chart. */
function referenceOf(market: Market): { value: number | null; label: string } {
  const value = referencePrice(market);
  if (market.strike) return { value, label: `Strike $${Number(market.strike).toLocaleString("en-US")}` };
  return { value, label: value === null ? "Open" : `Open ${formatUsd(String(value))}` };
}

function headline(market: Market, symbol: string, reference: { value: number | null }): string {
  if (market.kind === "event") return market.rules.question;
  if (market.strike) return `${symbol} above $${Number(market.strike).toLocaleString("en-US")} at the close?`;
  return reference.value === null
    ? `${symbol} up or down by the close?`
    : `${symbol} closes above ${formatUsd(String(reference.value))}?`;
}
