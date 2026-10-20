"use client";

import { type Network, type Trading, zatToZec } from "@kakure/domain";
import { EmptyState, Pill } from "@kakure/ui-web";
import { ChevronRight, Coins, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { NETWORK_COIN } from "@/constants";
import { useRealtime } from "@/features/data/use-realtime";
import { UnlockForm } from "@/features/vault/unlock-form";
import { formatShortWhen, useNow } from "@/lib/time";
import { DepositSheet } from "./deposit-sheet";
import { MoneyCard } from "./money-card";
import type { DepositRecord } from "./records";
import { resumeWallet } from "./spending";
import { useWallet } from "./wallet-store";
import { WithdrawSheet } from "./withdraw-sheet";

/**
 * The wallet on the portfolio (plan §00 Portfolio: balance, deposit, withdraw): the money card, deposits still
 * arriving (tap to pick one up), and the deposit and withdraw sheets. On open, once the signed trading info is in, it
 * finishes whatever a closed tab left in flight and checks chips imported from a backup.
 */
type Open = { kind: "deposit"; resume: string | null } | { kind: "withdraw" } | null;

export function WalletSection() {
  const data = useRealtime();
  const network = data.network;
  const wallet = useWallet(network);
  const trading = data.status === "ready" ? (data.bundle.trading ?? null) : null;
  const [open, setOpen] = useState<Open>(null);

  const ready = wallet.status === "ready";
  const hasTrading = trading !== null;
  useEffect(() => {
    if (ready && trading) void resumeWallet(network, trading).catch(() => undefined);
    // Once per network and vault load, when trading info first arrives; a new bundle every minute needn't rerun it.
  }, [ready, hasTrading, network]);

  if (wallet.status === "locked") {
    return (
      <section className="flex flex-col gap-3 rounded-group border border-border bg-card p-5" aria-labelledby="vault">
        <h2 id="vault" className="font-display text-title text-foreground">
          Your vault is locked
        </h2>
        <p className="text-row-detail text-muted-foreground">
          Your chips and tickets are encrypted under your passphrase. Enter it to open them in this tab.
        </p>
        <UnlockForm />
      </section>
    );
  }
  if (wallet.status === "unavailable") {
    return (
      <EmptyState
        icon={<Wallet />}
        tone="warn"
        title="This browser can't open your vault"
        reason="Private windows and blocked site data stop IndexedDB, where your chips are kept. Open Kakure in a normal window."
      />
    );
  }

  const disabled =
    data.status === "ready"
      ? trading
        ? null
        : "Trading isn't published on this network yet."
      : "Loading the signed trading info…";
  const arriving = wallet.deposits.filter((deposit) => deposit.state !== "done");

  return (
    <>
      <MoneyCard
        network={network}
        wallet={wallet}
        disabled={disabled}
        onDeposit={() => setOpen({ kind: "deposit", resume: null })}
        onWithdraw={() => setOpen({ kind: "withdraw" })}
      />
      {arriving.length > 0 ? (
        <section className="flex flex-col gap-2" aria-labelledby="arriving">
          <h2 id="arriving" className="font-display text-title text-foreground">
            Arriving
          </h2>
          <ul className="flex flex-col gap-2">
            {arriving.map((deposit) => (
              <ArrivingRow
                key={deposit.key}
                network={network}
                deposit={deposit}
                onOpen={() => setOpen({ kind: "deposit", resume: deposit.key })}
                disabled={!trading}
              />
            ))}
          </ul>
        </section>
      ) : null}
      {trading ? <Sheets network={network} trading={trading} open={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function Sheets({
  network,
  trading,
  open,
  onClose,
}: {
  network: Network;
  trading: Trading;
  open: Open;
  onClose: () => void;
}) {
  return (
    <>
      <DepositSheet
        open={open?.kind === "deposit"}
        resume={open?.kind === "deposit" ? open.resume : null}
        onClose={onClose}
        network={network}
        trading={trading}
      />
      <WithdrawSheet open={open?.kind === "withdraw"} onClose={onClose} network={network} trading={trading} />
    </>
  );
}

function ArrivingRow({
  network,
  deposit,
  onOpen,
  disabled,
}: {
  network: Network;
  deposit: DepositRecord;
  onOpen: () => void;
  disabled: boolean;
}) {
  const now = useNow();
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        disabled={disabled}
        className="kk-press flex w-full items-center gap-3 rounded-group border border-border bg-card p-4 text-left outline-none hover:bg-row-pressed focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-foreground"
        >
          <Coins className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-row-strong text-foreground">
            Deposit · {zatToZec(BigInt(deposit.amountZat))} {NETWORK_COIN[network]}
          </span>
          <span className="block truncate text-meta text-muted-foreground">
            Started {formatShortWhen(new Date(deposit.createdAt).toISOString(), now)}
          </span>
        </span>
        <Pill tone={deposit.state === "minting" ? "accent" : "neutral"}>
          {deposit.state === "minting" ? "Minting" : "Waiting"}
        </Pill>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}
