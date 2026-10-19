"use client";

import { type Network, ZATOSHI_PER_ZEC } from "@kakure/domain";
import { usePrice } from "@kakure/feeds";
import type { StreamSymbol } from "@kakure/feeds/protocol";
import { cx, RollingNumber } from "@kakure/ui-web";
import { ArrowDownToLine, ArrowRight, ArrowUpFromLine } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { NETWORK_COIN } from "@/constants";
import { useAmounts } from "@/features/portfolio/amounts";
import type { WalletView } from "./wallet-store";
import "./wallet.css";

/**
 * The money card (Mitoshi MoneyHero.tsx, ported from Owarine's plate): what is yours right now as one figure, the
 * line under it, the pills (Deposit, Withdraw, Trade →), the legs and the split as a bar. Here the figure is your
 * chips: ready to trade, plus any settling (a swap in flight, or chips from a backup the mint is still checking).
 * Open positions join as a leg with trading (plan §00 T3). Every amount wears the privacy eye; a skeleton until the
 * vault has read, never a 0 flash.
 */
const ZEC_STREAM: StreamSymbol = "ZEC-USD";
const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const PERMILLE = 1000;
const PERCENT_PER_PERMILLE = 10;

interface Leg {
  key: string;
  label: string;
  tone: string;
  zat: number;
}

export function MoneyCard({
  network,
  wallet,
  onDeposit,
  onWithdraw,
  disabled,
}: {
  network: Network;
  wallet: WalletView;
  onDeposit: () => void;
  onWithdraw: () => void;
  /** Why the money buttons can't work yet (the signed trading info hasn't loaded), or null. */
  disabled: string | null;
}) {
  const coin = NETWORK_COIN[network];
  const { format, hidden } = useAmounts(coin);
  const zec = usePrice(ZEC_STREAM);
  const ready = wallet.status === "ready";
  const settling =
    wallet.spends.filter((spend) => spend.purpose === "swap").reduce((sum, s) => sum + inputsZat(s.inputs), 0) +
    wallet.rechecking.reduce((sum, chip) => sum + chip.proof.amount, 0);
  const totalZat = wallet.balanceZat + settling;
  const legs: Leg[] = [
    { key: "chips", label: "Ready to trade", tone: "mh-leg-chips", zat: wallet.balanceZat },
    ...(settling > 0 ? [{ key: "settling", label: "Settling", tone: "mh-leg-collect", zat: settling }] : []),
  ];
  const arriving = wallet.deposits.filter((deposit) => deposit.state !== "done").length;
  const figure = format(BigInt(totalZat));
  const fiat =
    network === "mainnet" && zec.price && !hidden
      ? USD.format((totalZat / Number(ZATOSHI_PER_ZEC)) * Number(zec.price))
      : null;
  const share = (zat: number) =>
    totalZat > 0 && zat > 0 ? Math.round((zat * PERMILLE) / totalZat) / PERCENT_PER_PERMILLE : 0;

  return (
    <section className="money-hero" aria-label="Your chips">
      <div className="money-hero-top">
        <div className="flex min-w-0 flex-col gap-2">
          <span className="money-hero-eyebrow">Your chips · on this device</span>
          {ready ? (
            <span className="money-hero-figure numbers" style={{ "--fig-len": figure.length } as CSSProperties}>
              {hidden ? figure : <RollingNumber value={figure} />}
            </span>
          ) : (
            <span className="money-hero-skel motion-safe:animate-pulse" role="img" aria-label="Loading" />
          )}
          <p className="money-hero-line">
            <span className="numbers money-hero-strong">{ready ? format(BigInt(wallet.balanceZat)) : "—"}</span> ready
            to trade
            {fiat ? ` · ≈ ${fiat}` : network === "testnet" ? " · test coins, no fiat value" : ""}
            {arriving > 0 ? ` · ${arriving} deposit${arriving === 1 ? "" : "s"} arriving` : ""}
          </p>
          <div className="money-hero-actions">
            <button
              type="button"
              className="money-hero-pill is-accent"
              onClick={onDeposit}
              disabled={disabled !== null}
              title={disabled ?? undefined}
            >
              <ArrowDownToLine aria-hidden /> Deposit
            </button>
            <button
              type="button"
              className="money-hero-pill is-white"
              onClick={onWithdraw}
              disabled={disabled !== null || wallet.balanceZat === 0}
              title={disabled ?? undefined}
            >
              <ArrowUpFromLine aria-hidden /> Withdraw
            </button>
            <Link href="/trade#BTC" className="money-hero-pill is-ghost">
              Trade <ArrowRight aria-hidden />
            </Link>
          </div>
          {disabled ? <p className="text-meta text-(--plate-ink-muted)">{disabled}</p> : null}
        </div>
        <dl className="money-hero-legs">
          {legs.map((leg) => (
            <div key={leg.key} className="mh-leg">
              <span aria-hidden className={cx("money-hero-dot", leg.tone)} />
              <dt className="mh-leg-label">{leg.label}</dt>
              <dd className="numbers mh-leg-amount">{ready ? format(BigInt(leg.zat)) : "—"}</dd>
            </div>
          ))}
          <div className="money-hero-counts">Blind-signed by the mint · spent with no account</div>
        </dl>
      </div>
      <div className="money-hero-bar" aria-hidden>
        {legs.map((leg) => {
          const width = share(leg.zat);
          return width > 0 ? (
            <span key={leg.key} className={cx("money-hero-seg", leg.tone)} style={{ width: `${width}%` }} />
          ) : null;
        })}
      </div>
    </section>
  );
}

function inputsZat(inputs: readonly { amount: number }[]): number {
  return inputs.reduce((sum, proof) => sum + proof.amount, 0);
}
