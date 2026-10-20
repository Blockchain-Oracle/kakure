"use client";

import { usePrice } from "@kakure/feeds";
import { Button, cx } from "@kakure/ui-web";
import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { DATA_SOURCE, NETWORK_LABEL, PRICE_RELAY } from "@/constants";
import { useRealtime } from "@/features/data/use-realtime";
import { LENGTHS, liveCount } from "@/features/markets/live-lanes";
import { HEALTH_WORD, useRelayHealth } from "@/features/shell/health-chip";
import { LANE_SYMBOLS } from "@/features/terminal/use-window";
import { formatAge, formatClock, useNow } from "@/lib/time";

const MS = 1000;
const KEYSET_HEAD = 12;
const PRICE_WORD = { live: "Live", stale: "Stale", connecting: "Waiting", closed: "Closed" } as const;

function Tone({ tone, children }: { tone: "good" | "warn" | "muted"; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-row-strong text-foreground">
      <span
        aria-hidden
        className={cx(
          "size-2.5 rounded-full",
          tone === "good" ? "kk-ping bg-vermilion text-vermilion" : tone === "warn" ? "bg-warn-dot" : "bg-ink-muted",
        )}
      />
      {children}
    </span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5">
      <span className="text-row-detail text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

function SymbolRow({ symbol, now }: { symbol: (typeof LANE_SYMBOLS)[number]; now: number }) {
  const price = usePrice(symbol);
  return (
    <Row label={symbol.replace("-USD", "")}>
      <span className="numbers text-row-change text-foreground">
        {PRICE_WORD[price.status]}
        {price.ts && now > 0 ? ` · ${formatAge(now - price.ts)} ago` : ""}
      </span>
    </Row>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="px-1 text-label text-muted-foreground">{title}</h2>
      <div className="flex flex-col divide-y divide-border rounded-group border border-border bg-card">{children}</div>
    </section>
  );
}

/**
 * Status: what the health chip summarises, read live from this page: the price relay's connection and each lane
 * symbol's last tick; the signed data for this network (the latest verified minute bundle and when this device
 * checked); and trading as that bundle states it (Windows trading now, deposits, the mint's keyset). Nothing here is
 * reported by a server about itself; it is what this browser sees.
 */
export function StatusScreen() {
  const health = useRelayHealth();
  const data = useRealtime();
  const now = useNow();
  const relayHost = new URL(PRICE_RELAY).host;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-page-title text-foreground">Status</h1>
        <p className="text-body text-muted-foreground">
          What this browser sees right now, on {NETWORK_LABEL[data.network]}.
        </p>
      </header>

      <Panel title="Price relay">
        <Row label="Connection">
          <Tone tone={health === "live" ? "good" : health === "reconnecting" ? "warn" : "muted"}>
            {HEALTH_WORD[health]}
          </Tone>
        </Row>
        <Row label="Host">
          <span className="numbers text-row-change text-foreground">{relayHost}</span>
        </Row>
        {LANE_SYMBOLS.map((symbol) => (
          <SymbolRow key={symbol} symbol={symbol} now={now} />
        ))}
      </Panel>

      <Panel title="Signed data">
        <Row label="Host">
          <span className="numbers text-row-change text-foreground">{DATA_SOURCE.base}</span>
        </Row>
        {data.status === "ready" ? (
          <>
            <Row label="Latest bundle">
              <Tone tone={data.refreshError ? "warn" : "good"}>
                <span className="numbers">
                  {data.bundle.seq} · {formatClock(data.latest.publishedAt)}
                </span>
              </Tone>
            </Row>
            <Row label="Signature">
              <span className="text-row-strong text-foreground">Verified against the pinned operator key</span>
            </Row>
            <Row label="Checked">
              <span className="numbers text-row-change text-foreground">
                {now > 0 ? `${formatAge(now - data.checkedAt)} ago` : formatClock(data.checkedAt)}
              </span>
            </Row>
          </>
        ) : (
          <Row label="Latest bundle">
            <Tone tone={data.status === "loading" ? "muted" : "warn"}>
              {data.status === "loading"
                ? "Loading"
                : data.status === "unpublished"
                  ? "Nothing published yet"
                  : "Can't verify the latest bundle"}
            </Tone>
          </Row>
        )}
      </Panel>

      {data.status === "ready" ? (
        <Panel title="Trading">
          <Row label="Windows trading now">
            <span className="numbers text-row-change text-foreground">
              {LENGTHS.reduce((n, sec) => n + liveCount(sec, data.bundle, Math.floor(now / MS)), 0)}
            </span>
          </Row>
          <Row label="Mint">
            <Tone tone={data.bundle.trading ? "good" : "muted"}>
              {data.bundle.trading ? "Open" : "Not published on this network"}
            </Tone>
          </Row>
          {data.bundle.trading ? (
            <>
              <Row label="Deposits">
                <span className="text-row-strong text-foreground">
                  {data.bundle.trading.depositAddress ? "Open" : "Paused"}
                </span>
              </Row>
              <Row label="Chip keyset">
                <span className="numbers text-row-change text-foreground">
                  {data.bundle.trading.keyset.id.slice(0, KEYSET_HEAD)}…
                </span>
              </Row>
            </>
          ) : null}
        </Panel>
      ) : null}

      {data.status !== "loading" ? (
        <div>
          <Button variant="secondary" size="sm" onClick={data.refetch}>
            <RefreshCw aria-hidden className="size-4" /> Check again
          </Button>
        </div>
      ) : null}
    </div>
  );
}
