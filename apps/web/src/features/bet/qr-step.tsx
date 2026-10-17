"use client";

import { type Market, MIN_TICKETS_PER_SIDE } from "@kakure/domain";
import type { Ticket } from "@kakure/query";
import { Button, buttonClass, cx } from "@kakure/ui-web";
import { DottedQr } from "@kakure/ui-web/qr";
import { Copy, Eye, ShieldAlert, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { NETWORK_COIN, SITE_ORIGIN } from "@/constants";
import { coinAmount, sideWord } from "@/features/markets/market-view";

/**
 * The QR sheet (C2, surfaces.md): the ZIP 321 request as a dotted code on a white plate (error correction M, no
 * centre mark), "Open in Zingo", Copy, and the market-link code for the Kakure app (it names only the market).
 * The bet code is a bearer secret (L26): it blurs whenever this window loses focus and says why.
 */
const COPIED_MS = 1800;
const QR_SIZE = 272;
const LINK_QR_SIZE = 116;

export function QrStep({
  ticket,
  uri,
  market,
  onDone,
}: {
  ticket: Ticket;
  uri: string;
  market: Market;
  onDone: () => void;
}) {
  const [hidden, setHidden] = useState(false);
  const [copied, setCopied] = useState(false);
  const [square, setSquare] = useState(false);
  const coin = NETWORK_COIN[ticket.network];
  const marketLink = `${SITE_ORIGIN}/m#${ticket.network}/${market.id}`;

  useEffect(() => {
    const hide = () => setHidden(true);
    const onVisibility = () => document.hidden && hide();
    window.addEventListener("blur", hide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", hide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(uri);
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-3">
        <div className="relative rounded-group bg-paper p-5">
          <div
            className={cx(
              "transition-[filter] duration-(--duration-selection) motion-reduce:transition-none",
              hidden && "blur-xl",
            )}
          >
            <DottedQr value={uri} ecc="M" size={QR_SIZE} square={square} label="Payment code for this bet" />
          </div>
          {hidden ? (
            <button
              type="button"
              onClick={() => setHidden(false)}
              className="absolute inset-0 m-auto flex h-fit w-fit items-center gap-2 rounded-full bg-primary px-5 py-3 text-button-compact text-primary-foreground shadow-button outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Eye aria-hidden className="size-4" /> Show code
            </button>
          ) : null}
        </div>
        <p className="text-center text-row-title text-foreground">Scan with Zodl or Zingo</p>
        <p className="text-center text-row-detail text-muted-foreground">
          Pay exactly {coinAmount(BigInt(ticket.sizeZat), coin)} on {sideWord(ticket.side)}. The memo is already in the
          code; don't edit it.
        </p>
        <button
          type="button"
          onClick={() => setSquare(!square)}
          className="text-meta text-muted-foreground underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {square ? "Use the dotted code" : "Trouble scanning? Use a square code"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <a href={uri} className={buttonClass("primary", "md", "w-full")}>
          <Wallet aria-hidden className="size-4" /> Open in Zingo
        </a>
        <Button variant="secondary" className="w-full" onClick={() => void copy()}>
          <Copy aria-hidden className="size-4" /> {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      <p className="flex gap-2.5 rounded-row bg-warn-surface px-4 py-3 text-row-detail text-warn">
        <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        This code holds your bet and your payout address. Don't screenshot or share it: anyone who sees it learns your
        side and where you're paid. It hides itself when this window isn't in front.
      </p>

      <div className="flex items-center gap-4 rounded-group bg-raised-2 p-4">
        <div className="shrink-0 rounded-md bg-paper p-2">
          <DottedQr value={marketLink} ecc="M" size={LINK_QR_SIZE} label="Link to this market for the Kakure app" />
        </div>
        <p className="text-row-detail text-muted-foreground">
          <span className="font-semibold text-foreground">In the Kakure app?</span> Scan this instead to bet with one
          tap. It only names the market, nothing about you.
        </p>
      </div>

      <div className="rounded-group bg-raised-2 p-4 text-row-detail text-muted-foreground">
        <p className="font-semibold text-foreground">Waiting for the chain</p>
        <p className="mt-1">
          Your ticket is saved on this device. Once your wallet's payment is mined, the next signed batch lists it as
          counted. Odds stay sealed until each side has {MIN_TICKETS_PER_SIDE} tickets. Don't pay twice: if you're
          unsure, check your wallet first.
        </p>
      </div>

      <Button variant="secondary" size="lg" className="w-full" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}
