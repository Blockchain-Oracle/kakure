"use client";

import { formatPrice } from "@kakure/chart";
import { CHIP_GRID_ZAT, ladderFloor, sidePayoutZat, ZATOSHI_PER_ZEC } from "@kakure/domain";
import { fire } from "@kakure/sounds";
import { cx, Sheet } from "@kakure/ui-web";
import { Info } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
  DEFAULT_SIZE_SHARE,
  PERCENT,
  SIZE_PRESETS,
  TRAIL_CHOICES,
  TRAIL_MAX,
  TRAIL_MIN,
  TRAIL_SLIDER_STEP,
} from "../constants";
import { clockText, multipleOf, zatToNumber, zecText } from "../format";
import { setTradeSettings, useTradeSettings } from "../settings";

/**
 * The order settings (Owarine `sheets/SettingsSheet.tsx`, Tradash's `sT` on a binary Window): SIZE (the stake: Min,
 * 25 %, 50 %, Max of the chips available, its share, reset), PAYOUT (what each side pays now and the risk in words),
 * TRAILING STOP (how far behind its best price the stop follows) and the order summary. Fees: the spread is the price.
 */
const tap = () => fire("toggle", { haptic: "tick" });
const ZAT_PER_ZEC = Number(ZATOSHI_PER_ZEC);

function Section({
  title,
  tip,
  right,
  children,
}: {
  title: string;
  tip: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  const [showTip, setShowTip] = useState(false);
  return (
    <section className="rounded-group bg-secondary/60 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-[0.6875rem] font-bold tracking-[0.1em] text-muted-foreground">
          {title}
          <button
            type="button"
            aria-label={`About ${title.toLowerCase()}`}
            aria-expanded={showTip}
            onClick={() => setShowTip((s) => !s)}
            className="text-muted-foreground"
          >
            <Info aria-hidden className="size-3.5" />
          </button>
        </span>
        {right ? <span className="text-[0.6875rem] text-muted-foreground">{right}</span> : null}
      </div>
      {showTip ? <p className="mt-2 text-meta text-muted-foreground">{tip}</p> : null}
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function SettingsSheet({
  open,
  onClose,
  asset,
  coin,
  availableZat,
  stakeZat,
  minZat,
  maxStakeZat,
  upAskE4,
  downAskE4,
  line,
  closeSec,
}: {
  open: boolean;
  onClose: () => void;
  asset: string;
  coin: string;
  availableZat: number;
  stakeZat: number;
  minZat: number;
  maxStakeZat: number;
  upAskE4: number | null;
  downAskE4: number | null;
  line: number | null;
  closeSec: number | null;
}) {
  const settings = useTradeSettings();
  const max = Math.max(minZat, Math.min(availableZat, maxStakeZat));
  const share = availableZat > 0 ? Math.round((stakeZat / availableZat) * PERCENT) : null;
  // Every size snaps down to the chip ladder (1, 2 or 5 × 10^k): a stake never encodes the balance (re-audit V3).
  const defaultSize = Math.max(minZat, ladderFloor(DEFAULT_SIZE_SHARE * availableZat));
  const setSize = (zat: number) => setTradeSettings({ sizeZat: Math.max(minZat, ladderFloor(Math.min(max, zat))) });
  const lineText = line === null ? "its opening print" : `$${formatPrice(line)}`;
  const at = closeSec === null ? "the close" : clockText(closeSec);
  const presets: ReadonlyArray<readonly [string, number]> = [
    ["Min", minZat],
    ...SIZE_PRESETS.map((p) => [`${p * PERCENT}%`, availableZat * p] as const),
    ["Max", max],
  ];

  return (
    <Sheet open={open} onClose={onClose} title={`${asset} settings`}>
      <div className="flex flex-col gap-3">
        <Section
          title="SIZE"
          tip={`What each trade stakes from your chips. A right call pays the stake times its payout; a wrong one loses the stake. Minimum ${zecText(minZat)} ${coin}.`}
          right={`${zecText(availableZat)} ${coin} in chips`}
        >
          <div className="flex items-baseline justify-between gap-2">
            <input
              type="number"
              inputMode="decimal"
              step={zatToNumber(CHIP_GRID_ZAT)}
              value={zatToNumber(stakeZat)}
              onChange={(e) => setSize(Math.round(Number(e.target.value) * ZAT_PER_ZEC))}
              className="numbers w-full bg-transparent font-display text-title outline-none"
              aria-label={`Stake, ${coin}`}
            />
            {share !== null ? (
              <span className="shrink-0 text-[0.6875rem] text-muted-foreground">{share}% of chips</span>
            ) : null}
          </div>
          <input
            type="range"
            min={minZat}
            max={max}
            step={CHIP_GRID_ZAT}
            value={Math.min(stakeZat, max)}
            onChange={(e) => setSize(Number(e.target.value))}
            className="mt-2 w-full accent-[var(--up)]"
            aria-label="Stake slider"
          />
          <div className="mt-3 grid grid-cols-4 gap-2">
            {presets.map(([label, zat]) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  tap();
                  setSize(zat);
                }}
                className={cx(
                  "h-9 rounded-full text-chip-label",
                  stakeZat === Math.max(minZat, ladderFloor(Math.min(max, zat))) ? "kk-up-solid" : "bg-card",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {settings.sizeZat !== null && Math.abs(settings.sizeZat - defaultSize) >= CHIP_GRID_ZAT ? (
            <button
              type="button"
              onClick={() => {
                tap();
                setTradeSettings({ sizeZat: null });
              }}
              className="mt-2 text-meta font-semibold text-primary"
            >
              Reset to default ({zecText(defaultSize)} {coin})
            </button>
          ) : null}
        </Section>

        <Section
          title="PAYOUT"
          tip="A right call pays its stake times the payout at the Window's close. The payout comes from the house's public price: the closer a side is to winning, the less it pays."
          right="the house's live price"
        >
          <div className="grid grid-cols-2 gap-2">
            <div className="kk-up-soft rounded-group p-3">
              <p className="text-[0.6875rem] font-bold">UP pays</p>
              <p className="numbers font-display text-title">{multipleOf(upAskE4)}</p>
            </div>
            <div className="kk-down-soft rounded-group p-3">
              <p className="text-[0.6875rem] font-bold">DOWN pays</p>
              <p className="numbers font-display text-title">{multipleOf(downAskE4)}</p>
            </div>
          </div>
          <p className="mt-2 text-meta text-muted-foreground">
            Up wins if two of three venues close {asset} above {lineText} at {at}; Down wins if two close below it.
            Anything else refunds both sides their stake.
          </p>
        </Section>

        <Section
          title="TRAILING STOP"
          tip="Turn on Trail for a trade in profit and a stop follows the price as it moves your way, staying this far behind its best level. If the price pulls back this much, the mint closes the trade at its bid, even with this tab closed."
          right="behind price"
        >
          <p className="numbers font-display text-title">{(settings.trailPct * PERCENT).toFixed(2)}%</p>
          <input
            type="range"
            min={TRAIL_MIN * PERCENT}
            max={TRAIL_MAX * PERCENT}
            step={TRAIL_SLIDER_STEP}
            value={settings.trailPct * PERCENT}
            onChange={(e) =>
              setTradeSettings({ trailPct: Math.min(TRAIL_MAX, Math.max(TRAIL_MIN, Number(e.target.value) / PERCENT)) })
            }
            className="mt-2 w-full accent-[var(--up)]"
            aria-label="Trailing stop distance"
          />
          <div className="mt-3 grid grid-flow-col gap-2">
            {TRAIL_CHOICES.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  tap();
                  setTradeSettings({ trailPct: v });
                }}
                className={cx(
                  "h-9 rounded-full text-chip-label",
                  Math.abs(v - settings.trailPct) < TRAIL_MIN / PERCENT ? "kk-up-solid" : "bg-card",
                )}
              >
                {(v * PERCENT).toFixed(2)}%
              </button>
            ))}
          </div>
        </Section>

        <dl className="grid grid-cols-2 gap-y-2 px-1 text-meta">
          <dt className="text-muted-foreground">Stake</dt>
          <dd className="numbers text-right">
            {zecText(stakeZat)} {coin}
          </dd>
          <dt className="text-muted-foreground">Pays if right</dt>
          <dd className="numbers text-right">
            {upAskE4 ? zecText(sidePayoutZat(stakeZat, upAskE4)) : "—"} up ·{" "}
            {downAskE4 ? zecText(sidePayoutZat(stakeZat, downAskE4)) : "—"} down
          </dd>
          <dt className="text-muted-foreground">Fees</dt>
          <dd className="numbers text-right">Free · the spread is the price</dd>
        </dl>
      </div>
    </Sheet>
  );
}
