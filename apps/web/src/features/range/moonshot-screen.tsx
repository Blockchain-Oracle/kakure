"use client";

import { formatUsd, priceDecimals } from "@kakure/chart";
import { CHIP_GRID_ZAT, cadenceLabel, type LaneAsset, moonshotLevel, quoteBand, sidePayoutZat } from "@kakure/domain";
import { fire } from "@kakure/sounds";
import { cx } from "@kakure/ui-web";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { MOONSHOT_REACHES } from "./constants";
import { bandUnit, edgeText, gridUsd } from "./presets";
import { useBandBuy } from "./use-band-buy";
import "@/features/terminal/terminal.css";

/**
 * Moonshot (plan §00 T5a; Mitoshi's `/games/moonshot`): pick a direction and a reach, ×2 … ×25. The house solves the
 * level the close must finish past so its ask is one over the reach (`moonshotLevel`), then prices that one-sided band
 * like any other. Hold to fire. Two of three venues' closing prints decide it.
 */
const MS = 1000;
const HOLD_MS = 600;
const DECIMALS = 2;

export function MoonshotScreen() {
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
  const [direction, setDirection] = useState<"long" | "short">("long");
  const [reach, setReach] = useState<number>(MOONSHOT_REACHES[2]);
  const [ownStake, setOwnStake] = useState<number | null>(null);
  const [depositOpen, setDepositOpen] = useState(false);
  useUpkeep(network, trading, wallet.positions, wallet.status === "ready");

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
  const trades = screen?.phase === "pre" || screen?.phase === "opening" || screen?.phase === "live";

  const unit = spot ? bandUnit(spot) : 1;
  const level =
    spot !== null && sigma !== null && screen
      ? Number(edgeText(moonshotLevel(direction, reach, spot, sigma, secondsLeft), unit))
      : null;
  const band = level === null ? null : direction === "long" ? { lo: level, hi: null } : { lo: null, hi: level };
  const quote =
    trades && band && spot !== null && sigma !== null ? quoteBand(spot, band, "in", sigma, secondsLeft) : null;
  const minStakeZat = Number(bundle?.pricing.caps.minStakeZat ?? CHIP_GRID_ZAT);
  const stakeZat = ownStake ?? stakeFor(settings, wallet.balanceZat, minStakeZat, CHIP_GRID_ZAT);
  const payoutZat = quote?.askE4 ? sidePayoutZat(stakeZat, quote.askE4) : null;
  const capZat = bundle?.pricing.caps.maxBandPayoutZat ? Number(bundle.pricing.caps.maxBandPayoutZat) : null;
  const away = level !== null && spot !== null ? ((level - spot) / spot) * PERCENT : null;
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
      ? "Moonshots aren't published on this network yet."
      : !screen || !trades
        ? "This Window has stopped taking trades. The next one opens shortly."
        : spot === null || sigma === null
          ? "Waiting for a live price."
          : !quote?.askE4
            ? "Not offered right now. Try a smaller reach."
            : payoutZat !== null && payoutZat > capZat
              ? `It would pay more than the ${zecText(capZat)} ${coin} cap. Lower the stake.`
              : null;
  const fireIt = () => {
    if (!screen || level === null || why) return;
    void buy({
      window: screen.window.id,
      asset,
      lo: direction === "long" ? edgeText(level, unit) : null,
      hi: direction === "short" ? edgeText(level, unit) : null,
      side: "in",
      askE4: quote?.askE4 ?? null,
      stakeZat,
      spot,
    });
  };
  const oneEdge = useCallback((lo: number | null, hi: number | null) => (lo === null) !== (hi === null), []);
  const usd = (n: number) => formatUsd(n, priceDecimals(n));

  return (
    <div className="mx-auto flex w-full max-w-(--layout-content-max) flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-page-title text-foreground">Moonshot</h1>
        <p className="text-body text-muted-foreground">
          Pick a direction and a reach. The house sets the level the close must finish past.
        </p>
      </header>

      <section className="flex flex-col gap-4 rounded-group border border-border bg-card p-4 md:p-5">
        <AssetPicker value={asset} onChange={setAsset} />
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

        <fieldset className="m-0 grid min-w-0 grid-cols-5 gap-2 border-0 p-0">
          <legend className="sr-only">Aim: direction and reach</legend>
          {(["long", "short"] as const).flatMap((d) =>
            MOONSHOT_REACHES.map((r) => {
              const on = d === direction && r === reach;
              return (
                <button
                  key={`${d}${r}`}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${d === "long" ? "Long" : "Short"} ×${r}`}
                  onClick={() => {
                    fire("toggle", { haptic: "tick" });
                    setDirection(d);
                    setReach(r);
                  }}
                  className={cx(
                    "numbers flex h-14 flex-col items-center justify-center rounded-group text-row-strong",
                    on
                      ? d === "long"
                        ? "kk-up-solid"
                        : "kk-down-solid"
                      : d === "long"
                        ? "kk-up-soft"
                        : "kk-down-soft",
                  )}
                >
                  {d === "long" ? (
                    <ArrowUpRight aria-hidden className="size-4" />
                  ) : (
                    <ArrowDownRight aria-hidden className="size-4" />
                  )}
                  ×{r}
                </button>
              );
            }),
          )}
        </fieldset>

        <div className="flex flex-col gap-1 rounded-row bg-secondary p-3">
          <span className="text-meta text-muted-foreground">
            The level it must finish {direction === "long" ? "at or above" : "at or below"}
          </span>
          <span className="numbers font-display text-title text-foreground">
            {level !== null ? gridUsd(level, unit) : "—"}
          </span>
          <span className="numbers text-meta text-muted-foreground">
            {away !== null && spot !== null
              ? `${Math.abs(away).toFixed(DECIMALS)}% ${away >= 0 ? "above" : "below"} ${usd(spot)} now`
              : "Waiting for a live price…"}
          </span>
        </div>

        <StakeRow stakeZat={stakeZat} own={ownStake !== null} onChange={setOwnStake} coin={coin} />
        <div className="flex items-end justify-between gap-3">
          <div className="flex flex-col">
            <span className="text-meta text-muted-foreground">Pays</span>
            <span className="numbers font-display text-title text-foreground">
              {quote?.askE4 ? multipleOf(quote.askE4) : "—"}
            </span>
          </div>
          <div className="flex flex-col items-end text-right">
            <span className="text-meta text-muted-foreground">If it lands</span>
            <span className="numbers text-row-strong text-up">
              {payoutZat !== null ? `${zecText(payoutZat)} ${coin}` : "—"}
            </span>
          </div>
        </div>
        {why ? <p className="text-meta text-down">{why}</p> : null}
        <HoldToFire
          disabled={why !== null || busy}
          label={busy ? "Firing…" : `Hold to fire · ${zecText(stakeZat)} ${coin}`}
          onFire={fireIt}
        />
        <p className="text-center text-meta text-muted-foreground">
          Two of three venues' closing prints decide it. Sell it back any time before the last 30 seconds.
        </p>
      </section>

      <YourBands
        title="Your moonshots"
        empty="No moonshots yet. Take aim above."
        network={network}
        trading={trading}
        bundle={bundle}
        records={wallet.positions}
        spots={spots}
        nowSec={nowSec}
        slippageBps={settings.slippageBps}
        filter={oneEdge}
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

/** Mitoshi's hold-to-fire: press and hold 0.6 s (the fill runs across); letting go early cancels. Enter or Space fires. */
function HoldToFire({ disabled, label, onFire }: { disabled: boolean; label: string; onFire: () => void }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = () => {
    setHolding(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={() => {
        if (disabled) return;
        setHolding(true);
        fire("toggle", { haptic: "press" });
        timer.current = setTimeout(() => {
          stop();
          onFire();
        }, HOLD_MS);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onFire();
        }
      }}
      className="relative flex h-14 w-full items-center justify-center overflow-hidden rounded-full bg-primary text-[1.0625rem] font-extrabold tracking-[0.04em] text-primary-foreground disabled:opacity-40"
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 bg-foreground/20"
        style={{ width: holding ? "100%" : "0%", transition: holding ? `width ${HOLD_MS}ms linear` : "none" }}
      />
      <span className="relative">{label}</span>
    </button>
  );
}
