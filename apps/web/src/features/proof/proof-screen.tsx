"use client";

import { type Bundle, type Market, RULES_HASH_PERSONAL, toHex, utf8 } from "@kakure/domain";
import { canonicalJson } from "@kakure/signing";
import { EmptyState, Pill, Skeleton } from "@kakure/ui-web";
import { blake2b } from "@noble/hashes/blake2.js";
import { CheckCircle2, FileJson, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { DATA_SOURCE, NETWORK_LABEL } from "@/constants";
import { DataErrorState } from "@/features/data/data-states";
import { useMarkets } from "@/features/data/use-markets";
import { assetFor } from "@/features/markets/assets";
import { sideWord, WINDOW_LABEL } from "@/features/markets/market-view";
import { formatDateTime } from "@/lib/time";

/**
 * Proof (C5–C7, surfaces.md): the signed files behind every market, and what this device re-checks itself:
 * the signature chain (latest → bundle → address list), each market's rules hash recomputed from its published
 * rules (D13), and its ticket count against its list. Payout runs are coarse by design, never txids (PD7).
 */
const RULES_HASH_BYTES = 32;

function rulesHashOf(market: Market): string {
  return toHex(
    blake2b(utf8.encode(canonicalJson(market.rules)), {
      dkLen: RULES_HASH_BYTES,
      personalization: utf8.encode(RULES_HASH_PERSONAL),
    }),
  );
}

export function ProofScreen() {
  const data = useMarkets();
  return (
    <div className="mx-auto flex w-full max-w-(--layout-content-max) flex-col gap-5 px-5 py-6 rail:px-8 rail:py-8">
      <h1 className="font-display text-page-title text-foreground">Proof</h1>
      {data.status === "loading" ? (
        <Skeleton className="h-64 rounded-group" />
      ) : data.status === "error" ? (
        <DataErrorState error={data.error} network={data.network} onRetry={data.refetch} />
      ) : data.status === "unpublished" ? (
        <EmptyState
          icon={<FileJson />}
          title="Nothing published yet"
          reason={`No signed batch exists on ${NETWORK_LABEL[data.network]} yet.`}
        />
      ) : (
        <>
          <Files bundle={data.bundle} latestFile="latest.json" network={data.network} />
          <ul className="flex flex-col gap-3">
            {data.bundle.markets.map((market) => (
              <MarketProof key={market.id} market={market} network={data.network} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Ok({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="flex gap-2 text-row-detail text-foreground">
      {ok ? (
        <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-up" />
      ) : (
        <XCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-down" />
      )}
      <span>
        <span className="sr-only">{ok ? "Passed: " : "Failed: "}</span>
        {children}
      </span>
    </li>
  );
}

function FileLink({ network, file }: { network: string; file: string }) {
  return (
    <a
      href={`${DATA_SOURCE.base}/${network}/${file}`}
      className="font-semibold text-link underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {file}
    </a>
  );
}

function Files({ bundle, latestFile, network }: { bundle: Bundle; latestFile: string; network: string }) {
  return (
    <section className="flex flex-col gap-3 rounded-group bg-card p-5" aria-labelledby="files-title">
      <h2 id="files-title" className="text-title text-foreground">
        Signed files, batch {bundle.seq}
      </h2>
      <ul className="flex flex-col gap-2">
        <Ok ok>
          <FileLink network={network} file={latestFile} /> names{" "}
          <FileLink network={network} file={`bundle-${bundle.seq}.json`} />; both signatures check against the pinned
          key, and the bundle's SHA-256 matches.
        </Ok>
        <Ok ok>
          <FileLink network={network} file={bundle.addresses} /> is signed, and its name carries the start of its
          SHA-256.
        </Ok>
        <Ok ok>
          Published {formatDateTime(bundle.publishedAt)}; it follows the previous batch with hash{" "}
          <span className="break-all tabular-nums">{bundle.previous ?? "none (the first batch)"}</span>.
        </Ok>
      </ul>
      <div className="text-row-detail text-muted-foreground">
        {bundle.payoutRuns.length === 0
          ? "No payout runs yet. Runs are published coarsely after their window closes, never with transaction ids."
          : bundle.payoutRuns.map((run) => (
              <p key={run.resolvedBefore}>
                Markets resolved before {formatDateTime(run.resolvedBefore)}: all payouts sent by{" "}
                {formatDateTime(run.allSentBy)}.
              </p>
            ))}
      </div>
    </section>
  );
}

function MarketProof({ market, network }: { market: Market; network: string }) {
  const asset = assetFor(market);
  const rulesOk = rulesHashOf(market) === market.rulesHash;
  const countOk = market.leaves.length === market.ticketCount;
  const opening = market.opening ? Object.entries(market.opening) : [];
  return (
    <li className="flex flex-col gap-3 rounded-group bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-row-strong text-foreground">
          {asset.symbol} · {WINDOW_LABEL[market.window]}{" "}
          <span className="text-meta text-muted-foreground">{market.id}</span>
        </span>
        <Pill tone={market.outcome ? "neutral" : "quiet"}>
          {market.outcome
            ? market.outcome === "refund"
              ? "Refunded"
              : `Resolved ${sideWord(market.outcome)}`
            : market.state}
        </Pill>
      </div>
      <ul className="flex flex-col gap-2">
        <Ok ok={rulesOk}>
          {rulesOk
            ? "Its rules hash, recomputed here from the published rules, matches the signed one."
            : "Its rules don't hash to the signed rules hash."}
        </Ok>
        <Ok ok={countOk}>
          {market.ticketCount} tickets, {market.leaves.length} hashes in its signed list
          {market.sealed ? "; odds sealed" : market.released ? `; odds released in batch ${market.released.seq}` : ""}.
        </Ok>
      </ul>
      <dl className="grid grid-cols-1 gap-2 text-row-detail md:grid-cols-2">
        <div>
          <dt className="text-label text-muted-foreground">Opening reference</dt>
          <dd className="text-foreground">
            {opening.length > 0
              ? opening.map(([venue, value]) => `${venue} ${value}`).join(" · ")
              : "Recorded when betting opens"}
          </dd>
        </div>
        <div>
          <dt className="text-label text-muted-foreground">Cutoff block</dt>
          <dd className="text-foreground tabular-nums">
            {market.cutoffHeight ?? "Set once the cutoff block is final"}
          </dd>
        </div>
        <div>
          <dt className="text-label text-muted-foreground">Resolution evidence</dt>
          <dd className="text-foreground">
            {market.resolution ? <FileLink network={network} file={market.resolution} /> : "Published when it resolves"}
          </dd>
        </div>
        <div>
          <dt className="text-label text-muted-foreground">Rules hash</dt>
          <dd className="break-all text-foreground tabular-nums">{market.rulesHash}</dd>
        </div>
      </dl>
    </li>
  );
}
