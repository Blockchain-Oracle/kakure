"use client";

import { cadenceLabel, parseWindowId, SLIPPAGE_CHOICES_BPS } from "@kakure/domain";
import { fire, MUSIC_TRACK_NAMES } from "@kakure/sounds";
import { cx, Mark, RollingNumber, Sheet } from "@kakure/ui-web";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Download,
  History,
  Layers,
  type LucideIcon,
  Play,
  Settings,
  Share2,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { assetFor } from "@/features/markets/assets";
import { setPrefs, usePrefs } from "@/features/settings/prefs-store";
import { KakureMark } from "@/features/shell/brand";
import { bandSideOf, type PositionRecord, upDownOf } from "@/features/wallet/records";
import { BPS, MUSIC_TRACKS, PERCENT } from "../constants";
import { bandText, livePnlText, sideWord, zatToNumber, zecText } from "../format";
import { setTradeSettings, useTradeSettings } from "../settings";

/**
 * The wallet sheet (Owarine's Account `sheets/AccountSheet.tsx`, Tradash's `ae`) for a device with no account: the
 * balance with today's P&L, Deposit, Withdraw and History, the Trading and App groups; its Settings (feedback, music,
 * close tolerance) and Trade history (this device's paid positions and partial closes, with stats).
 */
export type WalletView = "menu" | "settings" | "history";
const tap = () => fire("toggle", { haptic: "tick" });
const DAY_MS = 86_400_000;

export interface HistoryRow {
  id: string;
  asset: string;
  side: "U" | "D" | null;
  cadenceSec: number | null;
  parlay: boolean;
  /** A band in words ("Inside $81,250–$81,350"); null for anything else. */
  band: string | null;
  stakeZat: number;
  paidZat: number;
  pnlZat: number;
  at: number;
  tag: string;
}

const TAGS: Record<string, string> = {
  close: "CLOSED",
  redeem: "SETTLED",
  settled: "SETTLED",
  trail: "TRAIL",
  stop: "STOP",
  takeProfit: "TP",
};

/** Paid positions and partial closes on this device, newest first. */
export function historyOf(records: readonly PositionRecord[]): HistoryRow[] {
  const rows: HistoryRow[] = [];
  for (const r of records) {
    const cert = r.certificate;
    if (!cert) continue;
    const parsed = cert.window ? parseWindowId(cert.window) : null;
    const bandSide = bandSideOf(cert);
    const base = {
      asset: parsed?.lane.asset ?? "",
      side: upDownOf(cert),
      cadenceSec: parsed?.lane.cadenceSec ?? null,
      parlay: cert.kind === "parlay",
      band: bandSide
        ? bandText({ lo: cert.lo ? Number(cert.lo) : null, hi: cert.hi ? Number(cert.hi) : null, side: bandSide })
        : null,
    };
    for (const [i, cut] of (r.reductions ?? []).entries()) {
      const paid = Number(cut.paidZat);
      const stake = Number(cut.stakeZat);
      rows.push({
        ...base,
        id: `${r.key}:r${i}`,
        stakeZat: stake,
        paidZat: paid,
        pnlZat: paid - stake,
        at: cut.at,
        tag: "REDUCE",
      });
    }
    if (r.state === "paid") {
      const paid = Number(r.paidZat ?? 0);
      const stake = Number(cert.stakeZat);
      const tag = cert.kind === "parlay" ? "PARLAY" : (TAGS[r.how ?? ""] ?? "CLOSED");
      rows.push({
        ...base,
        id: r.key,
        stakeZat: stake,
        paidZat: paid,
        pnlZat: paid - stake,
        at: r.paidAt ?? r.createdAt,
        tag,
      });
    }
  }
  return rows.sort((a, b) => b.at - a.at);
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="px-1 text-[0.6875rem] font-bold tracking-[0.1em] text-muted-foreground">{title}</span>
      <div className="overflow-hidden rounded-group bg-secondary/60">{children}</div>
    </div>
  );
}

const ITEM = "flex h-12 w-full items-center gap-3 border-b border-border px-4 last:border-b-0 hover:bg-secondary";

function Item({
  icon: Icon,
  label,
  onClick,
  href,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  href?: string;
}) {
  const body = (
    <>
      <Icon aria-hidden className="size-5 text-muted-foreground" />
      <span className="flex-1 text-left text-row">{label}</span>
      <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
    </>
  );
  return href ? (
    <Link href={href} className={ITEM} onClick={tap}>
      {body}
    </Link>
  ) : (
    <button
      type="button"
      className={ITEM}
      onClick={() => {
        tap();
        onClick?.();
      }}
    >
      {body}
    </button>
  );
}

function Toggle({
  label,
  sub,
  on,
  onChange,
}: {
  label: string;
  sub?: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => {
        tap();
        onChange(!on);
      }}
      className="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left last:border-b-0"
    >
      <span className="flex-1">
        <span className="block text-row">{label}</span>
        {sub ? <span className="block text-meta text-muted-foreground">{sub}</span> : null}
      </span>
      <span className={cx("relative h-7 w-12 rounded-full transition-colors", on ? "bg-up" : "bg-border")}>
        <span
          className={cx("absolute top-1 size-5 rounded-full bg-stage transition-[left]", on ? "left-6" : "left-1")}
        />
      </span>
    </button>
  );
}

export function WalletSheet({
  open,
  onClose,
  initialView,
  coin,
  equity,
  chipsZat,
  openValueZat,
  unrealizedZat,
  records,
  onDeposit,
  onWithdraw,
  onTour,
  onInstall,
  onShare,
  onReplay,
  canReplay,
}: {
  open: boolean;
  onClose: () => void;
  initialView: WalletView;
  coin: string;
  equity: string | null;
  chipsZat: number;
  openValueZat: number;
  unrealizedZat: number;
  records: readonly PositionRecord[];
  onDeposit: () => void;
  onWithdraw: () => void;
  onTour: () => void;
  onInstall: () => void;
  onShare: (row: HistoryRow) => void;
  onReplay?: (row: HistoryRow) => void;
  canReplay?: (row: HistoryRow) => boolean;
}) {
  const [view, setView] = useState<WalletView>(initialView);
  const [viewFor, setViewFor] = useState(initialView);
  if (viewFor !== initialView) {
    setViewFor(initialView);
    setView(initialView);
  }
  const settings = useTradeSettings();
  const prefs = usePrefs();
  const rows = historyOf(records);
  const since = Date.now() - DAY_MS;
  const today = rows.filter((r) => r.at >= since).reduce((s, r) => s + r.pnlZat, 0) + unrealizedZat;
  const title = view === "settings" ? "Settings" : view === "history" ? "Trade history" : "Wallet";

  return (
    <Sheet
      open={open}
      onClose={() => {
        onClose();
        setView("menu");
      }}
      title={title}
    >
      {view !== "menu" ? (
        <button
          type="button"
          onClick={() => setView("menu")}
          className="mb-3 flex items-center gap-1 text-meta text-muted-foreground"
        >
          <ChevronLeft aria-hidden className="size-4" /> Wallet
        </button>
      ) : null}
      {view === "menu" ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col items-center gap-3 pt-2">
            <span className="grid size-24 place-items-center rounded-full bg-primary text-primary-foreground">
              <KakureMark className="size-14" />
            </span>
            <span className="text-row-strong">This device</span>
            <span className="text-meta text-muted-foreground">No account: your chips live only here, encrypted.</span>
          </div>
          <div className="rounded-group bg-secondary/60 p-4">
            <p className="numbers font-display text-page-title">
              {equity === null ? "—" : <RollingNumber value={`${equity} ${coin}`} />}
            </p>
            <p className="text-meta text-muted-foreground">
              Today&rsquo;s P&amp;L{" "}
              <span className={cx("numbers font-semibold", today >= 0 ? "text-up" : "text-down")}>
                {livePnlText(zatToNumber(today))} {coin}
              </span>
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-group bg-card p-3">
                <p className="text-[0.6875rem] text-muted-foreground">Chips</p>
                <p className="numbers text-row-strong">{zecText(chipsZat)}</p>
              </div>
              <div className="rounded-group bg-card p-3">
                <p className="text-[0.6875rem] text-muted-foreground">In positions</p>
                <p className="numbers text-row-strong">{zecText(openValueZat)}</p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                [ArrowDownToLine, "Deposit", onDeposit],
                [ArrowUpFromLine, "Withdraw", onWithdraw],
                [History, "History", () => setView("history")],
              ] as const
            ).map(([Icon, label, act]) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  tap();
                  act();
                }}
                className="flex flex-col items-center gap-1.5"
              >
                <span className="grid size-12 place-items-center rounded-full border border-border">
                  <Icon aria-hidden className="size-5" />
                </span>
                <span className="text-[0.6875rem] text-muted-foreground">{label}</span>
              </button>
            ))}
          </div>
          <Group title="TRADING">
            <Item icon={History} label="Trade history" onClick={() => setView("history")} />
            <Item icon={Settings} label="Settings" onClick={() => setView("settings")} />
            <Item icon={Wallet} label="Portfolio" href="/portfolio" />
          </Group>
          <Group title="APP">
            <Item icon={CircleHelp} label="How it works" onClick={onTour} />
            <Item icon={Download} label="Install app" onClick={onInstall} />
          </Group>
        </div>
      ) : view === "settings" ? (
        <div className="flex flex-col gap-4">
          <Group title="FEEDBACK">
            <Toggle label="Sound effects" on={prefs.sound} onChange={(v) => setPrefs({ sound: v })} />
            <Toggle label="Haptics" on={prefs.haptics} onChange={(v) => setPrefs({ haptics: v })} />
            <Toggle
              label="Trade reactions"
              sub="Callouts on the chart as your trade moves"
              on={settings.reactionsEnabled}
              onChange={(v) => setTradeSettings({ reactionsEnabled: v })}
            />
          </Group>
          <Group title="MUSIC">
            <Toggle label="Music" on={settings.musicEnabled} onChange={(v) => setTradeSettings({ musicEnabled: v })} />
            <div className="flex gap-2 p-3">
              {MUSIC_TRACKS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    tap();
                    setTradeSettings({ musicTrack: t });
                  }}
                  className={cx(
                    "h-9 flex-1 rounded-full text-chip-label",
                    settings.musicTrack === t ? "kk-up-solid" : "bg-card",
                  )}
                >
                  {MUSIC_TRACK_NAMES[t]}
                </button>
              ))}
            </div>
          </Group>
          <Group title="CLOSE TOLERANCE">
            <p className="px-4 pt-3 text-meta text-muted-foreground">
              How far the price may move between your tap and the fill before a trade or a close is refused.
            </p>
            <div className="grid grid-cols-4 gap-2 p-3">
              {SLIPPAGE_CHOICES_BPS.map((bps) => (
                <button
                  key={bps}
                  type="button"
                  onClick={() => {
                    tap();
                    setTradeSettings({ slippageBps: bps });
                  }}
                  className={cx(
                    "h-9 rounded-full text-chip-label",
                    settings.slippageBps === bps ? "kk-up-solid" : "bg-card",
                  )}
                >
                  {(bps / (BPS / PERCENT)).toFixed(bps < BPS / PERCENT ? 1 : 0)}%
                </button>
              ))}
            </div>
          </Group>
        </div>
      ) : (
        <HistoryList rows={rows} coin={coin} onShare={onShare} onReplay={onReplay} canReplay={canReplay} />
      )}
    </Sheet>
  );
}

export function HistoryList({
  rows,
  coin,
  onShare,
  onReplay,
  canReplay,
}: {
  rows: readonly HistoryRow[];
  coin: string;
  onShare: (row: HistoryRow) => void;
  /** Plays a row's recording; rows without a replayable one get no button. */
  onReplay?: ((row: HistoryRow) => void) | null | undefined;
  canReplay?: ((row: HistoryRow) => boolean) | undefined;
}) {
  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-row text-muted-foreground">Nothing closed or settled on this device yet.</p>
    );
  }
  const realized = rows.reduce((s, r) => s + r.pnlZat, 0);
  const wins = rows.filter((r) => r.pnlZat > 0).length;
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-3 gap-2">
        {(
          [
            ["Trades", String(rows.length)],
            ["Win rate", `${Math.round((wins / rows.length) * PERCENT)}%`],
            ["Realized", `${livePnlText(zatToNumber(realized))}`],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="rounded-group bg-secondary/60 p-3">
            <dt className="text-[0.6875rem] text-muted-foreground">{k}</dt>
            <dd
              className={cx("numbers text-row-strong", k === "Realized" && (realized >= 0 ? "text-up" : "text-down"))}
            >
              {v}
            </dd>
          </div>
        ))}
      </dl>
      <ul className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 rounded-group bg-card p-3">
            {r.parlay ? (
              <span className="grid size-8 place-items-center rounded-full bg-secondary">
                <Layers aria-hidden className="size-4" />
              </span>
            ) : (
              <Mark mark={assetFor({ kind: "close", subject: r.asset }).mark} label={r.asset} size="token" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-row-strong">
                {r.parlay
                  ? "Parlay"
                  : r.band
                    ? `${r.asset} · ${r.band}`
                    : `${r.asset} ${r.side ? sideWord(r.side) : ""}`}
                {r.cadenceSec ? ` · ${cadenceLabel(r.cadenceSec)}` : ""}
              </span>
              <span className="block text-[0.6875rem] text-muted-foreground">
                <span className="rounded-full bg-secondary px-1.5 font-bold">{r.tag}</span>{" "}
                {new Date(r.at).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </span>
            <span className={cx("numbers text-row-strong", r.pnlZat >= 0 ? "text-up" : "text-down")}>
              {livePnlText(zatToNumber(r.pnlZat))} {coin}
            </span>
            {onReplay && canReplay?.(r) ? (
              <button
                type="button"
                aria-label="Replay"
                onClick={() => onReplay(r)}
                className="grid size-7 place-items-center rounded-full text-muted-foreground hover:text-foreground"
              >
                <Play aria-hidden className="size-4" />
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Share"
              onClick={() => onShare(r)}
              className="grid size-7 place-items-center rounded-full text-muted-foreground hover:text-foreground"
            >
              <Share2 aria-hidden className="size-4" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
