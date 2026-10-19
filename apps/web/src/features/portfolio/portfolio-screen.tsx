"use client";

import { type Network, ZATOSHI_PER_ZEC } from "@kakure/domain";
import { usePrice } from "@kakure/feeds";
import type { StreamSymbol } from "@kakure/feeds/protocol";
import { Mark, Pill, RollingNumber, Tabs } from "@kakure/ui-web";
import { Clapperboard, Eye, EyeOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { NETWORK_COIN } from "@/constants";
import { useMarkets } from "@/features/data/use-markets";
import { assetFor } from "@/features/markets/assets";
import { sideWord, WINDOW_LABEL } from "@/features/markets/market-view";
import { TicketSheet } from "@/features/receipts/ticket-sheet";
import { setPrefs, usePrefs } from "@/features/settings/prefs-store";
import { STATUS_LABEL, STATUS_TONE } from "@/features/tickets/status";
import { addTicket, useTickets } from "@/features/tickets/use-tickets";
import { WalletSection } from "@/features/wallet/wallet-section";
import { formatShortWhen, useNow } from "@/lib/time";
import { useAmounts } from "./amounts";
import { type Position, positionsOf, totalsOf } from "./money";
import { SoundLadder } from "./sound-ladder";

/**
 * The portfolio (C9, surfaces.md; plan §00 Portfolio): the chip wallet first (balance, deposit, withdraw), then this
 * device's tickets. Open and settled lists, P&L in ZEC with fiat as
 * secondary (mainnet only: TAZ has no value), the privacy eye, the sound ladder while a position is open, and an
 * honest Replay state until the web reads the signed price history.
 */
type Tab = "open" | "settled";
const ZEC_STREAM: StreamSymbol = "ZEC-USD";
const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function PortfolioScreen() {
  const data = useMarkets();
  const network = data.network;
  const tickets = useTickets(network);
  const now = useNow();
  const prefs = usePrefs();
  const [tab, setTab] = useState<Tab>("open");
  const [selected, setSelected] = useState<string | null>(null);
  const bundle = data.status === "ready" ? data.bundle : null;
  const positions = useMemo(
    () => (Array.isArray(tickets) ? positionsOf(tickets, bundle, now) : []),
    [tickets, bundle, now],
  );
  const totals = totalsOf(positions);
  const shown = positions.filter((position) => position.open === (tab === "open"));
  const chosen = positions.find((position) => position.ticket.hash === selected) ?? null;

  // Remember the last status seen in a bundle, so a ticket stays readable after its market is archived.
  useEffect(() => {
    for (const { ticket, view } of positions) {
      if (!view.market || view.seq === null || ticket.last?.status === view.status) continue;
      void addTicket({
        ...ticket,
        last: {
          status: view.status,
          seq: view.seq,
          ...(view.payoutZat === null ? {} : { payoutZat: view.payoutZat.toString() }),
        },
      });
    }
  }, [positions]);

  // Links from a market page open the ticket: /portfolio#<ticket hash>.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash) setSelected(hash);
  }, []);

  const voices = positions
    .filter((position) => position.open && position.ticket.kind === "close")
    .flatMap((position) => {
      const stream = assetFor({ kind: position.ticket.kind, subject: position.ticket.subject }).stream;
      return stream
        ? [
            {
              key: position.ticket.hash,
              stream,
              direction: position.ticket.side === "D" ? ("down" as const) : ("up" as const),
            },
          ]
        : [];
    });

  return (
    <div className="mx-auto flex w-full max-w-(--layout-content-max) flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-page-title text-foreground">Portfolio</h1>
        <button
          type="button"
          onClick={() => setPrefs({ hideAmounts: !prefs.hideAmounts })}
          aria-pressed={prefs.hideAmounts}
          className="flex items-center gap-2 rounded-full bg-secondary px-3.5 py-2 text-chip-label text-secondary-foreground outline-none hover:bg-row-pressed focus-visible:ring-2 focus-visible:ring-ring"
        >
          {prefs.hideAmounts ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
          {prefs.hideAmounts ? "Amounts hidden" : "Hide amounts"}
        </button>
      </div>

      <WalletSection />

      {/* Tickets from the earlier per-bet design, while any are on this device; the wallet above speaks for the vault. */}
      {!Array.isArray(tickets) || tickets.length === 0 ? null : (
        <>
          <Hero
            network={network}
            atRisk={totals.atRisk}
            pnl={totals.pnl}
            pending={totals.pending}
            open={voices.length}
          />
          <Tabs
            label="Tickets"
            value={tab}
            onChange={setTab}
            items={[
              { value: "open", label: "Open", count: positions.filter((p) => p.open).length },
              { value: "settled", label: "Settled", count: positions.filter((p) => !p.open).length },
            ]}
          />
          {shown.length === 0 ? (
            <p className="rounded-group border border-border bg-card p-5 text-row-detail text-muted-foreground">
              {tab === "open" ? "No open tickets. Settled ones are in the other tab." : "Nothing has settled yet."}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {shown.map((position) => (
                <Row
                  key={position.ticket.hash}
                  position={position}
                  now={now}
                  onOpen={() => setSelected(position.ticket.hash)}
                />
              ))}
            </ul>
          )}
          <ReplayCard />
          <SoundLadder voices={voices} />
        </>
      )}
      {chosen ? (
        <TicketSheet ticket={chosen.ticket} view={chosen.view} bundle={bundle} onClose={() => setSelected(null)} />
      ) : null}
    </div>
  );
}

function Hero({
  network,
  atRisk,
  pnl,
  pending,
  open,
}: {
  network: Network;
  atRisk: bigint;
  pnl: bigint;
  pending: number;
  open: number;
}) {
  const coin = NETWORK_COIN[network];
  const { format, hidden } = useAmounts(coin);
  const zec = usePrice(ZEC_STREAM);
  const prefs = usePrefs();
  const fiat = (zat: bigint) =>
    network === "mainnet" && zec.price && !hidden
      ? USD.format((Number(zat) / Number(ZATOSHI_PER_ZEC)) * Number(zec.price))
      : null;
  return (
    <section className="grid grid-cols-1 gap-4 rounded-group border border-border bg-card p-5 md:grid-cols-2">
      <div>
        <div className="text-label text-muted-foreground">Riding on open tickets</div>
        <div className="mt-1 numbers text-display-price text-foreground">
          {hidden ? "Hidden" : <RollingNumber value={format(atRisk)} />}
        </div>
        <div className="text-money-meta text-muted-foreground">
          {fiat(atRisk) ?? (network === "testnet" ? "Test coins: no fiat value" : "")}
        </div>
      </div>
      <div>
        <div className="text-label text-muted-foreground">Settled result</div>
        <div
          className={`mt-1 numbers text-display-price ${pnl > 0n ? "text-up" : pnl < 0n ? "text-down" : "text-foreground"}`}
        >
          {hidden ? "Hidden" : <RollingNumber value={format(pnl, true)} />}
        </div>
        <div className="text-money-meta text-muted-foreground">
          {pending > 0 ? `${pending} won ticket${pending === 1 ? "" : "s"} waiting for final totals · ` : ""}
          {open > 0
            ? prefs.ladder && prefs.sound
              ? "The sound ladder plays while a position is open"
              : "Sound ladder off (Settings)"
            : "No live positions"}
        </div>
      </div>
    </section>
  );
}

function Row({ position, now, onOpen }: { position: Position; now: number; onOpen: () => void }) {
  const { ticket, view } = position;
  const asset = assetFor({ kind: ticket.kind, subject: ticket.subject });
  const { format } = useAmounts(NETWORK_COIN[ticket.network]);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="kk-press flex w-full items-center gap-3 rounded-group border border-border bg-card p-4 text-left outline-none hover:bg-row-pressed focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Mark mark={asset.mark} label={asset.symbol} />
        <span className="min-w-0 flex-1">
          <span className="block text-row-strong text-foreground">
            {sideWord(ticket.side)} · {asset.symbol} {WINDOW_LABEL[ticket.window]}
          </span>
          <span className="block truncate text-meta text-muted-foreground">
            Closes {formatShortWhen(ticket.closesAt, now)} · {format(BigInt(ticket.sizeZat))}
          </span>
        </span>
        <Pill tone={STATUS_TONE[view.status]}>{STATUS_LABEL[view.status]}</Pill>
      </button>
    </li>
  );
}

/**
 * Replay and Recap will be rendered from the signed `history-<yyyymmdd>.json` files (plan §13.15, C9), which the web
 * app doesn't read yet; until then this card says so instead of faking a film.
 */
function ReplayCard() {
  return (
    <section className="flex items-start gap-4 rounded-group border border-border bg-card p-5">
      <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-md bg-secondary text-foreground">
        <Clapperboard className="size-5" />
      </span>
      <div>
        <h2 className="font-display text-title text-foreground">Replay arrives with price history</h2>
        <p className="mt-1 text-row-detail text-muted-foreground">
          Replay and Recap films will be drawn from the operator's signed daily price history, which this site doesn't
          read yet. No film is faked from a guess; they'll appear here once it does.
        </p>
      </div>
    </section>
  );
}
