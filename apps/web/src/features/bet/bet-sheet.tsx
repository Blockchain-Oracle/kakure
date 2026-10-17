"use client";

import {
  type AddressList,
  buildPaymentUri,
  encodeBetMemo,
  type Market,
  type Network,
  newNonce,
  type Side,
  TICKET_SIZES_ZAT,
  toBase64Url,
} from "@kakure/domain";
import { type Ticket, ticketLeaf, winningPayout } from "@kakure/query";
import { fire } from "@kakure/sounds";
import { Button, Chip, ChipGroup, SegmentedControl, Sheet } from "@kakure/ui-web";
import { useEffect, useState } from "react";
import { NETWORK_COIN, NETWORK_LABEL } from "@/constants";
import { assetFor } from "@/features/markets/assets";
import { coinAmount, isBettable, sidesOf, sideWord } from "@/features/markets/market-view";
import { useNetwork } from "@/features/network/network-store";
import { addTicket } from "@/features/tickets/use-tickets";
import { useNow } from "@/lib/time";
import { PayoutAddressField, usePayoutAddress } from "./payout-address";
import { QrStep } from "./qr-step";

/**
 * The bet sheet (C2, surfaces.md): side, a fixed ticket, max loss and (only once odds are released) a payout
 * estimate, then the payout address checked in the browser. "Make QR" builds the ZIP 321 request on this device,
 * saves the ticket here first, and only then shows the code (plan §13.2). Nothing is sent to any server.
 */
export interface BetSheetProps {
  market: Market;
  addresses: AddressList | null;
  network: Network;
  side: Side;
  onClose: () => void;
}

const SIGN: Record<string, string> = { U: "▲", D: "▼", Y: "✓", N: "✕" };
const RANDOM_WORDS = 1;
/** Uint32 values span 0..2^32. */
const WORD_RANGE = 4_294_967_296;

/** A uniformly random address from the signed list (D7), by rejection sampling so no address is favoured. */
function pickAddress(list: AddressList): string | undefined {
  const count = list.addresses.length;
  const limit = WORD_RANGE - (WORD_RANGE % count);
  for (;;) {
    const [word = 0] = crypto.getRandomValues(new Uint32Array(RANDOM_WORDS));
    if (word < limit) return list.addresses[word % count];
  }
}

export default function BetSheet({ market, addresses, network, side: initialSide, onClose }: BetSheetProps) {
  const now = useNow();
  const current = useNetwork();
  const [side, setSide] = useState<Side>(initialSide);
  const [size, setSize] = useState<bigint>(TICKET_SIZES_ZAT[0] ?? 0n);
  const payout = usePayoutAddress(network);
  const [ticket, setTicket] = useState<{ ticket: Ticket; uri: string } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const coin = NETWORK_COIN[network];
  const asset = assetFor(market);

  // Switching networks cancels any open QR (plan §13.16).
  useEffect(() => {
    if (current !== network) onClose();
  }, [current, network, onClose]);

  const estimate = winningPayout(
    {
      ...market,
      ...(market.released
        ? {
            released: {
              ...market.released,
              sides: {
                ...market.released.sides,
                [side]: {
                  tickets: (market.released.sides[side]?.tickets ?? 0) + 1,
                  zat: String(BigInt(market.released.sides[side]?.zat ?? "0") + size),
                },
              },
            },
          }
        : {}),
    },
    side,
    size,
  );

  const makeQr = async () => {
    setFailure(null);
    const marketAddress = addresses ? pickAddress(addresses) : undefined;
    if (!marketAddress) {
      setFailure("The signed address list hasn't loaded yet. Wait a moment and try again.");
      return;
    }
    try {
      const nonce = newNonce();
      const memo = encodeBetMemo({
        network,
        marketId: market.id,
        side,
        sizeZat: size,
        nonce,
        payoutAddress: payout.value,
      });
      const uri = buildPaymentUri({ address: marketAddress, amountZat: size, memo });
      const draft: Omit<Ticket, "hash"> = {
        network,
        marketId: market.id,
        side,
        sizeZat: size.toString(),
        nonce: toBase64Url(nonce),
        payoutAddress: payout.value.trim(),
        marketAddress,
        createdAt: Date.now(),
        question: market.rules.question,
        subject: market.subject,
        kind: market.kind,
        window: market.window,
        cutoffAt: market.cutoffAt,
        closesAt: market.closesAt,
      };
      const saved: Ticket = { ...draft, hash: ticketLeaf(draft) };
      // Saved before the QR exists: without it the bettor couldn't find, track or prove the bet.
      await addTicket(saved);
      setTicket({ ticket: saved, uri });
      fire("send", { identity: `built:${saved.hash}` });
    } catch {
      setFailure(
        "This browser can't store tickets (private window or storage blocked), so no QR is shown. Without the saved ticket you couldn't find or prove your bet.",
      );
      fire("error");
    }
  };

  const open = isBettable(market, now) || now === 0;
  const cta = !open
    ? { label: "Betting is closed", action: onClose }
    : payout.verdict === "empty"
      ? { label: "Paste a payout address", action: () => void payout.paste() }
      : payout.verdict === "ok"
        ? { label: "Make QR", action: () => void makeQr() }
        : payout.verdict === "checking"
          ? { label: "Checking the address…", action: () => undefined }
          : { label: "Fix the payout address", action: () => payout.focus() };

  return (
    <Sheet open onClose={onClose} title={ticket ? "Pay from your wallet" : `Bet on ${asset.symbol}`}>
      {ticket ? (
        <QrStep ticket={ticket.ticket} uri={ticket.uri} market={market} onDone={onClose} />
      ) : (
        <div className="flex flex-col gap-5">
          <p className="text-row-detail text-muted-foreground">{market.rules.question}</p>
          <SegmentedControl
            label="Side"
            value={side}
            onChange={(next) => setSide(next)}
            options={sidesOf(market).map((value) => ({
              value: value as Side,
              label: `${SIGN[value] ?? ""} ${sideWord(value)}`,
            }))}
            className="w-full"
          />
          <div className="flex flex-col gap-2">
            <span className="text-label text-muted-foreground">Ticket</span>
            <ChipGroup label="Ticket size">
              {TICKET_SIZES_ZAT.map((value) => (
                <Chip key={value.toString()} selected={value === size} onClick={() => setSize(value)}>
                  {coinAmount(value, coin)}
                </Chip>
              ))}
            </ChipGroup>
          </div>
          <dl className="flex flex-col gap-2.5 rounded-group bg-raised-2 p-4">
            <Fact label="You risk" value={coinAmount(size, coin)} />
            <Fact
              label={`If ${sideWord(side)} wins`}
              value={estimate === null ? "Set by the final pools" : `≈ ${coinAmount(estimate, coin)}`}
            />
            <p className="text-meta text-muted-foreground">
              {estimate === null
                ? "Odds are sealed until each side has 3 tickets, so there's no estimate yet. Winners split the losing side, less 2 %."
                : `At the totals released in batch ${market.released?.seq}, with your ticket added. The final pools decide.`}{" "}
              Your wallet pays the network fee.
            </p>
          </dl>
          <PayoutAddressField state={payout} network={network} />
          <p className="rounded-row bg-warn-surface px-4 py-3 text-row-detail text-warn">
            Paying from Zodl? Move your funds to Ironwood first (Zodl → Migrate). Paying from older Orchard funds
            reveals the bet amount on chain.
          </p>
          {failure ? (
            <p role="alert" className="rounded-row bg-destructive-surface px-4 py-3 text-row-detail text-destructive">
              {failure}
            </p>
          ) : null}
          <Button size="lg" className="w-full" onClick={cta.action}>
            {cta.label}
          </Button>
          <p className="text-center text-meta text-muted-foreground">
            {NETWORK_LABEL[network]} · the QR and memo are built on this device and never sent to a server
          </p>
        </div>
      )}
    </Sheet>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-row-detail text-muted-foreground">{label}</dt>
      <dd className="text-row-amount text-foreground tabular-nums">{value}</dd>
    </div>
  );
}
