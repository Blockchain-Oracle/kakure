"use client";

import {
  type BundleV2,
  cadenceLabel,
  LANE_ASSETS,
  type LaneAsset,
  type Network,
  type Trading,
  withSlippage,
} from "@kakure/domain";
import { fire } from "@kakure/sounds";
import { Chip, ChipGroup, cx, Mark, RollingNumber } from "@kakure/ui-web";
import { MoveHorizontal } from "lucide-react";
import { useMemo } from "react";
import { NETWORK_COIN } from "@/constants";
import { assetFor } from "@/features/markets/assets";
import { PARLAY_STAKE_CHIPS_ZAT } from "@/features/terminal/constants";
import { bandText, clockText, livePnlText, signedPct, zatToNumber, zecText } from "@/features/terminal/format";
import { valuePositions } from "@/features/terminal/positions";
import { toast } from "@/features/terminal/toasts";
import { refusalWords } from "@/features/terminal/use-trade";
import { lanesFor } from "@/features/terminal/use-window";
import { MintError } from "@/features/wallet/api";
import type { PositionRecord } from "@/features/wallet/records";
import { close } from "@/features/wallet/trading";

/** The pieces Range and Moonshot share: the asset and length pickers, the stake row and the list of bands held. */
const tap = () => fire("toggle", { haptic: "tick" });

export function AssetPicker({ value, onChange }: { value: LaneAsset; onChange: (asset: LaneAsset) => void }) {
  return (
    <ChipGroup label="Asset">
      {LANE_ASSETS.map((asset) => (
        <Chip
          key={asset}
          selected={asset === value}
          onClick={() => {
            tap();
            onChange(asset);
          }}
          icon={<Mark mark={assetFor({ kind: "close", subject: asset }).mark} label={asset} size="inline" />}
        >
          {asset}
        </Chip>
      ))}
    </ChipGroup>
  );
}

export function LengthPicker({
  asset,
  value,
  onChange,
}: {
  asset: LaneAsset;
  value: number | null;
  onChange: (cadenceSec: number) => void;
}) {
  return (
    <ChipGroup label="Window length">
      {lanesFor(asset).map((lane) => (
        <Chip
          key={lane.cadenceSec}
          selected={lane.cadenceSec === value}
          onClick={() => {
            tap();
            onChange(lane.cadenceSec);
          }}
        >
          {cadenceLabel(lane.cadenceSec)}
        </Chip>
      ))}
    </ChipGroup>
  );
}

/** The stake: the terminal's size by default, or one of the chips (0.01 · 0.05 · 0.1 · 0.5). */
export function StakeRow({
  stakeZat,
  own,
  onChange,
  coin,
}: {
  stakeZat: number;
  own: boolean;
  onChange: (zat: number | null) => void;
  coin: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-meta text-muted-foreground">
        Stake <span className="numbers text-foreground">{zecText(stakeZat)}</span> {coin}
      </span>
      <div className="flex items-center gap-1">
        {PARLAY_STAKE_CHIPS_ZAT.map((zat) => (
          <button
            key={zat}
            type="button"
            onClick={() => {
              tap();
              onChange(own && stakeZat === zat ? null : zat);
            }}
            aria-pressed={own && stakeZat === zat}
            className={cx(
              "numbers h-7 min-w-9 rounded-full px-2 text-[0.6875rem] font-bold",
              own && stakeZat === zat ? "bg-foreground text-stage" : "bg-secondary text-foreground",
            )}
          >
            {zecText(zat)}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The bands this device holds (Owarine's "Your rounds"): each valued at the house's bid, sold back in one tap while
 * its Window trades, then riding to the close and paying out as chips on its own.
 */
export function YourBands({
  title,
  empty,
  network,
  trading,
  bundle,
  records,
  spots,
  nowSec,
  slippageBps,
  filter,
}: {
  title: string;
  empty: string;
  network: Network;
  trading: Trading | null;
  bundle: BundleV2 | null;
  records: readonly PositionRecord[];
  spots: ReadonlyMap<string, number>;
  nowSec: number;
  slippageBps: number;
  /** Which bands this list shows (Range: two edges; Moonshot: one). */
  filter: (lo: number | null, hi: number | null) => boolean;
}) {
  const coin = NETWORK_COIN[network];
  const bands = useMemo(
    () =>
      valuePositions(records, bundle, (s) => spots.get(s) ?? null, nowSec).filter(
        (p) => p.kind === "band" && p.band && filter(p.band.lo, p.band.hi),
      ),
    [records, bundle, spots, nowSec, filter],
  );
  const sell = async (key: string, bidE4: number, asset: string) => {
    if (!trading) return;
    const id = toast({ kind: "loading", title: `Selling ${asset} back…` });
    try {
      const record = await close(network, trading, key, withSlippage(bidE4, slippageBps, "down"));
      fire("send");
      const stake = Number(record.certificate?.stakeZat ?? 0);
      toast({
        id,
        kind: "success",
        title: `Sold ${asset}`,
        description: `Realized ${livePnlText(zatToNumber(Number(record.paidZat ?? 0) - stake))} ${coin}`,
      });
    } catch (error) {
      fire("error");
      toast(
        error instanceof MintError && error.refused
          ? { id, kind: "error", ...refusalWords(error, coin) }
          : { id, kind: "error", title: "Sell failed", description: error instanceof Error ? error.message : "" },
      );
    }
  };

  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="font-display text-title text-foreground">{title}</h2>
      {bands.length === 0 ? (
        <p className="rounded-group border border-border bg-card p-4 text-row-detail text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {bands.map((p) => (
            <li key={p.key} className="flex items-center gap-3 rounded-group border border-border bg-card p-3">
              <Mark
                mark={assetFor({ kind: "close", subject: p.asset ?? "" }).mark}
                label={p.asset ?? ""}
                size="token"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-row-strong text-foreground">
                  {p.asset} <MoveHorizontal aria-hidden className="size-4 text-muted-foreground" />
                  <span className="text-meta text-muted-foreground">
                    {p.cadenceSec ? cadenceLabel(p.cadenceSec) : ""}
                  </span>
                </span>
                <span className="block truncate text-meta text-muted-foreground">
                  {p.band ? bandText(p.band) : ""} · {zecText(p.stakeZat)} {coin} ·{" "}
                  {p.status === "priced" ? `settles ${clockText(p.settlesSec)}` : "riding to the close"}
                </span>
              </span>
              <span className="flex flex-col items-end">
                <span
                  className={cx(
                    "numbers text-row-strong",
                    p.roiPct === null ? "text-muted-foreground" : p.roiPct >= 0 ? "text-up" : "text-down",
                  )}
                >
                  {p.roiPct === null ? "—" : <RollingNumber value={signedPct(p.roiPct)} />}
                </span>
                {p.pnlZat !== null ? (
                  <span className={cx("numbers text-meta", p.pnlZat >= 0 ? "text-up" : "text-down")}>
                    {livePnlText(zatToNumber(p.pnlZat))}
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                disabled={p.status !== "priced" || p.bidE4 === null}
                onClick={() => {
                  if (p.bidE4 !== null) void sell(p.key, p.bidE4, p.asset ?? "");
                }}
                className="kk-down-soft h-9 shrink-0 rounded-full px-3 text-chip-label disabled:opacity-40"
              >
                Sell
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
