"use client";

import { type Network, TICKET_SIZES_ZAT, type Trading, zatToZec } from "@kakure/domain";
import { Button, Chip, ChipGroup, Sheet, SlideToConfirm } from "@kakure/ui-web";
import { Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { NETWORK_COIN } from "@/constants";
import { MINT_CODES, MintError } from "./api";
import { withdraw, withdrawable } from "./spending";
import { useWallet } from "./wallet-store";
import { useWithdrawAddress, WithdrawAddressField } from "./withdraw-address";

/**
 * Withdraw (plan §00): chips back to a fresh shielded address. The mint marks the chips spent and schedules the
 * payout as canonical notes at random times within 30 minutes, so the payout's timing and amounts don't point back
 * at a trade or at this request. The address is checked on this device before anything is sent.
 */
const SECONDS_PER_MINUTE = 60;

type Amount = { kind: "size"; zat: number } | { kind: "all" };

export function WithdrawSheet({
  open,
  onClose,
  network,
  trading,
}: {
  open: boolean;
  onClose: () => void;
  network: Network;
  trading: Trading;
}) {
  const coin = NETWORK_COIN[network];
  const wallet = useWallet(network);
  const address = useWithdrawAddress(network);
  const [amount, setAmount] = useState<Amount>({ kind: "all" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduled, setScheduled] = useState<{ amountZat: string; withinSecs: number } | null>(null);
  // A fresh slider after a failed attempt (it stays committed otherwise).
  const [attempt, setAttempt] = useState(0);

  const { setValue } = address;
  useEffect(() => {
    if (open) {
      setScheduled(null);
      setError(null);
      setValue("");
    }
  }, [open, setValue]);

  const minZat = Number(trading.minWithdrawZat);
  const minText = `${zatToZec(BigInt(minZat))} ${coin}`;
  const sizes = TICKET_SIZES_ZAT.map(Number).filter((zat) => zat >= minZat && zat <= wallet.balanceZat);
  const all = withdrawable(wallet.balanceZat);
  const zat = amount.kind === "all" ? all : amount.zat;
  const ready = address.verdict === "ok" && zat >= minZat && zat <= wallet.balanceZat && !busy;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      setScheduled(await withdraw(network, trading, zat, address.value.trim()));
    } catch (e) {
      setError(
        e instanceof MintError
          ? e.code === MINT_CODES.badAddress
            ? `The mint refused that address: ${e.message}.`
            : e.code === MINT_CODES.tooSmall
              ? `Withdrawals start at ${minText}.`
              : e.code === MINT_CODES.alreadySpent
                ? "Some of these chips were already spent (by another device with this backup). Your balance is updated."
                : e.refused
                  ? e.message
                  : "Can't reach the mint right now. Nothing was lost: it finishes the next time you open your wallet."
          : e instanceof Error
            ? e.message
            : "The withdrawal didn't go through.",
      );
      setAttempt((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  if (scheduled) {
    return (
      <Sheet open={open} onClose={onClose} title="Withdrawal scheduled">
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <Clock aria-hidden className="size-12 text-foreground" />
          <p className="font-display text-title text-foreground">
            {zatToZec(BigInt(scheduled.amountZat))} {coin} on its way
          </p>
          <p className="text-row-detail text-muted-foreground">
            It arrives as a few shielded notes at random times within{" "}
            {Math.round(scheduled.withinSecs / SECONDS_PER_MINUTE)} minutes, so nothing about its timing or amounts
            points back at your trades.
          </p>
          <Button size="lg" className="w-full" onClick={onClose}>
            Done
          </Button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title="Withdraw">
      <div className="flex flex-col gap-5">
        {wallet.balanceZat < minZat ? (
          <p className="text-row-detail text-muted-foreground">
            Withdrawals start at {minText}. You hold {zatToZec(BigInt(wallet.balanceZat))} {coin} in chips.
          </p>
        ) : (
          <>
            <ChipGroup label="Amount">
              <Chip selected={amount.kind === "all"} onClick={() => setAmount({ kind: "all" })}>
                All · {zatToZec(BigInt(all))} {coin}
              </Chip>
              {sizes.map((size) => (
                <Chip
                  key={size}
                  selected={amount.kind === "size" && amount.zat === size}
                  onClick={() => setAmount({ kind: "size", zat: size })}
                >
                  {zatToZec(BigInt(size))} {coin}
                </Chip>
              ))}
            </ChipGroup>
            <WithdrawAddressField state={address} network={network} />
            {error ? (
              <p role="alert" className="text-row-detail text-destructive">
                {error}
              </p>
            ) : null}
            {ready ? (
              <SlideToConfirm
                key={attempt}
                label={`Slide to withdraw ${zatToZec(BigInt(zat))} ${coin}`}
                hint="Spends your chips and schedules a shielded payout"
                onConfirm={() => void submit()}
              />
            ) : (
              <Button size="lg" className="w-full" disabled>
                {busy ? "Withdrawing…" : `Withdraw ${zatToZec(BigInt(zat))} ${coin}`}
              </Button>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
