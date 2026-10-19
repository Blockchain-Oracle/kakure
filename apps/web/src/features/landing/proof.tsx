"use client";

import type { Market } from "@kakure/domain";
import { OPERATOR_PUBLIC_KEYS } from "@kakure/query";
import { Mark, RollingNumber, Skeleton } from "@kakure/ui-web";
import { BadgeCheck } from "lucide-react";
import Link from "next/link";
import { useMarkets } from "@/features/data/use-markets";
import { assetFor } from "@/features/markets/assets";
import { WINDOW_LABEL } from "@/features/markets/market-view";
import { formatClock, useNow } from "@/lib/time";
import { WORDS } from "./words";

/**
 * "Every close is signed." (Mitoshi's proof section): three rolling counts and the latest closes, all read from the
 * signed batch this browser just verified against the operator key built into the site.
 */
const HOUR_MS = 3_600_000;
const SETTLED_HOURS = 12;
const SETTLED_WINDOW_MS = SETTLED_HOURS * HOUR_MS;
const LATEST = 5;
const KEY_HEAD = 8;
const KEY_TAIL = 6;
const DONE = new Set<Market["state"]>(["resolved", "paid"]);
const LIVE = new Set<Market["state"]>(["scheduled", "open", "closing"]);
const OUTCOME: Record<string, string> = {
  U: WORDS.proof.won.up,
  D: WORDS.proof.won.down,
  Y: WORDS.proof.won.yes,
  N: WORDS.proof.won.no,
  refund: WORDS.proof.won.void,
};

export function Proof() {
  const { proof } = WORDS;
  return (
    <section className="lp-section" aria-labelledby="lp-proof-title">
      <div className="lp-wrap grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div>
          <p className="lp-kicker">{proof.kicker}</p>
          <h2 id="lp-proof-title" className="lp-h2 lp-silver">
            <span>{proof.title}</span>
          </h2>
          <p className="lp-lead">{proof.body}</p>
          <Link href="/proof" className="lp-btn lp-btn--glass lp-btn--sm mt-6">
            {proof.proof}
          </Link>
        </div>
        <Live />
      </div>
    </section>
  );
}

function Live() {
  const data = useMarkets();
  const now = useNow();
  const { proof } = WORDS;
  if (data.status === "loading") return <Skeleton className="h-80 rounded-lg" />;
  if (data.status !== "ready") return null;
  const markets = data.bundle.markets;
  const done = markets
    .filter((m) => DONE.has(m.state) && m.outcome)
    .sort((a, b) => Date.parse(b.closesAt) - Date.parse(a.closesAt));
  const recent = now ? done.filter((m) => now - Date.parse(m.closesAt) < SETTLED_WINDOW_MS).length : done.length;
  const key = OPERATOR_PUBLIC_KEYS[data.network];
  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-3 gap-4">
        <Figure label={proof.figures.batch} value={data.bundle.seq} />
        <Figure label={proof.figures.live} value={markets.filter((m) => LIVE.has(m.state)).length} />
        <Figure label={proof.figures.settled} value={recent} />
      </dl>
      {key ? (
        <p className="flex items-center gap-2 font-mono text-[12px] text-muted-foreground">
          <BadgeCheck aria-hidden className="size-4 text-up" />
          batch {data.bundle.seq} verified here · key {key.slice(0, KEY_HEAD)}…{key.slice(-KEY_TAIL)}
        </p>
      ) : null}
      <div className="lp-card px-5 py-2">
        <p className="pt-3 pb-1 text-label text-muted-foreground">{proof.settled}</p>
        {done.length === 0 ? (
          <p className="py-4 text-row-detail text-muted-foreground">{proof.none}</p>
        ) : (
          <ul>
            {done.slice(0, LATEST).map((market) => {
              const asset = assetFor(market);
              const up = market.outcome === "U" || market.outcome === "Y";
              return (
                <li key={market.id} className="lp-settled last:border-b-0">
                  <Mark mark={asset.mark} label={asset.symbol} size="inline" />
                  <span className="text-row-detail">
                    <span className="font-semibold text-foreground">{asset.symbol}</span>{" "}
                    <span className="text-muted-foreground">
                      {WINDOW_LABEL[market.window]} · closed {formatClock(market.closesAt)}
                    </span>
                  </span>
                  <span
                    className={`font-mono text-[12px] font-semibold ${market.outcome === "refund" ? "text-muted-foreground" : up ? "text-up" : "text-down"}`}
                  >
                    {OUTCOME[market.outcome ?? "refund"]}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col-reverse gap-2">
      <dt className="text-meta text-muted-foreground">{label}</dt>
      <dd className="lp-figure">
        <RollingNumber value={String(value)} />
      </dd>
    </div>
  );
}
