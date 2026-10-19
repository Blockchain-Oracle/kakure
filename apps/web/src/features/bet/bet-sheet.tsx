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
import { Button, Sheet } from "@kakure/ui-web";
import { useEffect, useState } from "react";
import { NETWORK_COIN, NETWORK_LABEL } from "@/constants";
import { assetFor } from "@/features/markets/assets";
import { coinAmount, isBettable, shortTitle, sideWord } from "@/features/markets/market-view";
import { useNetwork } from "@/features/network/network-store";
import { addTicket } from "@/features/tickets/use-tickets";
import { VaultLockedError } from "@/features/vault/vault-db";
import { useNow } from "@/lib/time";
import { PayoutAddressField, usePayoutAddress } from "./payout-address";
import { QrStep } from "./qr-step";

/**
 * The pay sheet (plan §0 R2): the ticket already chose the side and size, so this is one line of summary, the payout
 * address (checked in the browser, with Paste) and the button. "Make QR" builds the ZIP 321 request on this device,
 * saves the ticket here first, and only then shows the code (plan §13.2). Nothing is sent to any server.
 */
export interface BetSheetProps {
  market: Market;
  addresses: AddressList | null;
  network: Network;
  side: Side;
  /** The ticket size the bet ticket chose; the smallest size when opened from elsewhere. */
  size?: bigint;
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

export default function BetSheet({ market, addresses, network, side, size: chosen, onClose }: BetSheetProps) {
  const now = useNow();
  const current = useNetwork();
  const size = chosen ?? TICKET_SIZES_ZAT[0] ?? 0n;
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
      fire("send");
    } catch (error) {
      setFailure(
        error instanceof VaultLockedError
          ? "Your tickets are locked with a passphrase. Unlock them in Portfolio or Settings first: the QR is shown only once this ticket is saved."
          : "This browser can't store tickets (private window or storage blocked), so no QR is shown. Without the saved ticket you couldn't find or prove your bet.",
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
          : payout.verdict === "locked"
            ? { label: "Unlock your tickets first", action: () => window.location.assign("/settings#lock") }
            : { label: "Fix the payout address", action: () => payout.focus() };

  return (
    <Sheet open onClose={onClose} title={ticket ? "Pay from your wallet" : "Where should winnings go?"}>
      {ticket ? (
        <QrStep ticket={ticket.ticket} uri={ticket.uri} market={market} onDone={onClose} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3 rounded-group bg-card px-4 py-3">
            <div className="min-w-0">
              <div className="text-body-strong text-foreground">
                <span aria-hidden>{SIGN[side]}</span> {sideWord(side)} · {coinAmount(size, coin)}
              </div>
              <div className="truncate text-meta text-muted-foreground">{shortTitle(market, asset.symbol)}</div>
            </div>
            <div className="text-right">
              <div className="text-meta text-muted-foreground">To win</div>
              <div className="font-mono text-num-md text-up">
                {estimate === null ? "—" : coinAmount(estimate, coin)}
              </div>
            </div>
          </div>
          <PayoutAddressField state={payout} network={network} />
          <p className="text-meta text-muted-foreground">
            Zodl: move funds to Ironwood first (Zodl → Migrate), or the amount shows on chain.
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
            {NETWORK_LABEL[network]} · built on this device, never sent to a server
          </p>
        </div>
      )}
    </Sheet>
  );
}
