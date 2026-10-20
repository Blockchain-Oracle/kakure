"use client";

import { cadenceLabel, parseWindowId, type WindowState } from "@kakure/domain";
import { OPERATOR_PUBLIC_KEYS } from "@kakure/query";
import { Mark, RollingNumber, Skeleton } from "@kakure/ui-web";
import { BadgeCheck } from "lucide-react";
import Link from "next/link";
import { useRealtime } from "@/features/data/use-realtime";
import { assetFor } from "@/features/markets/assets";
import { LENGTHS, liveCount } from "@/features/markets/live-lanes";
import { formatClock, useNow } from "@/lib/time";
import { WORDS } from "./words";

/**
 * "Every minute is signed." (Mitoshi's proof section): three rolling counts and the Windows that just settled, all read
 * from the signed bundle this browser just verified against the operator key built into the site. The bundle keeps
 * every Window settled in the last 10 minutes with each venue's closing print, so each row here can be recomputed.
 */
const MS = 1000;
const LATEST = 5;
const KEY_HEAD = 8;
const KEY_TAIL = 6;
const OUTCOME = { U: WORDS.proof.won.up, D: WORDS.proof.won.down, refund: WORDS.proof.won.void } as const;
const TONE = { U: "text-up", D: "text-down", refund: "text-muted-foreground" } as const;

type Settled = WindowState & { outcome: NonNullable<WindowState["outcome"]> };

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
  const data = useRealtime();
  const nowSec = Math.floor(useNow() / MS);
  const { proof } = WORDS;
  if (data.status === "loading") return <Skeleton className="h-80 rounded-lg" />;
  if (data.status !== "ready") return null;
  const { bundle } = data;
  const settled = bundle.windows
    .filter((w): w is Settled => w.outcome !== undefined)
    .sort((a, b) => Date.parse(b.expiresAt) - Date.parse(a.expiresAt));
  const live = nowSec > 0 ? LENGTHS.reduce((n, sec) => n + liveCount(sec, bundle, nowSec), 0) : 0;
  const key = OPERATOR_PUBLIC_KEYS[data.network];
  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-3 gap-4">
        <Figure label={proof.figures.bundle} value={bundle.seq} />
        <Figure label={proof.figures.live} value={live} />
        <Figure label={proof.figures.settled} value={settled.length} />
      </dl>
      {key ? (
        <p className="flex items-center gap-2 font-mono text-[12px] text-muted-foreground">
          <BadgeCheck aria-hidden className="size-4 text-up" />
          bundle {bundle.seq} verified here · key {key.slice(0, KEY_HEAD)}…{key.slice(-KEY_TAIL)}
        </p>
      ) : null}
      <div className="lp-card px-5 py-2">
        <p className="pt-3 pb-1 text-label text-muted-foreground">{proof.settled}</p>
        {settled.length === 0 ? (
          <p className="py-4 text-row-detail text-muted-foreground">{proof.none}</p>
        ) : (
          <ul>
            {settled.slice(0, LATEST).map((window) => (
              <SettledRow key={window.id} window={window} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SettledRow({ window }: { window: Settled }) {
  const parsed = parseWindowId(window.id);
  if (!parsed) return null;
  const { asset, cadenceSec } = parsed.lane;
  const info = assetFor({ kind: "close", subject: asset });
  return (
    <li className="lp-settled last:border-b-0">
      <Mark mark={info.mark} label={asset} size="inline" />
      <span className="text-row-detail">
        <span className="font-semibold text-foreground">{asset}</span>{" "}
        <span className="text-muted-foreground">
          {cadenceLabel(cadenceSec)} · closed {formatClock(window.expiresAt)}
        </span>
      </span>
      <span className={`font-mono text-[12px] font-semibold ${TONE[window.outcome]}`}>{OUTCOME[window.outcome]}</span>
    </li>
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
