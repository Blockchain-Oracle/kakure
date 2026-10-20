"use client";

import { type Network, TICKET_SIZES_ZAT, type Trading, zatToZec } from "@kakure/domain";
import { Button, Chip, ChipGroup, Sheet } from "@kakure/ui-web";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NETWORK_COIN } from "@/constants";
import { MintError } from "./api";
import { advanceDeposit, type DepositStep, depositUri, startDeposit } from "./deposits";
import { PayQr } from "./pay-qr";
import { useWallet } from "./wallet-store";

/**
 * Deposit (plan §00): pick an amount, pay it by QR from Zodl or Zingo, and watch it become chips. The deposit id is
 * drawn here and saved before the code appears; once the payment has its confirmations the mint signs blinded chips,
 * checked here against its published keys, and they land in this device's vault. Closing the sheet loses nothing:
 * the deposit stays listed and finishes the next time it's opened.
 */
const POLL_MS = 8_000;
const DEFAULT_SIZE = 10_000_000n;
/** The smallest chip, 0.001 ZEC (wallet-store CHIP_GRID_ZAT). */
const SMALLEST_CHIP_ZAT = 100_000;

export function DepositSheet({
  open,
  onClose,
  network,
  trading,
  resume,
}: {
  open: boolean;
  onClose: () => void;
  network: Network;
  trading: Trading;
  /** The id of an unfinished deposit to pick up where it left off. */
  resume?: string | null;
}) {
  const coin = NETWORK_COIN[network];
  const wallet = useWallet(network);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setKey(resume ?? null);
      setError(null);
    }
  }, [open, resume]);

  const record = key ? wallet.deposits.find((deposit) => deposit.key === key) : undefined;

  const begin = async () => {
    setBusy(true);
    setError(null);
    try {
      setKey((await startDeposit(network, trading, size)).key);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the deposit.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={record?.state === "done" ? "Deposited" : "Deposit"}>
      {!record ? (
        <div className="flex flex-col gap-5">
          <p className="text-row-detail text-muted-foreground">
            Pay from your own Zcash wallet. Your deposit becomes private chips on this device, ready to trade in a tap:
            the mint signs them blind, so it can't tell which chips came from this payment.
          </p>
          <ChipGroup label="Amount">
            {TICKET_SIZES_ZAT.map((zat) => (
              <Chip key={zat.toString()} selected={zat === size} onClick={() => setSize(zat)}>
                {zatToZec(zat)} {coin}
              </Chip>
            ))}
          </ChipGroup>
          {error ? <p className="text-row-detail text-destructive">{error}</p> : null}
          <Button size="lg" className="w-full" onClick={() => void begin()} disabled={busy || !trading.depositAddress}>
            {trading.depositAddress ? `Deposit ${zatToZec(size)} ${coin}` : "Deposits are paused"}
          </Button>
        </div>
      ) : record.state === "done" ? (
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <CheckCircle2 aria-hidden className="size-12 text-up" />
          <p className="font-display text-title text-foreground">
            {zatToZec(BigInt(record.mintedZat ?? record.amountZat))} {coin} in chips
          </p>
          <p className="text-row-detail text-muted-foreground">
            Blind-signed by the mint and checked here against its published keys. They live only on this device: keep a
            backup from Settings.
          </p>
          <Button size="lg" className="w-full" onClick={onClose}>
            Start trading
          </Button>
        </div>
      ) : (
        <PayStep network={network} trading={trading} depositKey={record.key} />
      )}
    </Sheet>
  );
}

function PayStep({ network, trading, depositKey }: { network: Network; trading: Trading; depositKey: string }) {
  const coin = NETWORK_COIN[network];
  const record = useWallet(network).deposits.find((deposit) => deposit.key === depositKey);
  const [step, setStep] = useState<DepositStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The bundle refreshes every minute; the loop reads the latest one without restarting.
  const latest = useRef(trading);
  latest.current = trading;

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const next = await advanceDeposit(network, latest.current, depositKey);
        if (!live) return;
        setError(null);
        setStep(next);
        if (next === "done") return;
      } catch (e) {
        if (!live) return;
        setError(
          e instanceof MintError && !e.refused
            ? "Can't reach the mint right now; retrying."
            : e instanceof Error
              ? e.message
              : "Something went wrong; retrying.",
        );
      }
      timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [network, depositKey]);

  if (!record) return null;
  const status =
    step === "minting" || record.state === "minting"
      ? "Minting your chips…"
      : step === null || step === "done" || step.state === "unseen"
        ? "Waiting for your payment…"
        : step.state === "confirming"
          ? `Seen on chain · ${Math.min(step.confirmations, step.needed)} of ${step.needed} confirmations`
          : Number(step.mintableZat) < SMALLEST_CHIP_ZAT
            ? `Received ${zatToZec(BigInt(step.receivedZat))} ${coin}, below the smallest chip (0.001 ${coin}), so nothing can be minted from it.`
            : "Confirmed · minting your chips…";

  return (
    <div className="flex flex-col gap-5">
      <PayQr
        uri={depositUri(record, trading)}
        caption={
          <>
            Pay exactly {zatToZec(BigInt(record.amountZat))} {coin} from Zodl or Zingo. The memo is already in the code;
            don't edit it.
          </>
        }
        warning="This code carries your deposit's id: whoever has it could claim the chips. It's built here, never sent anywhere, and hides when you look away. Don't screenshot or share it."
      />
      <div
        role="status"
        className="flex items-center gap-3 rounded-row bg-secondary px-4 py-3 text-row-detail text-secondary-foreground"
      >
        <Loader2 aria-hidden className="size-4 shrink-0 motion-safe:animate-spin" />
        <span>{status}</span>
      </div>
      {error ? <p className="text-meta text-muted-foreground">{error}</p> : null}
    </div>
  );
}
