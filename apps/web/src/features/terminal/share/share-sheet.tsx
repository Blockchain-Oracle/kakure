"use client";

import { cadenceLabel, type Network } from "@kakure/domain";
import { fire } from "@kakure/sounds";
import { Sheet } from "@kakure/ui-web";
import { Download, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { SITE_ORIGIN } from "@/constants";
import { PublishSection } from "@/features/games/bets/publish-section";
import { PERCENT } from "../constants";
import { sideWord } from "../format";
import type { HistoryRow } from "../sheets/wallet-sheet";
import { postText, renderShareCard, roiText, saveCard } from "./card";

/**
 * Share a result (Owarine `PositionSheets.tsx` `ShareSheet`, made private): only once it's paid, ROI only (no stake,
 * no payout, no time to the minute), as a PNG card drawn here and an X post. Nothing is sent unless you share it.
 * Below it, a paid position's opt-in switch for the Bets board (plan §0 R7); a partial close has none.
 */
export function ShareSheet({
  open,
  onClose,
  row,
  network,
}: {
  open: boolean;
  onClose: () => void;
  row: HistoryRow | null;
  network: Network;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const roi = row && row.stakeZat > 0 ? (row.pnlZat / row.stakeZat) * PERCENT : null;
  const call = row
    ? row.parlay
      ? "Parlay"
      : `${row.asset} ${row.side ? sideWord(row.side).toUpperCase() : ""}${row.cadenceSec ? ` · ${cadenceLabel(row.cadenceSec)}` : ""}`
    : "";
  const market = row && !row.parlay ? `${SITE_ORIGIN}/trade#${row.asset}` : `${SITE_ORIGIN}/markets`;

  useEffect(() => {
    if (!open || !row || roi === null) return;
    let alive = true;
    let objectUrl: string | null = null;
    void renderShareCard({
      call,
      roiPct: roi,
      when: new Date(row.at).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }),
      url: market,
    }).then((b) => {
      if (!alive) return;
      objectUrl = URL.createObjectURL(b);
      setBlob(b);
      setUrl(objectUrl);
    });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(null);
      setBlob(null);
    };
  }, [open, row, roi, call, market]);

  const post =
    row && roi !== null ? postText(row.parlay ? "a parlay" : row.asset, row.side ? sideWord(row.side) : "", roi) : "";
  const intent = `https://x.com/intent/post?text=${encodeURIComponent(post)}&url=${encodeURIComponent(market)}`;

  return (
    <Sheet open={open} onClose={onClose} title="Share result">
      {!row || roi === null ? (
        <p className="py-6 text-center text-row text-muted-foreground">Nothing to share yet.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {url ? (
            <img src={url} alt={`${call}, ${roiText(roi)}`} className="w-full rounded-group border border-border" />
          ) : (
            <div className="aspect-[16/10] w-full rounded-group bg-secondary motion-safe:animate-pulse" />
          )}
          <p className="text-meta text-muted-foreground">
            The card shows the call and the return, never an amount. It links to the market, not to your trade.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!blob}
              onClick={() => {
                if (!blob) return;
                fire("toggle", { haptic: "tick" });
                void saveCard(blob, `kakure-${row.asset.toLowerCase() || "parlay"}.png`);
              }}
              className="flex h-12 items-center justify-center gap-2 rounded-full bg-secondary text-row-strong disabled:opacity-40"
            >
              <Download aria-hidden className="size-4" /> Save image
            </button>
            <a
              href={intent}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-12 items-center justify-center gap-2 rounded-full bg-foreground text-row-strong text-stage"
            >
              <Share2 aria-hidden className="size-4" /> Post on X
            </a>
          </div>
          {row.tag !== "REDUCE" ? <PublishSection network={network} positionKey={row.id} /> : null}
        </div>
      )}
    </Sheet>
  );
}
