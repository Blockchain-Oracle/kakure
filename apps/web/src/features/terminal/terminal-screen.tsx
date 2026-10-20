"use client";

import { CHIP_GRID_ZAT, cadenceLabel, LANE_ASSETS, type LaneAsset, withSlippage } from "@kakure/domain";
import type { StreamSymbol } from "@kakure/feeds/protocol";
import { Sheet } from "@kakure/ui-web";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { NETWORK_COIN } from "@/constants";
import { useRealtime } from "@/features/data/use-realtime";
import { useFragment } from "@/features/market/fragment";
import { assetFor } from "@/features/markets/assets";
import { buy, close as closePosition } from "@/features/wallet/trading";
import { useWallet } from "@/features/wallet/wallet-store";
import { useNow } from "@/lib/time";
import { type ChartHandle, LiveChart } from "./chart/live-chart";
import { BPS, DESKTOP_QUERY, PERCENT } from "./constants";
import { clockText, equityText, multipleOf, zecText } from "./format";
import { useTerminalParlay } from "./parlay/use-parlay";
import { type LivePosition, totalsOf, valuePositions } from "./positions";
import { useReplayRecorder } from "./replay";
import { stakeFor, useTradeSettings, useTradeSettingsState } from "./settings";
import { type SheetName, TerminalSheets } from "./terminal-sheets";
import { TradeToasts, toast } from "./toasts";
import { ChartControls } from "./ui/chart-controls";
import { AssetChip, EquityPill, SettingsStack, SheetRow, ViewPositionPill, WindowChip } from "./ui/chrome";
import { PositionsList, UnrealizedCard } from "./ui/positions-panel";
import { ReactionOverlay } from "./ui/reaction-overlay";
import { TradeButtons } from "./ui/trade-buttons";
import { useTradeFeedback } from "./use-feedback";
import { useChartOverlay } from "./use-overlay";
import { useTerminalTrade } from "./use-trade";
import { useUpkeep } from "./use-upkeep";
import { defaultCadence, LANE_SYMBOLS, lanesFor, pickWindow, useCommittedSpots, useQuote } from "./use-window";
import { whyNotTrading } from "./why";
import "./terminal.css";

/**
 * The terminal (`/trade#BTC`; Owarine `TerminalScreen.tsx`, Tradash's interaction model): the live chart is the
 * workspace; one tap buys at the house's live ask, PnL breathes on the price line, Trail rides the move at the mint,
 * one tap closes. Desktop: the chart with its floating chrome and a 20 rem rail. Phone: the chart full-bleed under a
 * header and a footer. Positions live only on this device; every call goes through the relay to the mint.
 */
const MS = 1000;
const DEFAULT_ASSET: LaneAsset = "BTC";

function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (l) => {
      const mq = window.matchMedia(DESKTOP_QUERY);
      mq.addEventListener("change", l);
      return () => mq.removeEventListener("change", l);
    },
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false,
  );
}

/** `#BTC` or `#BTC/5m`: the asset, and the Window length a link asked for (the fragment never reaches the host). */
function parseFragment(fragment: string | null): { asset: LaneAsset; length: string | null } {
  const [name = "", length = null] = (fragment ?? "").replace(/^#/, "").split("/");
  const upper = name.toUpperCase();
  const asset = (LANE_ASSETS as readonly string[]).includes(upper) ? (upper as LaneAsset) : DEFAULT_ASSET;
  return { asset, length };
}

export function TerminalScreen() {
  const fragment = useFragment();
  const { asset, length } = parseFragment(fragment);
  const info = assetFor({ kind: "close", subject: asset });
  const data = useRealtime();
  const network = data.network;
  const coin = NETWORK_COIN[network];
  const bundle = data.status === "ready" ? data.bundle : null;
  const trading = bundle?.trading ?? null;
  const wallet = useWallet(network);
  const settingsState = useTradeSettingsState();
  const settings = useTradeSettings();
  const desktop = useIsDesktop();
  const nowSec = Math.floor(useNow() / MS);
  const [cadence, setCadence] = useState<number | null>(null);
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const [target, setTarget] = useState<LivePosition | null>(null);
  const [closingAll, setClosingAll] = useState(false);
  const chartHandle = useRef<ChartHandle | null>(null);

  // First visit: the five-step tour, once settings have loaded.
  useEffect(() => {
    if (settingsState && !settingsState.tutorialSeen) setSheet("tutorial");
  }, [settingsState]);

  const symbol: StreamSymbol = `${asset}-USD`;
  // One committed snapshot of every lane price: positions on any asset re-value with it, and every second.
  const spots = useCommittedSpots(LANE_SYMBOLS);
  const spot = spots.get(symbol) ?? null;
  const positions = useMemo(
    () => valuePositions(wallet.positions, bundle, (s) => spots.get(s) ?? null, nowSec),
    [wallet.positions, bundle, spots, nowSec],
  );
  const held = useMemo(() => new Set(positions.flatMap((p) => (p.window ? [p.window.id] : []))), [positions]);
  const lanes = lanesFor(asset);
  // The first-visit length (the shortest trading now) is chosen once the bundle is in, then held: Owarine re-picks it
  // every second until a tap, which here would swap the Line under you each time a 1-minute Window stops trading.
  // The fragment's length (`#BTC/5m`) is the source of truth whenever it names one: a pick writes it there, so a
  // reload keeps it. Without one, a held pick, else the first-visit default, decided in this render (no effect race).
  const linked = lanes.find((l) => l.label === length)?.cadenceSec ?? null;
  const pickCadence = (sec: number) => {
    setCadence(sec);
    history.replaceState(null, "", `#${asset}/${cadenceLabel(sec)}`);
  };
  const picked = cadence !== null && lanes.some((l) => l.cadenceSec === cadence) ? cadence : null;
  const fallback =
    linked === null && picked === null && bundle && nowSec > 0 ? defaultCadence(asset, bundle, nowSec) : null;
  useEffect(() => {
    if (fallback !== null) setCadence(fallback);
  }, [fallback]);
  const cadenceSec = linked ?? picked ?? fallback;
  const screen = cadenceSec !== null && nowSec > 0 ? pickWindow(asset, cadenceSec, bundle, nowSec, held) : null;
  const sigmaText = bundle?.pricing.sigma[asset];
  const sigma = sigmaText ? Number(sigmaText) : null;
  const quote = useQuote(screen, spot, sigma, nowSec);
  const reference = screen?.state?.reference ? Number(screen.state.reference) : null;
  const references = useMemo(
    () => new Map((bundle?.windows ?? []).flatMap((w) => (w.reference ? [[w.id, w.reference] as const] : []))),
    [bundle],
  );

  const active =
    positions.find((p) => p.kind === "single" && p.window?.id === screen?.window.id && p.status !== "buying") ?? null;
  const totals = totalsOf(positions);
  const minStakeZat = Number(bundle?.pricing.caps.minStakeZat ?? CHIP_GRID_ZAT);
  const maxStakeZat = Number(bundle?.pricing.caps.maxStakeZat ?? Number.MAX_SAFE_INTEGER);
  const stakeZat = Math.min(maxStakeZat, stakeFor(settings, wallet.balanceZat, minStakeZat));
  const openValue = positions.reduce((s, p) => s + (p.valueZat ?? 0), 0);
  const equity =
    wallet.status === "ready" && (wallet.balanceZat > 0 || positions.length > 0)
      ? equityText(wallet.balanceZat + openValue)
      : null;
  const { overlay, canTrail } = useChartOverlay({
    active,
    reference,
    spot,
    sigma,
    nowSec,
    trailPct: settings.trailPct,
  });

  const { overlayHandle, onFrame } = useTradeFeedback({
    active,
    spot,
    symbol,
    line: reference,
    reactionsEnabled: settings.reactionsEnabled,
  });

  const openSheet = useCallback((name: SheetName, p: LivePosition | null = null) => {
    setTarget(p);
    setSheet(name);
  }, []);
  const trade = useTerminalTrade({
    network,
    trading,
    screen,
    quote,
    stakeZat,
    availableZat: wallet.balanceZat,
    slippageBps: settings.slippageBps,
    spot,
    onNeedChips: () => openSheet("deposit"),
  });
  useUpkeep(network, trading, wallet.positions, wallet.status === "ready");
  useReplayRecorder(network, positions, references);

  const closeAll = useCallback(async () => {
    setClosingAll(true);
    try {
      for (const p of positions) if (p.status === "priced" && p.kind === "single") await trade.close(p);
    } finally {
      setClosingAll(false);
    }
  }, [positions, trade]);

  const actions = {
    onAdd: (p: LivePosition) => openSheet("add", p),
    onReduce: (p: LivePosition) => openSheet("reduce", p),
    onExits: (p: LivePosition) => openSheet("exits", p),
    onSell: (p: LivePosition) => void trade.close(p),
  };
  const addTo = (p: LivePosition, amount: number) => {
    if (!trading || !p.window || !p.side) return;
    const live = p.window.id === screen?.window.id ? quote : null;
    const ask = live ? (p.side === "U" ? live.up.askE4 : live.down.askE4) : null;
    if (ask === null) {
      toast({ kind: "error", title: "No price right now", description: "Open its Window on screen to add." });
      return;
    }
    void buy(network, trading, {
      window: p.window.id,
      side: p.side,
      stakeZat: amount,
      maxAskE4: withSlippage(ask, settings.slippageBps, "up"),
      ...(spot === null ? {} : { entrySpot: spot }),
    })
      .then(() =>
        toast({ kind: "success", title: `Added to ${p.asset}`, description: `+${zecText(amount)} ${coin} staked` }),
      )
      .catch((e: unknown) =>
        toast({ kind: "error", title: "Add failed", description: e instanceof Error ? e.message : "" }),
      );
  };
  const reduce = (p: LivePosition, fractionBps: number) => {
    if (!trading || p.bidE4 === null) return;
    void closePosition(network, trading, p.key, withSlippage(p.bidE4, settings.slippageBps, "down"), fractionBps)
      .then(() =>
        toast({
          kind: "info",
          title: `Reduced ${p.asset}`,
          description: `${Math.round(fractionBps / (BPS / PERCENT))}% sold back`,
        }),
      )
      .catch((e: unknown) =>
        toast({ kind: "error", title: "Reduce failed", description: e instanceof Error ? e.message : "" }),
      );
  };

  const arrivingDeposit =
    wallet.deposits.filter((d) => d.state !== "done").sort((a, b) => b.createdAt - a.createdAt)[0]?.key ?? null;
  const phase = screen?.phase ?? null;
  const upAsk = quote?.up.askE4 ?? null;
  const downAsk = quote?.down.askE4 ?? null;
  const why = whyNotTrading({
    phase,
    trading: trading !== null,
    vault: wallet.status,
    hasQuote: upAsk !== null || downAsk !== null,
  });
  // Add buys at the live ask of the Window on screen, so only a position on that Window has one.
  const targetAsk =
    target && target.window?.id === screen?.window.id
      ? target.side === "U"
        ? upAsk
        : target.side === "D"
          ? downAsk
          : null
      : null;
  const lockedText =
    active && (active.status === "locked" || phase === "riding")
      ? `Locked · pays at ${clockText(active.settlesSec)}`
      : null;
  const parlay = useTerminalParlay({
    network,
    trading,
    bundle,
    screen,
    asset,
    spots,
    nowSec,
    screenStakeZat: stakeZat,
    minStakeZat,
    availableZat: wallet.balanceZat,
    slippageBps: settings.slippageBps,
    coin,
    canAdd: why === null,
    onNeedChips: () => openSheet("deposit"),
    onAddMarket: () => openSheet("markets"),
    onPlaced: () => setSheet((s) => (s === "parlay" ? null : s)),
  });
  // Parlay mode takes the buttons over: UP and DOWN add the Window on screen to the slip.
  const buttons =
    parlay.buttons ??
    (active ? (
      <TradeButtons
        mode="open"
        trailActive={active.record.state === "armed" && active.record.exit?.trail !== undefined}
        trailEligible={canTrail}
        trailPct={settings.trailPct}
        onTrail={() => void trade.toggleTrail(active, settings.trailPct)}
        onClose={() => void trade.close(active)}
        busy={trade.busy}
        lockedText={lockedText}
      />
    ) : (
      <TradeButtons
        mode="flat"
        onUp={() => void trade.open("U")}
        onDown={() => void trade.open("D")}
        busy={trade.busy}
        disabled={why !== null}
        why={why}
        upSub={upAsk ? `pays ${multipleOf(upAsk)}` : downAsk ? "not offered" : undefined}
        downSub={downAsk ? `pays ${multipleOf(downAsk)}` : upAsk ? "not offered" : undefined}
      />
    ));

  // The reactions overlay sits exactly over the chart: it places callouts in the canvas's own coordinates.
  const chart = (
    <>
      <LiveChart
        symbol={symbol}
        overlay={overlay}
        onFrame={onFrame}
        view={settings.chartView}
        interval={settings.chartInterval}
        handle={chartHandle}
        label={`${info.name} live price`}
      />
      <ReactionOverlay handle={overlayHandle} />
    </>
  );
  const stack = (
    <SettingsStack
      asset={asset}
      size={zecText(stakeZat)}
      pays={upAsk || downAsk ? `${upAsk ? multipleOf(upAsk) : "–"}·${downAsk ? multipleOf(downAsk) : "–"}` : "—"}
      fees="Free"
      trailPct={settings.trailPct}
      onOpen={() => openSheet("settings")}
    />
  );
  const windowChip = (
    <WindowChip
      lanes={lanes}
      cadenceSec={cadenceSec}
      onPick={pickCadence}
      phase={phase}
      startSec={screen?.window.startSec ?? null}
      cutoffSec={screen ? screen.window.expirySec - (bundle?.pricing.entryBufferSec ?? 0) : null}
      expirySec={screen?.window.expirySec ?? null}
      nowSec={nowSec}
    />
  );
  const sheets = (
    <TerminalSheets
      open={sheet}
      onClose={() => setSheet(null)}
      onOpen={(name) => openSheet(name, target)}
      network={network}
      trading={trading}
      asset={asset}
      coin={coin}
      target={target}
      positions={positions}
      records={wallet.positions}
      totals={totals}
      references={references}
      nowSec={nowSec}
      spot={spot}
      chipsZat={wallet.balanceZat}
      equity={equity}
      stakeZat={stakeZat}
      minStakeZat={minStakeZat}
      maxStakeZat={maxStakeZat}
      upAskE4={upAsk}
      downAskE4={downAsk}
      targetAskE4={targetAsk}
      line={reference}
      closeSec={screen?.window.expirySec ?? null}
      slippageBps={settings.slippageBps}
      closingAll={closingAll}
      onCloseAll={() => void closeAll()}
      onPickAsset={(next) => {
        window.location.hash = cadenceSec === null ? next : `${next}/${cadenceLabel(cadenceSec)}`;
      }}
      actions={actions}
      onAdd={addTo}
      onReduce={reduce}
      arrivingDeposit={arrivingDeposit}
    />
  );
  const title = <title>{`${info.name} (${asset}) · Kakure`}</title>;
  const roiPct = totals.stakeZat > 0 ? (totals.pnlZat / totals.stakeZat) * PERCENT : null;
  const closable = positions.filter((p) => p.status === "priced" && p.kind === "single").length;

  if (desktop) {
    return (
      <div className="kk-terminal-surface kk-terminal grid h-full min-h-0 grid-cols-[minmax(0,1fr)_20rem] grid-rows-[minmax(0,1fr)] overflow-hidden">
        <section className="relative min-w-0 overflow-hidden">
          {chart}
          <div className="absolute top-4 left-4 z-20 flex max-w-[calc(100%-2rem)] flex-col items-start gap-2">
            <AssetChip
              asset={asset}
              name={info.name}
              mark={info.mark}
              price={spot}
              onOpen={() => openSheet("markets")}
            />
            {windowChip}
          </div>
          <div className="absolute top-1/2 left-0 z-30 -translate-y-1/2">{stack}</div>
          <div className="absolute bottom-4 left-4 z-30">
            <ChartControls handle={chartHandle} />
          </div>
        </section>
        <aside className="flex min-h-0 flex-col gap-3 border-l border-border p-4">
          <SheetRow
            onMarkets={() => openSheet("markets")}
            onHistory={() => openSheet("history")}
            onSettings={() => openSheet("wallet-settings")}
          />
          <div className="flex justify-end">
            <EquityPill equity={equity} coin={coin} onOpen={() => openSheet(equity === null ? "deposit" : "wallet")} />
          </div>
          <UnrealizedCard
            totals={totals}
            coin={coin}
            closable={closable}
            onCloseAll={() => void closeAll()}
            closingAll={closingAll}
          />
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
            {parlay.on && positions.length === 0 ? null : (
              <PositionsList
                positions={positions}
                nowSec={nowSec}
                coin={coin}
                references={references}
                actions={actions}
              />
            )}
            {parlay.on ? <div className="shrink-0">{parlay.slip}</div> : null}
          </div>
          {parlay.tabs}
          {buttons}
        </aside>
        <TradeToasts />
        {sheets}
        {title}
      </div>
    );
  }

  return (
    <div className="kk-terminal-surface kk-terminal relative flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="absolute inset-0 z-10">{chart}</div>
      <div className="absolute top-1/2 left-0 z-30 -translate-y-1/2">{stack}</div>
      <header className="relative z-20 flex flex-col gap-2 px-3 pt-[calc(env(safe-area-inset-top,0rem)+1rem)] md:pt-4">
        <div className="flex items-center justify-between gap-2">
          <AssetChip asset={asset} name={info.name} mark={info.mark} price={spot} onOpen={() => openSheet("markets")} />
          <EquityPill equity={equity} coin={coin} onOpen={() => openSheet(equity === null ? "deposit" : "wallet")} />
        </div>
        {windowChip}
      </header>
      <div className="flex-1" />
      <footer className="relative z-20 flex flex-col gap-3 px-4 pb-3 md:pb-4">
        <ChartControls handle={chartHandle} />
        {positions.length > 0 ? (
          <ViewPositionPill count={positions.length} roiPct={roiPct} onOpen={() => openSheet("positions")} />
        ) : null}
        {parlay.on ? parlay.pill(() => openSheet("parlay")) : null}
        {parlay.tabs}
        {buttons}
      </footer>
      <TradeToasts />
      {sheets}
      <Sheet open={sheet === "parlay"} onClose={() => setSheet(null)} title="Parlay">
        {parlay.slip}
      </Sheet>
      {title}
    </div>
  );
}
