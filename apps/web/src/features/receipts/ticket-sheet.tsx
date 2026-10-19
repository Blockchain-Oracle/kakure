"use client";

import { type Bundle, MIN_NEW_TICKETS_PER_RELEASE } from "@kakure/domain";
import { encodeReceipt, isFinal, type Ticket, type TicketView } from "@kakure/query";
import { Button, SegmentedControl, Sheet, TicketStub } from "@kakure/ui-web";
import { DottedQr } from "@kakure/ui-web/qr";
import { Download, Link2, Mail, Search } from "lucide-react";
import { useState } from "react";
import { NETWORK_COIN, NETWORK_LABEL } from "@/constants";
import { assetFor } from "@/features/markets/assets";
import { sideWord, ticketsWord, WINDOW_LABEL } from "@/features/markets/market-view";
import { useAmounts } from "@/features/portfolio/amounts";
import { KakureMark } from "@/features/shell/brand";
import { downloadBlob } from "@/features/tickets/export";
import { STATUS_DETAIL, STATUS_LABEL } from "@/features/tickets/status";
import { copySecret } from "@/lib/clipboard";
import { drawReceipt } from "./draw-receipt";

/**
 * One ticket as Kawase's perforated slip (C4, C8), with Find my ticket and the receipt actions. Receipts are made
 * on this device from the ticket plus the signed bundle and are redacted by default (plan §3): no payout address,
 * no txid, no bet time. "Provable" adds the nonce so anyone can recompute the leaf, and only then is any part of the
 * ticket hash shown (its folio). "Outcome slip" shows the result without proving it and carries nothing derived from
 * the hash (O3): a hash prefix would find the leaf in the signed list, and so the batch the bet arrived in.
 */
type Mode = "outcome" | "provable";

const STAMP: Partial<Record<TicketView["status"], { word: string; tone: "up" | "down" | "warn" | "neutral" }>> = {
  won: { word: "Won", tone: "up" },
  paid: { word: "Paid", tone: "up" },
  lost: { word: "Lost", tone: "down" },
  refunded: { word: "Refund", tone: "warn" },
  counted: { word: "Counted", tone: "neutral" },
};
const FOLIO_LENGTH = 6;
const SHORT_HEAD = 8;
const SHORT_TAIL = 6;

function short(hash: string) {
  return `${hash.slice(0, SHORT_HEAD)}…${hash.slice(-SHORT_TAIL)}`;
}

export function TicketSheet({
  ticket,
  view,
  bundle,
  onClose,
}: {
  ticket: Ticket;
  view: TicketView;
  bundle: Bundle | null;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>("outcome");
  const [found, setFound] = useState<string | null>(null);
  const [showAddress, setShowAddress] = useState(false);
  const coin = NETWORK_COIN[ticket.network];
  const { format, hidden } = useAmounts(coin);
  const asset = assetFor({ kind: ticket.kind, subject: ticket.subject });
  const provable = mode === "provable";
  const folio = provable ? ticket.hash.slice(0, FOLIO_LENGTH).toUpperCase() : null;
  const tag = folio ? `Ticket ${folio}` : "Outcome slip";
  const won = view.status === "won" || view.status === "paid";
  const figureZat = won && view.payoutZat !== null ? view.payoutZat : BigInt(ticket.sizeZat);
  const receipt = encodeReceipt(ticket, mode, view.seq ?? undefined);
  const verifyUrl = `${typeof window === "undefined" ? "" : window.location.origin}/verify#${receipt}`;
  const eyebrow = won
    ? "You won"
    : view.status === "refunded"
      ? "Refund due"
      : view.status === "lost"
        ? "Lost"
        : "Your ticket";
  const caption = `${sideWord(ticket.side)} on ${asset.symbol} · ${WINDOW_LABEL[ticket.window]}`;
  const facts: Array<[string, string]> = [
    ["Side", sideWord(ticket.side)],
    ["Ticket", format(BigInt(ticket.sizeZat))],
    ["Network", NETWORK_LABEL[ticket.network]],
    ["Status", `${STATUS_LABEL[view.status]}${view.seq === null ? "" : ` · batch ${view.seq}`}`],
    ...(provable ? ([["Ticket hash", short(ticket.hash)]] as Array<[string, string]>) : []),
  ];

  const findTicket = () => {
    if (!bundle) {
      setFound("No signed batch is loaded yet, so there's nothing to search.");
      return;
    }
    const market = bundle.markets.find((candidate) => candidate.id === ticket.marketId);
    const where = bundle.markets.find((candidate) => candidate.leaves.includes(ticket.hash));
    setFound(
      where
        ? `Found in batch ${bundle.seq}'s signed list for ${where.id}. Searched on this device; nothing was sent.`
        : market
          ? isFinal(market)
            ? `Not in this market's final list (batch ${bundle.seq}, ${ticketsWord(market.leaves.length)}). If you paid, it's refunded in full. Searched on this device.`
            : `Not listed yet in batch ${bundle.seq} (${ticketsWord(market.leaves.length)} listed). Waiting for its batch: counted once ${MIN_NEW_TICKETS_PER_RELEASE} new tickets arrive; refunded in full if the market closes first. Searched on this device.`
          : `This market isn't in batch ${bundle.seq}, so its list can't be searched here.`,
    );
  };

  const savePng = async () => {
    const blob = await drawReceipt({
      tag,
      eyebrow,
      figure: hidden ? "Hidden" : format(figureZat),
      caption,
      ...(STAMP[view.status] ? { stamp: STAMP[view.status]?.word ?? "" } : {}),
      facts,
      verifyUrl,
      footer: `Kakure · ${NETWORK_LABEL[ticket.network]}`,
    });
    downloadBlob(blob, folio ? `kakure-ticket-${folio}.png` : "kakure-outcome-slip.png");
  };

  const email = async () => {
    await savePng();
    const body = [
      `Kakure · ${tag}`,
      `${caption}`,
      ...facts.map(([label, value]) => `${label}: ${value}`),
      "",
      `Verify: ${verifyUrl}`,
      "",
      "The ticket image was saved to your downloads; attach it if you like.",
    ].join("\n");
    window.location.href = `mailto:?subject=${encodeURIComponent(`Kakure · ${tag}`)}&body=${encodeURIComponent(body)}`;
  };

  return (
    <Sheet open onClose={onClose} title="Ticket">
      <div className="flex flex-col gap-5">
        <TicketStub
          ground="bg-card"
          className="bg-raised-2 shadow-none"
          brand={
            <span className="flex items-center gap-2">
              <span className="kk-disc size-7">
                <KakureMark className="size-5" />
              </span>
              <span className="font-display text-row-title font-bold tracking-[0.12em]">KAKURE</span>
            </span>
          }
          tag={tag}
          eyebrow={eyebrow}
          figure={format(figureZat)}
          caption={caption}
          {...(STAMP[view.status] ? { stamp: STAMP[view.status] } : {})}
          facts={facts.map(([label, value]) => ({ label, value }))}
          stub={
            <div className="flex items-center gap-4">
              <div className="shrink-0 rounded-md bg-paper p-2">
                <DottedQr
                  value={verifyUrl}
                  ecc="M"
                  size={104}
                  label="Verify link for this receipt"
                  mark={<KakureMark className="size-full text-paper-ink" />}
                />
              </div>
              <p className="text-row-detail text-muted-foreground">
                <span className="font-semibold text-foreground">Verify it.</span> Scan or open the link to check this
                ticket against the operator's signed batch.
              </p>
            </div>
          }
        />
        <p className="text-row-detail text-muted-foreground">{STATUS_DETAIL[view.status]}</p>

        <div className="flex flex-col gap-2">
          <Button variant="secondary" onClick={findTicket}>
            <Search aria-hidden className="size-4" /> Find my ticket
          </Button>
          {found ? (
            <p role="status" className="text-row-detail text-foreground">
              {found}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 rounded-group bg-raised-2 p-4">
          <span className="text-label text-muted-foreground">Receipt</span>
          <SegmentedControl
            label="Receipt mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: "outcome", label: "Outcome slip" },
              { value: "provable", label: "Provable" },
            ]}
            className="w-full"
          />
          <p className="text-meta text-muted-foreground">
            {mode === "outcome"
              ? "Shows the market, side, size and result. It can't be checked against the signed list, and it can't be traced to your payment."
              : "Adds your ticket's secret nonce, so anyone with the link can recompute its hash and find it in the signed list. Share it only with someone you want to prove the bet to."}
          </p>
          <div className="grid grid-cols-3 gap-2">
            <Button variant="secondary" size="sm" onClick={() => void savePng()}>
              <Download aria-hidden className="size-4" /> PNG
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void email()}>
              <Mail aria-hidden className="size-4" /> Email it
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void (provable ? copySecret(verifyUrl) : navigator.clipboard.writeText(verifyUrl))}
            >
              <Link2 aria-hidden className="size-4" /> Link
            </Button>
          </div>
        </div>

        <details
          className="text-row-detail text-muted-foreground"
          onToggle={(event) => setShowAddress(event.currentTarget.open)}
        >
          <summary className="cursor-pointer rounded-xs outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Private details on this device
          </summary>
          {showAddress ? (
            <dl className="mt-2 flex flex-col gap-2 break-all">
              <div>
                <dt className="text-label">Payout address</dt>
                <dd className="text-foreground">{ticket.payoutAddress}</dd>
              </div>
              <div>
                <dt className="text-label">Ticket hash</dt>
                <dd className="text-foreground">{ticket.hash}</dd>
              </div>
            </dl>
          ) : null}
        </details>
      </div>
    </Sheet>
  );
}
