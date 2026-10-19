"use client";

import {
  type BundleV2,
  cadenceLabel,
  type LaneInfo,
  type LatestV2,
  type Network,
  outcomeOf,
  type Prints,
  parseWindowId,
  referenceOf,
  type VenueKey,
  vote,
  type WindowState,
} from "@kakure/domain";
import { OPERATOR_PUBLIC_KEYS, printsQuery } from "@kakure/query";
import { Button, EmptyState, Mark, Skeleton } from "@kakure/ui-web";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, FileJson, XCircle } from "lucide-react";
import { type ReactNode, useState } from "react";
import { DATA_SOURCE, NETWORK_LABEL } from "@/constants";
import { DataErrorState } from "@/features/data/data-states";
import { useRealtime } from "@/features/data/use-realtime";
import { formatClock, formatDateTime } from "@/lib/time";

/**
 * Proof (plan §00): what this browser checked itself. Every minute's bundle is signed by the operator key built into
 * this site and chains to the one before; the pricing inputs are published, so anyone can recompute a quote; and every
 * settlement is recomputed here from each venue's signed prints (`@kakure/domain` settle.ts, the operator's own rule).
 * The hourly prints files load all at once, never one hour at a time (O22).
 */
const VENUE_LABEL: Readonly<Record<VenueKey, string>> = {
  coinbase: "Coinbase",
  kraken: "Kraken",
  bitstamp: "Bitstamp",
  gemini: "Gemini",
};
const OUTCOME_LABEL: Readonly<Record<string, string>> = { U: "UP won", D: "DOWN won", refund: "Refunded" };
const VOTE_ARROW: Readonly<Record<string, string>> = { U: "▲", D: "▼", flat: "=" };
const KEY_HEAD = 10;
const KEY_TAIL = 8;
const SETTLED_SHOWN = 24;
const PERCENT = 100;

export function RealtimeProof() {
  const data = useRealtime();
  return (
    <div className="mx-auto flex w-full max-w-(--layout-content-max) flex-col gap-5">
      <h1 className="font-display text-page-title text-foreground">Proof</h1>
      {data.status === "loading" ? (
        <Skeleton className="h-64 rounded-group" />
      ) : data.status === "error" ? (
        <DataErrorState error={data.error} network={data.network} onRetry={data.refetch} />
      ) : data.status === "unpublished" ? (
        <EmptyState
          icon={<FileJson />}
          title="Nothing published yet"
          reason={`No signed bundle exists on ${NETWORK_LABEL[data.network]} yet.`}
        />
      ) : (
        <>
          <Signed latest={data.latest} bundle={data.bundle} network={data.network} />
          <PricingInputs bundle={data.bundle} />
          <Settled bundle={data.bundle} />
          <Hourly bundle={data.bundle} network={data.network} />
        </>
      )}
    </div>
  );
}

function Card({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-group border border-border bg-card p-5">
      <h2 id={id} className="font-display text-title text-foreground">
        {title}
      </h2>
      {children}
    </section>
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

function FileLink({ network, file }: { network: Network; file: string }) {
  return (
    <a
      href={`${DATA_SOURCE.base}/${network}/${file}`}
      className="font-semibold text-link underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {file}
    </a>
  );
}

function Signed({ latest, bundle, network }: { latest: LatestV2; bundle: BundleV2; network: Network }) {
  const key = (DATA_SOURCE.keys ?? OPERATOR_PUBLIC_KEYS)[network] ?? "";
  return (
    <Card id="signed-title" title={`Signed every minute · bundle ${bundle.seq}`}>
      <ul className="flex flex-col gap-2">
        <Ok ok>
          <FileLink network={network} file="latest.json" /> names <FileLink network={network} file={latest.bundle} />
          {"; "}
          both signatures check against the key built into this site (
          <span className="font-mono text-num-sm">
            {key.slice(0, KEY_HEAD)}…{key.slice(-KEY_TAIL)}
          </span>
          ), and the bundle's SHA-256 matches.
        </Ok>
        <Ok ok>
          Published {formatDateTime(bundle.publishedAt)}, after the bundle with hash{" "}
          <span className="break-all font-mono text-num-sm">{bundle.previous ?? "none (the first)"}</span>.
        </Ok>
        <Ok ok>
          {bundle.lanes.length} lanes on {new Set(bundle.lanes.map((l) => l.asset)).size} assets, Windows of{" "}
          {[...new Set(bundle.lanes.map((l) => cadenceLabel(l.cadenceSec)))].join(", ")}.
        </Ok>
      </ul>
    </Card>
  );
}

function PricingInputs({ bundle }: { bundle: BundleV2 }) {
  const { pricing } = bundle;
  return (
    <Card id="pricing-title" title="Pricing inputs">
      <p className="text-row-detail text-muted-foreground">
        Every quote is P(Up) = Φ(ln(price ÷ opening) ÷ (σ√time left)), plus or minus a spread of {pricing.halfSpread},
        between {pricing.minAsk} and {pricing.maxAsk}. Entry closes {pricing.entryBufferSec} s before a Window ends. σ
        as of {formatClock(pricing.sigmaAt)}:
      </p>
      <dl className="grid grid-cols-3 gap-3 md:grid-cols-6">
        {Object.entries(pricing.sigma).map(([asset, sigma]) => (
          <div key={asset} className="rounded-row bg-background px-3 py-2">
            <dt className="text-meta text-muted-foreground">{asset}</dt>
            <dd className="font-mono text-num-md text-foreground">{Math.round(Number(sigma) * PERCENT)}%</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** Recomputes one settled Window from its own prints; `null` when its lane isn't listed. */
function recompute(window: WindowState, lanes: ReadonlyMap<string, LaneInfo>) {
  const parsed = parseWindowId(window.id);
  const lane = parsed ? lanes.get(parsed.lane.id) : undefined;
  if (!lane) return null;
  const reference = referenceOf(lane.venues, window.opening ?? {});
  const outcome = reference === null ? "refund" : outcomeOf(lane.venues, window.opening ?? {}, window.closing ?? {});
  return { lane, ok: outcome === window.outcome && (reference ?? undefined) === window.reference };
}

function Settled({ bundle }: { bundle: BundleV2 }) {
  const lanes = new Map(bundle.lanes.map((lane) => [lane.id, lane]));
  const settled = bundle.windows
    .filter((w) => w.outcome)
    .sort((a, b) => Date.parse(b.settledAt ?? "") - Date.parse(a.settledAt ?? ""))
    .slice(0, SETTLED_SHOWN);
  return (
    <Card id="settled-title" title="Just settled, recomputed here">
      {settled.length === 0 ? (
        <p className="text-row-detail text-muted-foreground">The first Windows settle about a minute after they end.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {settled.map((window) => {
            const check = recompute(window, lanes);
            if (!check) return null;
            return (
              <li key={window.id} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Mark mark={`mark-${check.lane.asset.toLowerCase()}`} label={check.lane.asset} size="inline" />
                  <span className="text-row-strong text-foreground">
                    {check.lane.asset} · {cadenceLabel(check.lane.cadenceSec)}
                  </span>
                  <span className="font-mono text-num-sm text-muted-foreground">
                    {formatClock(window.startsAt)}–{formatClock(window.expiresAt)}
                  </span>
                  <span
                    className={`ml-auto font-mono text-num-sm font-semibold ${window.outcome === "U" ? "text-up" : window.outcome === "D" ? "text-down" : "text-muted-foreground"}`}
                  >
                    {OUTCOME_LABEL[window.outcome ?? "refund"]}
                  </span>
                  {check.ok ? (
                    <CheckCircle2 aria-label="Recomputed: matches" className="size-4 text-up" />
                  ) : (
                    <XCircle aria-label="Recomputed: does not match" className="size-4 text-down" />
                  )}
                </div>
                <div className="grid grid-cols-1 gap-1 font-mono text-num-sm text-muted-foreground sm:grid-cols-3">
                  {check.lane.venues.map((venue) => {
                    const open = window.opening?.[venue] ?? null;
                    const close = window.closing?.[venue] ?? null;
                    const v = vote(open, close);
                    return (
                      <span key={venue}>
                        {VENUE_LABEL[venue]} {open ?? "—"} → {close ?? "—"} {v ? VOTE_ARROW[v] : "no vote"}
                      </span>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function Hourly({ bundle, network }: { bundle: BundleV2; network: Network }) {
  const [wanted, setWanted] = useState(false);
  const prints = useQuery({ ...printsQuery(DATA_SOURCE, network, bundle), enabled: wanted });
  const lanes = new Map(bundle.lanes.map((lane) => [lane.id, lane]));
  const results = (prints.data ?? []).map((file: Prints) => {
    const checks = file.windows.map((w) => recompute(w, lanes));
    return {
      hour: file.hour,
      windows: file.windows.length,
      failed: checks.filter((c) => c && !c.ok).length,
    };
  });
  const total = results.reduce((sum, r) => sum + r.windows, 0);
  const failed = results.reduce((sum, r) => sum + r.failed, 0);
  return (
    <Card id="hourly-title" title="The last 24 hours">
      <p className="text-row-detail text-muted-foreground">
        Each finished hour gets a signed file with every venue's 1-minute closes and every Window settled in it.{" "}
        {bundle.prints.length} {bundle.prints.length === 1 ? "file" : "files"} so far.
      </p>
      {!wanted ? (
        <Button
          variant="secondary"
          size="sm"
          className="w-fit"
          onClick={() => setWanted(true)}
          disabled={bundle.prints.length === 0}
        >
          Recompute every settlement
        </Button>
      ) : prints.isFetching ? (
        <Skeleton className="h-16 rounded-row" />
      ) : prints.error ? (
        <p className="text-row-detail text-down">The prints files didn't load. Try again in a moment.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            <Ok ok={failed === 0}>
              {total} settlements recomputed from signed prints;{" "}
              {failed === 0 ? "every one matches" : `${failed} differ`}.
            </Ok>
          </ul>
          <ul className="flex flex-col gap-1 font-mono text-num-sm text-muted-foreground">
            {results.map((r, i) => (
              <li key={r.hour}>
                <FileLink network={network} file={bundle.prints[i] ?? ""} /> · {r.windows} Windows
                {r.failed > 0 ? ` · ${r.failed} differ` : " · all match"}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
