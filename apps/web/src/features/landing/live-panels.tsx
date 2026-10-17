"use client";

import { type Market, RULES_HASH_PERSONAL, toHex, utf8 } from "@kakure/domain";
import { nextBatchAt, OPERATOR_PUBLIC_KEYS } from "@kakure/query";
import { canonicalJson } from "@kakure/signing";
import { buttonClass, Skeleton } from "@kakure/ui-web";
import { blake2b } from "@noble/hashes/blake2.js";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { NETWORK_LABEL } from "@/constants";
import { useMarkets } from "@/features/data/use-markets";
import { formatClock, formatCountdown, useNow } from "@/lib/time";
import { featuredMarket } from "./hero-market";

/** Live panels for the lifecycle and proof sections, read from the same signed batch every visitor loads. */
const RULES_HASH_BYTES = 32;
const KEY_HEAD = 8;
const KEY_TAIL = 8;

export function LifecycleNow() {
  const data = useMarkets();
  const now = useNow();
  if (data.status === "loading") return <Skeleton className="h-56 rounded-group" />;
  if (data.status !== "ready") {
    return (
      <div className="rounded-group bg-card p-5 text-row-detail text-muted-foreground">
        No signed batch on {NETWORK_LABEL[data.network]} to read right now.
      </div>
    );
  }
  const { bundle } = data;
  const sealed = bundle.markets.filter((market) => market.sealed).length;
  const tickets = bundle.markets.reduce((sum, market) => sum + market.ticketCount, 0);
  const next = nextBatchAt(bundle);
  return (
    <aside className="flex flex-col gap-4 rounded-group bg-card p-5" aria-label="Right now">
      <span className="text-label text-muted-foreground">Right now on {NETWORK_LABEL[data.network]}</span>
      <dl className="grid grid-cols-2 gap-4">
        <Figure label="Markets sealed" value={`${sealed} of ${bundle.markets.length}`} />
        <Figure label="Tickets counted" value={String(tickets)} />
        <Figure label="Latest batch" value={`${bundle.seq} · ${formatClock(bundle.publishedAt)}`} />
        <Figure
          label="Next batch"
          value={now > 0 && next > now ? `in ${formatCountdown(next - now)}` : formatClock(next)}
        />
      </dl>
      <p className="text-meta text-muted-foreground">
        Read from the signed batch this page loaded; nothing here is estimated.
      </p>
    </aside>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-meta text-muted-foreground">{label}</dt>
      <dd className="font-display text-position-pnl text-foreground tabular-nums">{value}</dd>
    </div>
  );
}

function rulesHashMatches(market: Market): boolean {
  const digest = blake2b(utf8.encode(canonicalJson(market.rules)), {
    dkLen: RULES_HASH_BYTES,
    personalization: utf8.encode(RULES_HASH_PERSONAL),
  });
  return toHex(digest) === market.rulesHash;
}

export function ProofNow() {
  const data = useMarkets();
  const now = useNow();
  if (data.status === "loading") return <Skeleton className="h-72 rounded-group" />;
  if (data.status !== "ready") return null;
  const market = featuredMarket(data.bundle.markets, now) ?? data.bundle.markets[0];
  const key = OPERATOR_PUBLIC_KEYS[data.network];
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {market ? (
        <article className="flex flex-col gap-3 rounded-group bg-card p-5" aria-label="Rules of a live market">
          <span className="text-label text-muted-foreground">The rules, fixed before betting opened</span>
          <p className="text-row-strong text-foreground">{market.rules.question}</p>
          <p className="text-row-detail text-muted-foreground">{market.rules.resolution}</p>
          <p className="text-row-detail text-muted-foreground">{market.rules.payoutFormula}</p>
        </article>
      ) : null}
      <article className="flex flex-col gap-3 rounded-group bg-card p-5" aria-label="Checked on this page">
        <span className="text-label text-muted-foreground">Checked on this page, just now</span>
        <ul className="flex flex-col gap-2 text-row-detail text-foreground">
          <Check>
            Batch {data.bundle.seq} is signed by the {NETWORK_LABEL[data.network]} operator key
            {key ? ` ${key.slice(0, KEY_HEAD)}…${key.slice(-KEY_TAIL)}` : ""}, built into this site.
          </Check>
          <Check>Its bytes hash to the value the signed pointer names.</Check>
          {market && rulesHashMatches(market) ? (
            <Check>This market's rules hash, recomputed here, matches the signed one.</Check>
          ) : null}
        </ul>
        <p className="text-row-detail text-muted-foreground">
          One operator holds the pool and pays on a timer. It can't see who you are, but you trust it to pay, and every
          file it publishes is signed so you can check it.
        </p>
        <div className="mt-auto flex flex-wrap gap-2">
          <Link href="/proof" className={buttonClass("secondary", "sm")}>
            See every signed file
          </Link>
          <Link href="/verify" className={buttonClass("quiet", "sm")}>
            Verify a ticket
          </Link>
        </div>
      </article>
    </div>
  );
}

function Check({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-up" />
      <span>{children}</span>
    </li>
  );
}
