"use client";

import type { Resolution } from "@kakure/domain";
import { isDataError } from "@kakure/query";
import { Button } from "@kakure/ui-web";
import { NETWORK_COIN } from "@/constants";
import { coinAmount, sideWord, ticketsWord } from "@/features/markets/market-view";
import { formatDateTime } from "@/lib/time";

/**
 * A market's signed resolution evidence, read from the full set /proof downloads at once (O22): asking the host for
 * one market's file would tell it which market you're checking. Venue URLs are shown as text, not links, so
 * reading them makes no request either.
 */
const MS_PER_SECOND = 1000;

const REASON: Record<Resolution["reason"], string> = {
  majority: "At least 2 of 3 venues agreed on the direction.",
  chain: "Read from the chain.",
  "thin-pool": "A side had fewer than 3 tickets at the cutoff, so every ticket is refunded.",
  "no-majority": "The venues didn't agree (split, flat or missing), so every ticket is refunded.",
  cancelled: "The market was cancelled under its rules, so every ticket is refunded.",
  "servers-disagree": "The chain servers disagreed, so every ticket is refunded.",
};

export function EvidenceLoader({
  count,
  loaded,
  loading,
  error,
  onLoad,
}: {
  count: number;
  loaded: boolean;
  loading: boolean;
  error: unknown;
  onLoad: () => void;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-group bg-card p-5" aria-labelledby="evidence-title">
      <h2 id="evidence-title" className="text-title text-foreground">
        Resolution evidence
      </h2>
      <p className="text-row-detail text-muted-foreground">
        {count === 0
          ? "No market in this batch has resolved yet."
          : `This batch names ${count} signed resolution ${count === 1 ? "file" : "files"}. They're downloaded together, never one market at a time, so the host can't tell which market you're checking; each is signature-checked here.`}
      </p>
      {count > 0 && !loaded ? (
        <Button variant="secondary" className="w-fit" onClick={onLoad} disabled={loading}>
          {loading ? "Checking the files…" : `Load all ${count}`}
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="text-row-detail text-down">
          {isDataError(error) ? `A file failed its check (${error.message}).` : "The evidence didn't load."} Nothing
          unverified is shown.
        </p>
      ) : null}
    </section>
  );
}

export function EvidenceDetails({ resolution }: { resolution: Resolution }) {
  const coin = NETWORK_COIN[resolution.network];
  const totals = Object.entries(resolution.totals);
  return (
    <div className="flex flex-col gap-3 text-row-detail text-foreground">
      <p>
        {resolution.outcome === "refund" ? "Refund" : `Resolved ${sideWord(resolution.outcome)}`} at{" "}
        {formatDateTime(resolution.resolvedAt)}. {REASON[resolution.reason]}
      </p>
      <p className="text-muted-foreground">
        Final counts below cutoff block {resolution.cutoffHeight}:{" "}
        {totals.length === 0
          ? "none"
          : totals
              .map(
                // A refunded market's evidence has counts only (no payout depends on the sizes).
                ([side, pool]) =>
                  `${sideWord(side)} ${ticketsWord(pool?.tickets ?? 0)}${pool?.zat === undefined ? "" : `, ${coinAmount(BigInt(pool.zat), coin)}`}`,
              )
              .join(" · ")}
        .
      </p>
      {resolution.votes && resolution.votes.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {resolution.votes.map((vote) => (
            <li key={`${vote.venue}-${vote.pair}`} className="tabular-nums">
              <span className="font-semibold">{vote.venue}</span> {vote.pair}: opening {vote.opening ?? "none"}, close{" "}
              {vote.close ?? "none"} → {vote.vote === "U" || vote.vote === "D" ? sideWord(vote.vote) : vote.vote}
            </li>
          ))}
        </ul>
      ) : null}
      {resolution.chain ? (
        <p className="tabular-nums">
          Block {resolution.chain.blockHeight} from {resolution.chain.server}, {resolution.chain.confirmations}{" "}
          confirmations at tip {resolution.chain.tip}; block time{" "}
          {formatDateTime(resolution.chain.blockTime * MS_PER_SECOND)}.
        </p>
      ) : null}
      {resolution.responses.map((response) => (
        <details key={`${response.source}-${response.url}`} className="rounded-row bg-raised-2 px-3 py-2">
          <summary className="cursor-pointer rounded-xs outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {response.source} · HTTP {response.status} · fetched {formatDateTime(response.fetchedAt)}
          </summary>
          <p className="mt-2 break-all text-meta text-muted-foreground">{response.url}</p>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-meta text-foreground">
            {response.body}
          </pre>
        </details>
      ))}
    </div>
  );
}
