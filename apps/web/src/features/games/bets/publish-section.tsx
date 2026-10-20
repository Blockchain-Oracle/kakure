"use client";

import type { Network } from "@kakure/domain";
import { fire } from "@kakure/sounds";
import { Switch } from "@kakure/ui-web";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useRealtime } from "@/features/data/use-realtime";
import { MintError } from "@/features/wallet/api";
import { upDownOf } from "@/features/wallet/records";
import { useWallet } from "@/features/wallet/wallet-store";
import { ArcadeError } from "../player/api";
import { NicknameSheet } from "../player/nickname-sheet";
import { useNickname } from "../player/player-store";
import { BETS } from "./copy";
import { publishPosition, retractPosition } from "./publish";
import { betsKeys, useBetsBoard, useProfile } from "./queries";

const P = BETS.publish;

/**
 * Owarine's opt-in "publish this call", made private (plan §0 R7 under v2, after its privacy review): a paid single Up
 * or Down call can go on the Bets board under this device's nickname, and come off it again. The operator vouches for
 * it over the sealed path, so only "right" or "wrong" reaches the arcade. The sheet says what the weekly board can
 * still give away, and who can tell which trade it was.
 */
export function PublishSection({ network, positionKey }: { network: Network; positionKey: string }) {
  const wallet = useWallet(network);
  const nickname = useNickname();
  const board = useBetsBoard("week");
  const profile = useProfile(nickname);
  const realtime = useRealtime();
  const trading =
    realtime.status === "ready" && realtime.network === network ? (realtime.bundle.trading ?? null) : null;
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameOpen, setNameOpen] = useState(false);
  const record = wallet.positions.find((p) => p.key === positionKey);
  const eligible = record?.state === "paid" && upDownOf(record.certificate) !== null;
  const boardNetwork = board.data?.network ?? null;
  // The board's network must be known: a call is never sent toward a board that counts the other network.
  const here = boardNetwork === network;
  const published = record?.published ?? null;

  const toggle = async (next: boolean) => {
    if (!nickname) {
      setNameOpen(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (next) {
        if (!trading) throw new Error("The signed trading info isn't loaded yet; try again in a moment.");
        await publishPosition(network, trading, positionKey);
      } else await retractPosition(network, positionKey);
      fire("toggle", { haptic: "tick" });
      void qc.invalidateQueries({ queryKey: ["arcade", "bets"] });
      void qc.invalidateQueries({ queryKey: betsKeys.profile(nickname) });
    } catch (cause) {
      fire("error");
      setError(
        cause instanceof MintError || cause instanceof ArcadeError || cause instanceof Error
          ? cause.message
          : String(cause),
      );
    } finally {
      setBusy(false);
    }
  };

  const status = busy ? P.busy : published ? P.on(published.right) : P.off;
  return (
    <section className="flex flex-col gap-2 rounded-group border border-border p-4" aria-label={P.title}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 flex-col">
          <span className="text-row-strong text-foreground">{P.title}</span>
          <span className="text-meta text-muted-foreground">{status}</span>
        </span>
        <Switch
          checked={published !== null}
          onChange={(next) => void toggle(next)}
          label={P.switchLabel}
          disabled={busy || !eligible || !here}
        />
      </div>
      <p className="text-meta text-muted-foreground">
        {!eligible
          ? P.notEligible
          : boardNetwork === null
            ? P.loading
            : !here
              ? P.notThisNetwork(boardNetwork)
              : P.explain}
      </p>
      {eligible && here ? <p className="text-meta text-muted-foreground">{P.rule}</p> : null}
      {eligible && here && profile.data?.x ? <p className="text-meta text-foreground">{P.xName}</p> : null}
      {!nickname && eligible && here ? (
        <button
          type="button"
          className="self-start text-meta text-vermilion underline"
          onClick={() => setNameOpen(true)}
        >
          {P.needName}
        </button>
      ) : null}
      {error ? (
        <p role="alert" className="text-meta text-destructive">
          {error}
        </p>
      ) : null}
      <NicknameSheet open={nameOpen} onClose={() => setNameOpen(false)} onClaimed={() => setNameOpen(false)} />
    </section>
  );
}
