"use client";

import { formatUsd, priceDecimals } from "@kakure/chart";
import {
  bandInProbability,
  CHIP_GRID_ZAT,
  cadenceLabel,
  type LaneAsset,
  quoteBand,
  sidePayoutZat,
} from "@kakure/domain";
import { SegmentedControl } from "@kakure/ui-web";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { NETWORK_COIN } from "@/constants";
import { useRealtime } from "@/features/data/use-realtime";
import { PERCENT } from "@/features/terminal/constants";
import { multipleOf, windowStatus, zecText } from "@/features/terminal/format";
import { stakeFor, useTradeSettings } from "@/features/terminal/settings";
import { TradeToasts } from "@/features/terminal/toasts";
import { useUpkeep } from "@/features/terminal/use-upkeep";
import { defaultCadence, LANE_SYMBOLS, pickWindow, useCommittedSpots } from "@/features/terminal/use-window";
import { DepositSheet } from "@/features/wallet/deposit-sheet";
import { useWallet } from "@/features/wallet/wallet-store";
import { useNow } from "@/lib/time";
import { AssetPicker, LengthPicker, StakeRow, YourBands } from "./band-parts";
import { BandStrip } from "./band-strip";
import {
  bandHalf,
  bandUnit,
  centerMax,
  edgeText,
  gridUsd,
  RANGE_PRESETS,
  type RangePresetKey,
  snapOffset,
  trackHalf,
} from "./presets";
import { useBandBuy } from "./use-band-buy";
import "@/features/terminal/terminal.css";

/**
 * Range (plan §00 T5a; Owarine `features/range`, Mitoshi's `/games/range`): call where a Window closes, inside a band
 * or outside it. Tight · Balanced · Wide set the band's width (scaled to the Window's length and the asset's price),
 * the centre moves it off the market, and the house prices it live: P(in) = Φ(z(hi)) − Φ(z(lo)) on the same σ and
 * spread as Up/Down. Two of three venues' closing prints decide it; the payout is fixed when you buy.
 */
const MS = 1000;
const SLIDER_STEPS = 100;

export function RangeScreen() {
  const data = useRealtime();
  const network = data.network;
  const coin = NETWORK_COIN[network];
  const bundle = data.status === "ready" ? data.bundle : null;
  const trading = bundle?.trading ?? null;
  const wallet = useWallet(network);
  const settings = useTradeSettings();
  const nowSec = Math.floor(useNow() / MS);
  const spots = useCommittedSpots(LANE_SYMBOLS);
  const [asset, setAsset] = useState<LaneAsset>("BTC");
  const [length, setLength] = useState<number | null>(null);
  const [preset, setPreset] = useState<RangePresetKey>("balanced");
  const [offset, setOffset] = useState(0);
  const [side, setSide] = useState<"in" | "out">("in");
  const [ownStake, setOwnStake] = useState<number | null>(null);
  const [depositOpen, setDepositOpen] = useState(false);
  useUpkeep(network, trading, wallet.positions, wallet.status === "ready");

  // The shortest length trading now, chosen once the bundle is in, then held (as the terminal does).
  const fallback = length === null && bundle && nowSec > 0 ? defaultCadence(asset, bundle, nowSec) : null;
  useEffect(() => {
    if (fallback !== null) setLength(fallback);
  }, [fallback]);
  const cadenceSec = length ?? fallback;
  const screen = cadenceSec !== null && nowSec > 0 ? pickWindow(asset, cadenceSec, bundle, nowSec, new Set()) : null;
  const spot = spots.get(`${asset}-USD`) ?? null;
  const sigmaText = bundle?.pricing.sigma[asset];
  const sigma = sigmaText ? Number(sigmaText) : null;
  const secondsLeft = screen ? screen.window.expirySec - nowSec : 0;

  const unit = spot ? bandUnit(spot) : 1;
  const half = spot && cadenceSec ? bandHalf(preset, cadenceSec, spot) : 0;
  const reach = spot && cadenceSec ? centerMax(cadenceSec, spot) : 0;
  const centre = spot === null ? null : spot + offset;
  const lo = centre === null ? null : Number(edgeText(centre - half, unit));
  const hi = centre === null ? null : Number(edgeText(centre + half, unit));
  const trades = screen?.phase === "pre" || screen?.phase === "opening" || screen?.phase === "live";
  const quote =
    trades && spot !== null && sigma !== null && lo !== null && hi !== null
      ? quoteBand(spot, { lo, hi }, side, sigma, secondsLeft)
      : null;
  const pIn =
    spot !== null && sigma !== null && lo !== null && hi !== null && screen
      ? bandInProbability(spot, { lo, hi }, sigma, secondsLeft)
      : null;
  const minStakeZat = Number(bundle?.pricing.caps.minStakeZat ?? CHIP_GRID_ZAT);
  const stakeZat = ownStake ?? stakeFor(settings, wallet.balanceZat, minStakeZat, CHIP_GRID_ZAT);
  const payoutZat = quote?.askE4 ? sidePayoutZat(stakeZat, quote.askE4) : null;
  const capZat = bundle?.pricing.caps.maxBandPayoutZat ? Number(bundle.pricing.caps.maxBandPayoutZat) : null;
  const { busy, buy } = useBandBuy({
    network,
    trading,
    availableZat: wallet.balanceZat,
    slippageBps: settings.slippageBps,
    onNeedChips: () => setDepositOpen(true),
  });

  const why = !trading
    ? "Trading isn't published on this network yet."
    : capZat === null
      ? "Bands aren't published on this network yet."
      : !screen || !trades
        ? "This Window has stopped taking trades. The next one opens shortly."
        : spot === null || sigma === null
          ? "Waiting for a live price."
          : quote?.askE4 === null || quote === null
            ? "This band is all but decided: move it or widen it."
            : payoutZat !== null && payoutZat > capZat
              ? `It would pay more than the ${zecText(capZat)} ${coin} cap. Lower the stake.`
              : stakeZat < minStakeZat
                ? `The smallest stake is ${zecText(minStakeZat)} ${coin}.`
                : null;
  const bandFilter = useCallback((l: number | null, h: number | null) => l !== null && h !== null, []);
  const usd = (n: number) => formatUsd(n, priceDecimals(n));

  return (
    <div className="mx-auto flex w-full max-w-(--layout-content-max) flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-page-title text-foreground">Range</h1>
        <p className="text-body text-muted-foreground">
          Call where the close lands: inside a band, or outside it. Tighter pays more.
        </p>
      </header>

      <section className="flex flex-col gap-4 rounded-group border border-border bg-card p-4 md:p-5">
        <AssetPicker
          value={asset}
          onChange={(next) => {
            setAsset(next);
            setOffset(0);
          }}
        />
        <LengthPicker asset={asset} value={cadenceSec} onChange={setLength} />
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-row-strong text-foreground">
            {asset} · {cadenceSec ? `${cadenceLabel(cadenceSec)} Window` : "…"}
          </span>
          <span className="numbers text-meta text-muted-foreground">
            {windowStatus({
              phase: screen?.phase ?? null,
              startSec: screen?.window.startSec ?? null,
              cutoffSec: screen ? screen.window.expirySec - (bundle?.pricing.entryBufferSec ?? 0) : null,
              expirySec: screen?.window.expirySec ?? null,
              nowSec,
            })}
          </span>
        </div>

        {spot !== null && sigma !== null && lo !== null && hi !== null ? (
          <div className="flex flex-col gap-1">
            <BandStrip
              spot={spot}
              lo={lo}
              hi={hi}
              side={side}
              trackLo={spot - trackHalf(half, reach, unit)}
              trackHi={spot + trackHalf(half, reach, unit)}
              sigma={sigma}
              secondsLeft={secondsLeft}
            />
            <div className="numbers flex justify-between text-meta text-muted-foreground">
              <span>From {gridUsd(lo, unit)}</span>
              <span className="text-foreground">
                {asset} now {usd(spot)}
              </span>
              <span>To {gridUsd(hi, unit)}</span>
            </div>
          </div>
        ) : (
          <div className="h-28 rounded-row bg-secondary" />
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl
            label="Band width"
            value={preset}
            onChange={(v) => setPreset(v)}
            options={RANGE_PRESETS.map((p) => ({ value: p.key, label: p.label }))}
          />
          <SegmentedControl
            label="Side"
            value={side}
            onChange={(v) => setSide(v)}
            options={[
              { value: "in", label: "Inside" },
              { value: "out", label: "Outside" },
            ]}
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={`Move the band ${gridUsd(unit, unit)} lower`}
            onClick={() => setOffset((o) => snapOffset(o - unit, reach, unit))}
            className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-foreground"
          >
            <Minus aria-hidden className="size-4" />
          </button>
          <input
            type="range"
            min={-SLIDER_STEPS}
            max={SLIDER_STEPS}
            value={reach > 0 ? Math.round((offset / reach) * SLIDER_STEPS) : 0}
            onChange={(e) => setOffset(snapOffset((Number(e.target.value) / SLIDER_STEPS) * reach, reach, unit))}
            className="w-full accent-[var(--primary)]"
            aria-label={`Band centre relative to the current ${asset} price`}
            aria-valuetext={
              offset === 0
                ? "At the market price"
                : `${gridUsd(Math.abs(offset), unit)} ${offset > 0 ? "above" : "below"} market`
            }
          />
          <button
            type="button"
            aria-label={`Move the band ${gridUsd(unit, unit)} higher`}
            onClick={() => setOffset((o) => snapOffset(o + unit, reach, unit))}
            className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-foreground"
          >
            <Plus aria-hidden className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Recentre the band on the market price"
            onClick={() => setOffset(0)}
            className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-foreground"
          >
            <RotateCcw aria-hidden className="size-4" />
          </button>
        </div>
        <p className="text-meta text-muted-foreground">
          {offset === 0
            ? "Centred on the market price"
            : `${gridUsd(Math.abs(offset), unit)} ${offset > 0 ? "above" : "below"} market`}
          {" · "}
          {gridUsd(half * 2, unit)} wide
        </p>

        <StakeRow stakeZat={stakeZat} own={ownStake !== null} onChange={setOwnStake} coin={coin} />

        <div className="flex items-end justify-between gap-3">
          <div className="flex flex-col">
            <span className="text-meta text-muted-foreground">Pays</span>
            <span className="numbers font-display text-title text-foreground">
              {quote?.askE4 ? multipleOf(quote.askE4) : "—"}
            </span>
          </div>
          <div className="flex flex-col items-end text-right">
            <span className="text-meta text-muted-foreground">
              If {side === "in" ? "it closes inside" : "it closes outside"}
            </span>
            <span className="numbers text-row-strong text-up">
              {payoutZat !== null ? `${zecText(payoutZat)} ${coin}` : "—"}
            </span>
          </div>
        </div>
        {pIn !== null ? (
          <p className="text-meta text-muted-foreground">
            {Math.round((side === "in" ? pIn : 1 - pIn) * PERCENT)}% chance it closes{" "}
            {side === "in" ? "inside" : "outside"}, by the house's model
          </p>
        ) : null}
        {why ? <p className="text-meta text-down">{why}</p> : null}
        <button
          type="button"
          disabled={why !== null || busy || !screen || lo === null || hi === null}
          onClick={() => {
            if (!screen || lo === null || hi === null) return;
            void buy({
              window: screen.window.id,
              asset,
              lo: edgeText(lo, unit),
              hi: edgeText(hi, unit),
              side,
              askE4: quote?.askE4 ?? null,
              stakeZat,
              spot,
            });
          }}
          className="flex h-14 w-full items-center justify-center rounded-full bg-primary text-[1.0625rem] font-extrabold tracking-[0.04em] text-primary-foreground transition-[transform,opacity] active:scale-[0.97] disabled:opacity-40"
        >
          {busy ? "Placing…" : `Call ${side === "in" ? "inside" : "outside"} · ${zecText(stakeZat)} ${coin}`}
        </button>
        <p className="text-center text-meta text-muted-foreground">
          Two of three venues' closing prints decide it. Sell it back any time before the last 30 seconds.
        </p>
      </section>

      <YourBands
        title="Your bands"
        empty="No bands yet. Call one above."
        network={network}
        trading={trading}
        bundle={bundle}
        records={wallet.positions}
        spots={spots}
        nowSec={nowSec}
        slippageBps={settings.slippageBps}
        filter={bandFilter}
      />
      <TradeToasts />
      {trading ? (
        <DepositSheet
          open={depositOpen}
          onClose={() => setDepositOpen(false)}
          network={network}
          trading={trading}
          resume={
            wallet.deposits.filter((d) => d.state !== "done").sort((a, b) => b.createdAt - a.createdAt)[0]?.key ?? null
          }
        />
      ) : null}
    </div>
  );
}
