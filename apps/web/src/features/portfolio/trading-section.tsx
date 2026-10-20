"use client";

import type { Network } from "@kakure/domain";
import { Tabs } from "@kakure/ui-web";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { NETWORK_COIN } from "@/constants";
import { useRealtime } from "@/features/data/use-realtime";
import { tradeHref } from "@/features/markets/live-lanes";
import { zatToNumber } from "@/features/terminal/format";
import { type LivePosition, totalsOf, valuePositions } from "@/features/terminal/positions";
import { episodeFor, replayable, useEpisodes } from "@/features/terminal/replay";
import { ShareSheet } from "@/features/terminal/share/share-sheet";
import { ReplaySheet } from "@/features/terminal/sheets/replay-sheet";
import { HistoryList, type HistoryRow, historyOf } from "@/features/terminal/sheets/wallet-sheet";
import { TradeToasts } from "@/features/terminal/toasts";
import { PositionsList, UnrealizedCard } from "@/features/terminal/ui/positions-panel";
import { useUpkeep } from "@/features/terminal/use-upkeep";
import { LANE_SYMBOLS, useCommittedSpots } from "@/features/terminal/use-window";
import { useWallet } from "@/features/wallet/wallet-store";
import { useNow } from "@/lib/time";
import "@/features/terminal/terminal.css";

/**
 * Trading on the portfolio (plan §00 Portfolio: positions and history, device-local): the open positions valued live
 * at the house's bid with the terminal's own rows (Add, Reduce and TP/SL open the terminal on that Window), and every
 * close and settlement this device made, with share. The same upkeep runs here as in the terminal, so a fired exit or
 * a settled Window pays out as chips whichever page is open.
 */
type Tab = "open" | "history";
const MS = 1000;

export function TradingSection({ network }: { network: Network }) {
  const data = useRealtime();
  const bundle = data.status === "ready" ? data.bundle : null;
  const wallet = useWallet(network);
  const nowSec = Math.floor(useNow() / MS);
  const spots = useCommittedSpots(LANE_SYMBOLS);
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("open");
  const [share, setShare] = useState<HistoryRow | null>(null);
  const [replay, setReplay] = useState<HistoryRow | null>(null);
  const episodes = useEpisodes(network);
  const replayOf = (row: HistoryRow) => {
    const e = episodeFor(episodes, row.id);
    return e && replayable(e) ? e : null;
  };
  const coin = NETWORK_COIN[network];
  useUpkeep(network, bundle?.trading ?? null, wallet.positions, wallet.status === "ready");

  const positions = useMemo(
    () => valuePositions(wallet.positions, bundle, (s) => spots.get(s) ?? null, nowSec),
    [wallet.positions, bundle, spots, nowSec],
  );
  const history = useMemo(() => historyOf(wallet.positions), [wallet.positions]);
  const references = useMemo(
    () => new Map((bundle?.windows ?? []).flatMap((w) => (w.reference ? [[w.id, w.reference] as const] : []))),
    [bundle],
  );
  const manage = (p: LivePosition) =>
    router.push(p.asset && p.cadenceSec ? tradeHref(p.asset, p.cadenceSec) : "/trade");
  if (wallet.status !== "ready" || (positions.length === 0 && history.length === 0)) return null;

  return (
    <section aria-labelledby="trading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="trading" className="font-display text-title text-foreground">
          Trading
        </h2>
        <Tabs
          label="Trading"
          value={tab}
          onChange={setTab}
          items={[
            { value: "open", label: "Open", count: positions.length },
            { value: "history", label: "History", count: history.length },
          ]}
        />
      </div>
      {tab === "open" ? (
        <div className="kk-terminal flex flex-col gap-3">
          <UnrealizedCard
            totals={totalsOf(positions)}
            coin={coin}
            closable={0}
            onCloseAll={() => undefined}
            closingAll={false}
          />
          <PositionsList
            positions={positions}
            nowSec={nowSec}
            coin={coin}
            references={references}
            actions={{ onAdd: manage, onReduce: manage, onExits: manage }}
          />
        </div>
      ) : (
        <HistoryList
          rows={history}
          coin={coin}
          onShare={setShare}
          onReplay={setReplay}
          canReplay={(row) => replayOf(row) !== null}
        />
      )}
      <ShareSheet open={share !== null} onClose={() => setShare(null)} row={share} />
      <ReplaySheet
        open={replay !== null}
        onClose={() => setReplay(null)}
        episode={replay ? replayOf(replay) : null}
        finalPnl={replay ? zatToNumber(replay.pnlZat) : null}
        coin={coin}
        onShare={() => {
          setShare(replay);
          setReplay(null);
        }}
      />
      <TradeToasts />
    </section>
  );
}
