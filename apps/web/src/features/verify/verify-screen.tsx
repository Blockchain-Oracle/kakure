"use client";

import {
  type BundleV2,
  bandOutcomeOf,
  cadenceLabel,
  type Network,
  PRINTS_DELAY_SEC,
  parlayPayoutZat,
  parlayPriceE8,
  parlaySettledZat,
  parseWindowId,
  reduceShare,
  sidePayoutZat,
  type WindowState,
} from "@kakure/domain";
import { operatorKey, printsQuery } from "@kakure/query";
import { verifyDocument } from "@kakure/signing";
import { EmptyState, Mark, Skeleton } from "@kakure/ui-web";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleDashed, Layers, ShieldCheck, XCircle } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useMemo } from "react";
import { DATA_SOURCE, NETWORK_COIN } from "@/constants";
import { DataErrorState } from "@/features/data/data-states";
import { useRealtime } from "@/features/data/use-realtime";
import { recompute } from "@/features/proof/recompute";
import { bandText, centsOf, clockText, sideWord, zecText } from "@/features/terminal/format";
import { bandSideOf, type PositionRecord, upDownOf } from "@/features/wallet/records";
import { useWallet } from "@/features/wallet/wallet-store";

/**
 * Verify (plan §00 Verify / Proof): every position on this device carries the mint's signed certificate, and each is
 * checked here again, on this device, from public files only: its signature against the operator key built into this
 * site; its payout against the public formula (stake ÷ ask, or ÷ the parlay's combined price, floored to the chip
 * grid); and, once its Window has settled, the outcome recomputed from the venues' signed prints and what was paid
 * against it. Nothing is sent: the hourly prints files load all at once, never one hour at a time (O22).
 */
type Check = { ok: boolean | null; text: string };
const MS = 1000;
const HOUR_SEC = 3_600;
/** A Window settles about a minute after it ends, in that hour's prints file. */
const SETTLE_LAG_SEC = 60;

/** When the prints file that recomputes a Window ending at `expirySec` is published: its hour's end plus the delay. */
const printsAt = (expirySec: number) =>
  Math.ceil((expirySec + SETTLE_LAG_SEC) / HOUR_SEC) * HOUR_SEC + PRINTS_DELAY_SEC;

/**
 * A single's price, through any partial closes: the first signed terms against the formula, then each share sold
 * replayed with the mint's rule (`reduceShare`), which must land on the terms signed last.
 */
function priceCheck(record: PositionRecord, coin: string): Check {
  const cert = record.certificate;
  if (!cert) return { ok: false, text: "No certificate" };
  const chain = record.reductions ?? [];
  const askE4 = cert.askE4 ?? 0;
  if (chain.length === 0) {
    return {
      ok: sidePayoutZat(Number(cert.stakeZat), askE4) === Number(cert.payoutZat),
      text: `Pays ${zecText(Number(cert.payoutZat))} ${coin}: the stake over its ask, ${centsOf(askE4)}`,
    };
  }
  const first = chain[0]?.from;
  if (!first || chain.some((r) => !r.from || r.fractionBps === undefined)) {
    return {
      ok: null,
      text: "Partly sold back before this device kept the earlier terms; what's left is signed as shown",
    };
  }
  let stake = Number(first.stakeZat);
  let payout = Number(first.payoutZat);
  const firstOk = sidePayoutZat(stake, first.askE4 ?? 0) === payout && first.askE4 === askE4;
  for (const r of chain) {
    const share = reduceShare(stake, payout, r.fractionBps ?? 0);
    stake -= share.soldStakeZat;
    payout -= share.soldPayoutZat;
  }
  return {
    ok: firstOk && stake === Number(cert.stakeZat) && payout === Number(cert.payoutZat),
    text: `Bought to pay ${zecText(Number(first.payoutZat))} ${coin} at ${centsOf(askE4)}; ${chain.length} partial close${chain.length === 1 ? "" : "s"} replayed with the mint's rule leave ${zecText(payout)} ${coin}`,
  };
}

export function VerifyScreen() {
  const data = useRealtime();
  const network = data.network;
  const bundle = data.status === "ready" ? data.bundle : null;
  const wallet = useWallet(network);
  const held = wallet.positions.filter((p) => p.certificate);
  const prints = useQuery({
    ...printsQuery(DATA_SOURCE, network, bundle ?? undefined),
    enabled: bundle !== null && held.length > 0,
  });
  const states = useMemo(() => {
    const map = new Map<string, WindowState>();
    for (const file of prints.data ?? []) for (const w of file.windows) map.set(w.id, w);
    for (const w of bundle?.windows ?? []) if (w.outcome) map.set(w.id, w);
    return map;
  }, [prints.data, bundle]);

  return (
    <div className="mx-auto flex w-full max-w-(--layout-content-max) flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-page-title text-foreground">Verify</h1>
        <p className="text-body text-muted-foreground">
          Every position on this device, checked again here from public files: the mint's signature, the price, and how
          it settled. Nothing is sent.
        </p>
      </header>
      {data.status === "loading" || wallet.status === "loading" ? <Skeleton className="h-48 rounded-group" /> : null}
      {data.status === "error" ? <DataErrorState error={data.error} network={network} onRetry={data.refetch} /> : null}
      {bundle && wallet.status === "ready" ? (
        held.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck />}
            title="No positions on this device yet"
            reason="Each trade's certificate lands here, signed by the mint. Settlements for everyone are recomputed on Proof."
            action={
              <Link href="/proof" className="text-row-strong text-link underline underline-offset-2">
                See Proof
              </Link>
            }
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {held.map((record) => (
              <PositionChecks
                key={record.key}
                record={record}
                network={network}
                bundle={bundle}
                states={states}
                printsLoading={prints.isFetching}
              />
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

function PositionChecks({
  record,
  network,
  bundle,
  states,
  printsLoading,
}: {
  record: PositionRecord;
  network: Network;
  bundle: BundleV2;
  states: ReadonlyMap<string, WindowState>;
  printsLoading: boolean;
}) {
  const cert = record.certificate;
  if (!cert) return null;
  const coin = NETWORK_COIN[network];
  const lanes = new Map(bundle.lanes.map((lane) => [lane.id, lane]));
  const key = operatorKey(DATA_SOURCE, network);
  const signed = key !== null && verifyDocument(cert as unknown as Record<string, unknown>, key);
  const stake = Number(cert.stakeZat);
  const payout = Number(cert.payoutZat);
  const checks: Check[] = [{ ok: signed, text: "Signed by the mint, checked against the operator key built in" }];
  let title: ReactNode;

  if (cert.kind === "parlay") {
    const legs = cert.legs ?? [];
    const priced = parlayPriceE8(legs.map((l) => ({ askE4: l.askE4, expirySec: l.expiry })));
    const priceOk = priced.ok && priced.priceE8 === cert.priceE8 && parlayPayoutZat(stake, priced.priceE8) === payout;
    checks.push({ ok: priceOk, text: `Pays ${zecText(payout)} ${coin}: the stake over the legs' asks multiplied` });
    const outcomes = legs.map((l) => {
      const state = states.get(l.window);
      const r = state ? recompute(state, lanes) : null;
      return { leg: l, state, r };
    });
    const decided = outcomes.every((o) => o.state?.outcome);
    if (decided) {
      const allOk = outcomes.every((o) => o.r?.ok);
      checks.push({ ok: allOk, text: "Every leg's outcome recomputed from the venues' signed prints" });
      const expected = parlaySettledZat(
        stake,
        outcomes.map(({ leg, state }) => ({
          askE4: leg.askE4,
          expirySec: leg.expiry,
          outcome: state?.outcome === "refund" ? "refund" : state?.outcome === leg.side ? "won" : "lost",
        })),
      );
      checks.push(paidCheck(record, expected, coin));
    } else {
      checks.push(pendingCheck(Math.max(0, ...legs.map((l) => l.expiry)), printsLoading));
    }
    title = (
      <span className="flex items-center gap-2">
        <span className="grid size-6 place-items-center rounded-full bg-secondary">
          <Layers aria-hidden className="size-3.5" />
        </span>
        Parlay · {legs.length} legs
      </span>
    );
  } else {
    const parsed = cert.window ? parseWindowId(cert.window) : null;
    const bandSide = bandSideOf(cert);
    checks.push(priceCheck(record, coin));
    const state = cert.window ? states.get(cert.window) : undefined;
    if (record.state === "paid" && record.how && record.how !== "redeem" && record.how !== "settled") {
      checks.push({
        ok: true,
        text: `Sold back before the close at the house's bid: ${zecText(Number(record.paidZat ?? 0))} ${coin}`,
      });
    } else if (state?.outcome && bandSide) {
      // A band settles on the venues' closing prints against its edges, two of three (no reference needed).
      const lane = parsed ? lanes.get(parsed.lane.id) : undefined;
      const outcome = lane ? bandOutcomeOf(lane.venues, state.closing ?? {}, cert.lo ?? null, cert.hi ?? null) : null;
      checks.push({
        ok: outcome !== null,
        text:
          outcome === "refund"
            ? "Refunded: the venues' closing prints didn't agree two to one"
            : `Closed ${outcome === "in" ? "inside" : "outside"} the band on two of three venues, from their signed closing prints`,
      });
      if (outcome !== null) {
        checks.push(paidCheck(record, outcome === "refund" ? stake : outcome === bandSide ? payout : 0, coin));
      }
    } else if (state?.outcome) {
      const r = recompute(state, lanes);
      checks.push({
        ok: r?.ok ?? false,
        text: `${state.outcome === "refund" ? "Refunded" : `${state.outcome === "U" ? "UP" : "DOWN"} won`}, recomputed from the venues' signed prints`,
      });
      const expected = state.outcome === "refund" ? stake : state.outcome === upDownOf(cert) ? payout : 0;
      checks.push(paidCheck(record, expected, coin));
    } else {
      checks.push(pendingCheck(parsed?.window.expirySec ?? 0, printsLoading));
    }
    const asset = parsed?.lane.asset ?? "";
    title = (
      <span className="flex items-center gap-2">
        <Mark mark={`mark-${asset.toLowerCase()}`} label={asset} size="inline" />
        {asset}{" "}
        {bandSide
          ? bandText({ lo: cert.lo ? Number(cert.lo) : null, hi: cert.hi ? Number(cert.hi) : null, side: bandSide })
          : (() => {
              const side = upDownOf(cert);
              return side ? sideWord(side) : "";
            })()}{" "}
        · {parsed ? cadenceLabel(parsed.lane.cadenceSec) : ""}
      </span>
    );
  }

  return (
    <li className="flex flex-col gap-3 rounded-group border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-row-strong text-foreground">
        {title}
        <span className="numbers text-meta text-muted-foreground">
          {zecText(stake)} {coin} · {new Date(cert.openedAt * MS).toLocaleString()}
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {checks.map((c) => (
          <li key={c.text} className="flex gap-2 text-row-detail text-foreground">
            {c.ok === null ? (
              <CircleDashed aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            ) : c.ok ? (
              <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-up" />
            ) : (
              <XCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-down" />
            )}
            <span>
              <span className="sr-only">{c.ok === null ? "Pending: " : c.ok ? "Passed: " : "Failed: "}</span>
              {c.text}
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}

/** A settlement not recomputable yet: still open, or settled and waiting for its hour's signed prints file. */
function pendingCheck(expirySec: number, loading: boolean): Check {
  if (loading) return { ok: null, text: "Loading the signed prints…" };
  if (Date.now() / MS < expirySec) return { ok: null, text: "Its Window hasn't settled yet" };
  return {
    ok: null,
    text: `Settled; recomputed here once its hour's signed prints file is out, after ${clockText(printsAt(expirySec))}`,
  };
}

/** What a settled position should have paid, against what this device received. */
function paidCheck(record: PositionRecord, expected: number, coin: string): Check {
  if (record.state !== "paid") return { ok: null, text: `Due ${zecText(expected)} ${coin}; paying out as chips` };
  const paid = Number(record.paidZat ?? 0);
  return { ok: paid === expected, text: `Paid ${zecText(paid)} ${coin} as chips, as the outcome says` };
}
