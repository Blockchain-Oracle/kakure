"use client";

import { formatPrice } from "@kakure/chart";
import { cadenceLabel, PRICE_SCALE_E4, PRICE_SCALE_E8, parseWindowId } from "@kakure/domain";
import { cx, Mark, RollingNumber } from "@kakure/ui-web";
import {
  ArrowDownRight,
  ArrowUpRight,
  CandlestickChart,
  ChevronDown,
  Layers,
  LoaderCircle,
  Lock,
  Minus,
  MoveHorizontal,
  Plus,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { assetFor } from "@/features/markets/assets";
import type { ExitPlan } from "@/features/wallet/records";
import { PERCENT } from "../constants";
import {
  bandText,
  centsOf,
  clockText,
  livePnlText,
  multipleOf,
  sideWord,
  signedPct,
  zatToNumber,
  zecText,
} from "../format";
import type { LivePosition, Totals } from "../positions";

/**
 * Open positions (Owarine `ui/PositionsPanel.tsx`): the Unrealized card (Close all when more than one), and a row per
 * position with its ROI and PnL rolling, expanding to its details and Add, Reduce and TP / SL. Parlays are marked at
 * fair value and can't be sold back. A position with no bid is shown as locked, never as zero.
 */
const markOf = (asset: string) => assetFor({ kind: "close", subject: asset }).mark;

export function UnrealizedCard({
  totals,
  coin,
  closable,
  onCloseAll,
  closingAll,
}: {
  totals: Totals;
  coin: string;
  closable: number;
  onCloseAll: () => void;
  closingAll: boolean;
}) {
  const pnl = zatToNumber(totals.pnlZat);
  const pct = totals.stakeZat > 0 ? (totals.pnlZat / totals.stakeZat) * PERCENT : 0;
  const allUnpriced = totals.count > 0 && totals.unpriced === totals.count;
  const riding = totals.unpriced - totals.settling;
  const why = [
    riding > 0 ? `${riding} riding to the close` : null,
    totals.settling > 0 ? `${totals.settling} settling` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <div className="rounded-group bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-meta text-muted-foreground">Unrealized PnL</span>
        {closable > 1 ? (
          <button
            type="button"
            onClick={onCloseAll}
            disabled={closingAll}
            className="kk-down-soft flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.6875rem] font-bold"
          >
            {closingAll ? <LoaderCircle aria-hidden className="size-3.5 motion-safe:animate-spin" /> : null}
            {closingAll ? "Closing…" : `Close all (${closable})`}
          </button>
        ) : null}
      </div>
      {allUnpriced ? (
        <>
          <p className="mt-1 font-display text-title text-muted-foreground">—</p>
          <p className="text-meta text-muted-foreground">No live value · {why}</p>
        </>
      ) : (
        <>
          <p className={cx("numbers mt-1 font-display text-title", pnl >= 0 ? "text-up" : "text-down")}>
            <RollingNumber value={`${livePnlText(pnl)} ${coin}`} />
          </p>
          {totals.count > 0 ? (
            <span className="flex items-center gap-1.5 text-meta">
              <span className={cx("numbers", pct >= 0 ? "text-up" : "text-down")}>
                <RollingNumber value={signedPct(pct)} />
              </span>
              {totals.unpriced > 0 ? <span className="text-muted-foreground">· {why}</span> : null}
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}

export interface RowActions {
  onAdd: (p: LivePosition) => void;
  onReduce: (p: LivePosition) => void;
  onExits: (p: LivePosition) => void;
  /** Sells a band back at the bid (a single's Close is the terminal's big button). */
  onSell?: (p: LivePosition) => void;
}

export function PositionsList({
  positions,
  nowSec,
  coin,
  references,
  actions,
}: {
  positions: readonly LivePosition[];
  nowSec: number;
  coin: string;
  /** Each Window's reference (the Line), by id. */
  references: ReadonlyMap<string, string>;
  actions: RowActions;
}) {
  if (positions.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-group bg-card p-6 text-muted-foreground">
        <CandlestickChart aria-hidden className="size-10" strokeWidth={1.5} />
        <span className="text-row">No open positions</span>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
      <span className="px-1 text-[0.6875rem] font-bold tracking-[0.12em] text-muted-foreground">POSITIONS</span>
      {positions.map((p) =>
        p.kind === "parlay" ? (
          <ParlayRow key={p.key} p={p} coin={coin} nowSec={nowSec} />
        ) : (
          <PositionRow key={p.key} p={p} coin={coin} nowSec={nowSec} references={references} actions={actions} />
        ),
      )}
    </div>
  );
}

function statusLine(p: LivePosition): string | null {
  switch (p.status) {
    case "buying":
      return "Buying… saved on this device";
    case "locked":
      return "Locked · rides to the close";
    case "settling":
      return "Settling · pays as chips once the prints are in";
    case "unpriced":
      return "Live value unavailable";
    default:
      return null;
  }
}

function exitWords(exit: ExitPlan | undefined): string | null {
  if (!exit) return null;
  const parts: string[] = [];
  if (exit.trail) parts.push(`trail ${((exit.trail.bps / PRICE_SCALE_E4) * PERCENT).toFixed(2)}%`);
  if (exit.stop) parts.push(`stop $${formatPrice(exit.stop.price)}`);
  if (exit.takeProfit) parts.push(`take ${centsOf(exit.takeProfit.bidE4)}`);
  return parts.length ? parts.join(" · ") : null;
}

function PositionRow({
  p,
  coin,
  nowSec,
  references,
  actions,
}: {
  p: LivePosition;
  coin: string;
  nowSec: number;
  references: ReadonlyMap<string, string>;
  actions: RowActions;
}) {
  const [open, setOpen] = useState(false);
  const asset = p.asset ?? "";
  const up = p.side === "U";
  const Dir = up ? ArrowUpRight : ArrowDownRight;
  const locked = p.status === "locked" || p.status === "settling";
  const canTrade = p.status === "priced";
  const line = p.window ? references.get(p.window.id) : undefined;
  const status = statusLine(p);
  const exit = exitWords(p.record.exit);
  const hasTpSl = Boolean(p.record.exit?.stop || p.record.exit?.takeProfit);
  return (
    <div className="rounded-group bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-3 text-left"
      >
        <Mark mark={markOf(asset)} label={asset} size="token" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1 text-row-strong">
            {asset || "…"}
            {p.band ? (
              <MoveHorizontal aria-hidden className="size-4 text-muted-foreground" strokeWidth={2.75} />
            ) : p.side ? (
              <Dir aria-hidden className={cx("size-4", up ? "text-up" : "text-down")} strokeWidth={2.75} />
            ) : null}
          </span>
          <span className="block truncate text-[0.6875rem] text-muted-foreground">
            {p.cadenceSec ? cadenceLabel(p.cadenceSec) : ""}
            {p.cadenceSec ? " · " : ""}
            {p.band ? `${bandText(p.band)} · ` : ""}
            {locked ? `settles ${clockText(p.settlesSec)}` : p.askE4 ? `pays ${multipleOf(p.askE4)}` : ""}
          </span>
          {status ? <span className="block text-[0.6875rem] text-muted-foreground">{status}</span> : null}
        </span>
        <span className="flex flex-col items-end">
          {p.roiPct !== null ? (
            <span className={cx("numbers text-row-strong", p.roiPct >= 0 ? "text-up" : "text-down")}>
              <RollingNumber value={signedPct(p.roiPct)} />
            </span>
          ) : locked ? (
            <Lock aria-label="Locked" className="size-4 text-muted-foreground" />
          ) : (
            <span className="text-row-strong text-muted-foreground">—</span>
          )}
          {p.pnlZat !== null ? (
            <span className={cx("numbers text-[0.6875rem] font-semibold", p.pnlZat >= 0 ? "text-up" : "text-down")}>
              {livePnlText(zatToNumber(p.pnlZat))}
            </span>
          ) : (
            <span className="text-[0.6875rem] text-muted-foreground">—</span>
          )}
        </span>
        <ChevronDown
          aria-hidden
          className={cx("size-4 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
      <div
        className={cx(
          "grid transition-[grid-template-rows] duration-200",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-3 pb-2 text-meta">
            {p.band ? (
              <Row k="Band" v={bandText(p.band)} />
            ) : (
              <Row
                k="Direction"
                v={
                  <span className={up ? "text-up" : "text-down"}>
                    {p.side ? `${sideWord(p.side)} / ${p.cadenceSec ? cadenceLabel(p.cadenceSec) : ""}` : "—"}
                  </span>
                }
              />
            )}
            <Row k="ROI" v={p.roiPct === null ? "—" : signedPct(p.roiPct)} />
            <Row k="Avg in" v={p.askE4 ? centsOf(p.askE4) : "—"} />
            <Row k="Now" v={p.bidE4 ? centsOf(p.bidE4) : "—"} />
            <Row k="Entry" v={p.record.entrySpot ? `$${formatPrice(p.record.entrySpot)}` : "—"} />
            {p.band ? null : (
              <Row k="Line" v={<span className="text-down">{line ? `$${formatPrice(Number(line))}` : "—"}</span>} />
            )}
            <Row k="Staked" v={`${zecText(p.stakeZat)} ${coin}`} />
            <Row k="Pays if right" v={`${zecText(p.payoutZat)} ${coin}`} />
            <Row k="Settles" v={`${clockText(p.settlesSec)}${p.settlesSec > nowSec ? "" : " · settling"}`} />
            {exit ? <Row k="Exit" v={exit} /> : null}
          </dl>
          {p.band ? (
            // A band sells back at its bid or rides; it has no Add and no exits (T5a contract).
            <div className="grid grid-cols-2 gap-2 px-3 pb-3">
              <ActionButton
                disabled={!canTrade || !actions.onSell}
                onClick={() => actions.onSell?.(p)}
                className="kk-down-soft"
              >
                Sell back
              </ActionButton>
              <ActionButton disabled={!canTrade} onClick={() => actions.onReduce(p)} className="bg-secondary">
                <Minus aria-hidden className="size-4" /> Reduce
              </ActionButton>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 px-3 pb-3">
              <ActionButton disabled={!canTrade} onClick={() => actions.onAdd(p)} className="kk-up-soft">
                <Plus aria-hidden className="size-4" /> Add
              </ActionButton>
              <ActionButton disabled={!canTrade} onClick={() => actions.onReduce(p)} className="bg-secondary">
                <Minus aria-hidden className="size-4" /> Reduce
              </ActionButton>
              <ActionButton disabled={!canTrade} onClick={() => actions.onExits(p)} className="bg-secondary">
                {hasTpSl ? "Edit TP / SL" : "TP / SL"}
              </ActionButton>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  disabled,
  onClick,
  className,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  className: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "flex h-9 items-center justify-center gap-1 rounded-full text-chip-label disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="numbers text-right">{v}</dd>
    </>
  );
}

/** A parlay: its legs and its mark at fair value (it can't be sold back; it pays when its last leg settles). */
function ParlayRow({ p, coin, nowSec }: { p: LivePosition; coin: string; nowSec: number }) {
  const legs = p.record.certificate?.legs ?? [];
  const priceE8 = p.record.certificate?.priceE8 ?? 0;
  return (
    <div className="rounded-group bg-card p-3">
      <div className="flex items-center gap-3">
        <span className="grid size-8 place-items-center rounded-full bg-secondary text-foreground">
          <Layers aria-hidden className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-row-strong">Parlay · {legs.length} legs</span>
          <span className="block text-[0.6875rem] text-muted-foreground">
            pays {multipleOf(priceE8 / (PRICE_SCALE_E8 / PRICE_SCALE_E4))} · {zecText(p.stakeZat)} {coin} · settles{" "}
            {clockText(p.settlesSec)}
          </span>
        </span>
        <span className="flex flex-col items-end">
          {p.roiPct !== null ? (
            <span className={cx("numbers text-row-strong", p.roiPct >= 0 ? "text-up" : "text-down")}>
              {signedPct(p.roiPct)}
            </span>
          ) : (
            <span className="text-row-strong text-muted-foreground">—</span>
          )}
          <span className="text-[0.6875rem] text-muted-foreground">at fair value</span>
        </span>
      </div>
      <ul className="mt-2 flex flex-col gap-1 pl-11">
        {legs.map((leg) => {
          const parsed = parseWindowId(leg.window);
          const asset = parsed?.lane.asset ?? "";
          return (
            <li key={leg.window} className="flex items-center gap-2 text-meta">
              <Mark mark={markOf(asset)} label={asset} size="inline" />
              <span>
                {asset} {sideWord(leg.side)} · {parsed ? cadenceLabel(parsed.lane.cadenceSec) : ""}
              </span>
              <span className="ml-auto text-muted-foreground">
                {leg.expiry > nowSec ? clockText(leg.expiry) : "settled"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
