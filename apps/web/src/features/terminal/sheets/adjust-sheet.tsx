"use client";

import { CHIP_GRID_ZAT, sidePayoutZat, ZATOSHI_PER_ZEC } from "@kakure/domain";
import { fire } from "@kakure/sounds";
import { cx, Sheet } from "@kakure/ui-web";
import { useEffect, useState } from "react";
import {
  ADD_CHIPS,
  ADD_MAX_SHARE,
  ADJUST_START_SHARE,
  BPS,
  PERCENT,
  REDUCE_CHIPS,
  REDUCE_MAX_SHARE,
} from "../constants";
import { livePnlText, multipleOf, zatToNumber, zecText } from "../format";
import type { LivePosition } from "../positions";

/**
 * Add / Reduce (Owarine `sheets/PositionSheets.tsx` `AdjustSheet`, Tradash's `sH`): an amount (half of the most to
 * start), a slider and chips, the "After this order" preview and the action. Add buys another position on the same
 * Window side at the live ask (each buy is its own certificate in Kakure); Reduce sells that share of this position
 * back at the live bid and keeps the rest running.
 */
const ZAT_PER_ZEC = Number(ZATOSHI_PER_ZEC);
const tap = () => fire("toggle", { haptic: "tick" });
const onGrid = (zat: number) => Math.floor(zat / CHIP_GRID_ZAT) * CHIP_GRID_ZAT;

export function AdjustSheet({
  open,
  onClose,
  kind,
  position,
  coin,
  availableZat,
  minStakeZat,
  askE4,
  onAdd,
  onReduce,
}: {
  open: boolean;
  onClose: () => void;
  kind: "add" | "reduce";
  position: LivePosition | null;
  coin: string;
  availableZat: number;
  minStakeZat: number;
  /** The live ask for this position's side, for Add. */
  askE4: number | null;
  onAdd: (p: LivePosition, stakeZat: number) => void;
  onReduce: (p: LivePosition, fractionBps: number) => void;
}) {
  const stake = position?.stakeZat ?? 0;
  const max = onGrid(kind === "add" ? ADD_MAX_SHARE * availableZat : REDUCE_MAX_SHARE * stake);
  const [amount, setAmount] = useState(0);
  // Starts at half of the most each time it opens.
  useEffect(() => {
    if (open) setAmount(onGrid(max * ADJUST_START_SHARE));
  }, [open, kind]);

  if (!position) {
    return (
      <Sheet open={open} onClose={onClose} title="Adjust position">
        <p className="py-6 text-center text-row text-muted-foreground">This position is no longer open.</p>
        <button type="button" onClick={onClose} className="h-12 w-full rounded-full bg-foreground text-stage">
          Done
        </button>
      </Sheet>
    );
  }

  // A side is sold only while its Window trades; a position is bought back only while it has a bid.
  const blocked =
    kind === "add"
      ? askE4 === null
        ? "Adding works on the Window on screen while it trades."
        : null
      : position.bidE4 === null
        ? "Locked: it rides to the close now, and pays as chips once it settles."
        : null;
  const tooSmall = kind === "add" ? amount < minStakeZat : amount < CHIP_GRID_ZAT;
  const noRoom = kind === "add" && availableZat < minStakeZat;
  const share = stake > 0 ? Math.min(1, amount / stake) : 0;
  const realized = position.pnlZat === null ? null : zatToNumber(position.pnlZat * share);
  const chips = kind === "add" ? ADD_CHIPS : REDUCE_CHIPS;
  const asset = position.asset ?? "";

  return (
    <Sheet open={open} onClose={onClose} title={kind === "add" ? `Add to ${asset}` : `Reduce ${asset}`}>
      <div className="flex flex-col gap-4">
        <div className="flex items-baseline gap-2">
          <input
            type="number"
            inputMode="decimal"
            step={zatToNumber(CHIP_GRID_ZAT)}
            value={zatToNumber(amount)}
            onChange={(e) => setAmount(Math.max(0, Math.min(max, onGrid(Number(e.target.value) * ZAT_PER_ZEC))))}
            className="numbers w-full bg-transparent font-display text-page-title outline-none"
            aria-label={`Amount, ${coin}`}
          />
          <span className="shrink-0 text-meta text-muted-foreground">{coin}</span>
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(max, CHIP_GRID_ZAT)}
          step={CHIP_GRID_ZAT}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          className="w-full accent-[var(--up)]"
          aria-label="Amount slider"
        />
        <div className="grid grid-flow-col gap-2">
          {chips.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                tap();
                setAmount(onGrid(max * c));
              }}
              className={cx(
                "h-9 rounded-full text-chip-label",
                Math.abs(amount - onGrid(max * c)) < CHIP_GRID_ZAT ? "kk-up-solid" : "bg-secondary",
              )}
            >
              {c === 1 ? "Max" : `${c * PERCENT}%`}
            </button>
          ))}
        </div>
        <div className="rounded-group bg-secondary/60 p-4 text-meta">
          <p className="mb-2 font-bold text-muted-foreground">After this order</p>
          <dl className="grid grid-cols-2 gap-y-1.5">
            <dt className="text-muted-foreground">Staked</dt>
            <dd className="numbers text-right">
              <span className="text-muted-foreground line-through">{zecText(stake)}</span> →{" "}
              {zecText(kind === "add" ? stake + amount : stake - amount)} {coin}
            </dd>
            {kind === "add" ? (
              <>
                <dt className="text-muted-foreground">Pays</dt>
                <dd className="numbers text-right">
                  {askE4 ? `${multipleOf(askE4)} · ${zecText(sidePayoutZat(amount, askE4))} ${coin}` : "—"}
                </dd>
              </>
            ) : (
              <>
                <dt className="text-muted-foreground">Realized PnL</dt>
                <dd className={cx("numbers text-right", (realized ?? 0) >= 0 ? "text-up" : "text-down")}>
                  {realized === null ? "—" : `${livePnlText(realized)} ${coin}`}
                </dd>
              </>
            )}
          </dl>
          {kind === "reduce" && position.record.state === "armed" ? (
            <p className="mt-2 text-muted-foreground">The exit stays armed on the rest.</p>
          ) : null}
        </div>
        {blocked ? (
          <p className="text-meta text-muted-foreground">{blocked}</p>
        ) : tooSmall ? (
          <p className="text-meta text-down">
            Minimum {zecText(kind === "add" ? minStakeZat : CHIP_GRID_ZAT)} {coin}.
          </p>
        ) : noRoom ? (
          <p className="text-meta text-down">Not enough chips to add.</p>
        ) : null}
        <button
          type="button"
          disabled={blocked !== null || tooSmall || noRoom}
          onClick={() => {
            if (kind === "add") onAdd(position, amount);
            else onReduce(position, Math.max(1, Math.round(share * BPS)));
            onClose();
          }}
          className={cx(
            "h-14 w-full rounded-full text-[1.0625rem] font-extrabold tracking-[0.12em] disabled:opacity-40",
            kind === "add" ? "kk-up-soft" : "kk-down-soft",
          )}
        >
          {kind === "add" ? `ADD ${zecText(amount)}` : `REDUCE ${zecText(amount)}`}
        </button>
      </div>
    </Sheet>
  );
}
