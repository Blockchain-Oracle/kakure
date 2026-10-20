"use client";

import type { LaneAsset, Network, Trading } from "@kakure/domain";
import { Sheet } from "@kakure/ui-web";
import { useState } from "react";
import { DepositSheet } from "@/features/wallet/deposit-sheet";
import type { PositionRecord } from "@/features/wallet/records";
import { WithdrawSheet } from "@/features/wallet/withdraw-sheet";
import { zatToNumber } from "./format";
import type { LivePosition, Totals } from "./positions";
import { episodeFor, replayable, useEpisodes } from "./replay";
import { setTradeSettings } from "./settings";
import { ShareSheet } from "./share/share-sheet";
import { AdjustSheet } from "./sheets/adjust-sheet";
import { ExitSheet } from "./sheets/exit-sheet";
import { InstallSheet } from "./sheets/install-sheet";
import { MarketsSheet } from "./sheets/markets-sheet";
import { ReplaySheet } from "./sheets/replay-sheet";
import { SettingsSheet } from "./sheets/settings-sheet";
import { Tutorial } from "./sheets/tutorial";
import { type HistoryRow, WalletSheet } from "./sheets/wallet-sheet";
import { PositionsList, type RowActions, UnrealizedCard } from "./ui/positions-panel";

/**
 * Every sheet over the chart (Owarine `ui/TerminalSheets.tsx`; Tradash: every secondary page is a sheet), one open at
 * a time. A sheet mounts the first time it opens and stays mounted so it can animate closed.
 */
export type SheetName =
  | "markets"
  | "settings"
  | "wallet"
  | "history"
  | "wallet-settings"
  | "positions"
  | "add"
  | "reduce"
  | "exits"
  | "share"
  | "tutorial"
  | "deposit"
  | "withdraw"
  | "parlay"
  | "replay"
  | "install";

export interface SheetsProps {
  open: SheetName | null;
  onClose: () => void;
  onOpen: (name: SheetName) => void;
  network: Network;
  trading: Trading | null;
  asset: LaneAsset;
  coin: string;
  target: LivePosition | null;
  positions: readonly LivePosition[];
  records: readonly PositionRecord[];
  totals: Totals;
  references: ReadonlyMap<string, string>;
  nowSec: number;
  spot: number | null;
  chipsZat: number;
  equity: string | null;
  stakeZat: number;
  minStakeZat: number;
  maxStakeZat: number;
  upAskE4: number | null;
  downAskE4: number | null;
  targetAskE4: number | null;
  line: number | null;
  closeSec: number | null;
  slippageBps: number;
  closingAll: boolean;
  onCloseAll: () => void;
  onPickAsset: (asset: LaneAsset) => void;
  actions: RowActions;
  onAdd: (p: LivePosition, stakeZat: number) => void;
  onReduce: (p: LivePosition, fractionBps: number) => void;
  /** The newest deposit still arriving: Deposit picks it back up instead of starting another. */
  arrivingDeposit: string | null;
}

export function TerminalSheets(props: SheetsProps) {
  const { open, onClose, onOpen, target } = props;
  const [seen, setSeen] = useState<ReadonlySet<SheetName>>(() => new Set(open ? [open] : []));
  if (open && !seen.has(open)) setSeen(new Set([...seen, open]));
  const was = (...names: SheetName[]) => names.some((n) => seen.has(n));
  const [shareRow, setShareRow] = useState<HistoryRow | null>(null);
  const [replayRow, setReplayRow] = useState<HistoryRow | null>(null);
  const episodes = useEpisodes(props.network);
  const replayOf = (row: HistoryRow) => {
    const e = episodeFor(episodes, row.id);
    return e && replayable(e) ? e : null;
  };
  const fresh = target ? (props.positions.find((p) => p.key === target.key) ?? null) : null;
  const walletView = open === "history" ? "history" : open === "wallet-settings" ? "settings" : "menu";
  const openValueZat = props.positions.reduce((s, p) => s + (p.valueZat ?? 0), 0);

  return (
    <>
      {was("markets") ? (
        <MarketsSheet open={open === "markets"} onClose={onClose} current={props.asset} onPick={props.onPickAsset} />
      ) : null}
      {was("settings") ? (
        <SettingsSheet
          open={open === "settings"}
          onClose={onClose}
          asset={props.asset}
          coin={props.coin}
          availableZat={props.chipsZat}
          stakeZat={props.stakeZat}
          minZat={props.minStakeZat}
          maxStakeZat={props.maxStakeZat}
          upAskE4={props.upAskE4}
          downAskE4={props.downAskE4}
          line={props.line}
          closeSec={props.closeSec}
        />
      ) : null}
      {was("wallet", "history", "wallet-settings") ? (
        <WalletSheet
          open={open === "wallet" || open === "history" || open === "wallet-settings"}
          onClose={onClose}
          initialView={walletView}
          coin={props.coin}
          equity={props.equity}
          chipsZat={props.chipsZat}
          openValueZat={openValueZat}
          unrealizedZat={props.totals.pnlZat}
          records={props.records}
          onDeposit={() => onOpen("deposit")}
          onWithdraw={() => onOpen("withdraw")}
          onTour={() => onOpen("tutorial")}
          onInstall={() => onOpen("install")}
          onShare={(row) => {
            setShareRow(row);
            onOpen("share");
          }}
          onReplay={(row) => {
            setReplayRow(row);
            onOpen("replay");
          }}
          canReplay={(row) => replayOf(row) !== null}
        />
      ) : null}
      {was("positions") ? (
        <Sheet open={open === "positions"} onClose={onClose} title="Open positions">
          <div className="flex flex-col gap-3">
            <UnrealizedCard
              totals={props.totals}
              coin={props.coin}
              closable={props.positions.filter((p) => p.status === "priced" && p.kind === "single").length}
              onCloseAll={props.onCloseAll}
              closingAll={props.closingAll}
            />
            <PositionsList
              positions={props.positions}
              nowSec={props.nowSec}
              coin={props.coin}
              references={props.references}
              actions={props.actions}
            />
          </div>
        </Sheet>
      ) : null}
      {was("add", "reduce") ? (
        <AdjustSheet
          open={open === "add" || open === "reduce"}
          onClose={onClose}
          kind={open === "reduce" ? "reduce" : "add"}
          position={fresh}
          coin={props.coin}
          availableZat={props.chipsZat}
          minStakeZat={props.minStakeZat}
          askE4={props.targetAskE4}
          onAdd={props.onAdd}
          onReduce={props.onReduce}
        />
      ) : null}
      {was("exits") ? (
        <ExitSheet
          open={open === "exits"}
          onClose={onClose}
          position={fresh}
          spot={props.spot}
          coin={props.coin}
          network={props.network}
          trading={props.trading}
          slippageBps={props.slippageBps}
        />
      ) : null}
      {was("share") ? <ShareSheet open={open === "share"} onClose={onClose} row={shareRow} /> : null}
      {was("replay") ? (
        <ReplaySheet
          open={open === "replay"}
          onClose={onClose}
          episode={replayRow ? replayOf(replayRow) : null}
          finalPnl={replayRow ? zatToNumber(replayRow.pnlZat) : null}
          coin={props.coin}
          onShare={() => {
            setShareRow(replayRow);
            onOpen("share");
          }}
        />
      ) : null}
      {was("install") ? <InstallSheet open={open === "install"} onClose={onClose} /> : null}
      {was("tutorial") ? (
        <Tutorial
          open={open === "tutorial"}
          network={props.network}
          onDone={(choice) => {
            setTradeSettings({ tutorialSeen: true });
            if (choice === "deposit") onOpen("deposit");
            else onClose();
          }}
        />
      ) : null}
      {props.trading && was("deposit") ? (
        <DepositSheet
          open={open === "deposit"}
          onClose={onClose}
          network={props.network}
          trading={props.trading}
          resume={props.arrivingDeposit}
        />
      ) : null}
      {props.trading && was("withdraw") ? (
        <WithdrawSheet open={open === "withdraw"} onClose={onClose} network={props.network} trading={props.trading} />
      ) : null}
    </>
  );
}
