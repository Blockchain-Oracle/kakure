"use client";

import { type Bundle, fromBase64Url, type Network, ticketHashHex } from "@kakure/domain";
import { decodeReceipt, OPERATOR_PUBLIC_KEYS, type Receipt, winningPayout } from "@kakure/query";
import { EmptyState, Pill, SearchField, Skeleton } from "@kakure/ui-web";
import { CheckCircle2, CircleDashed, ShieldCheck, XCircle } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { NETWORK_COIN, NETWORK_LABEL } from "@/constants";
import { DataErrorState } from "@/features/data/data-states";
import { useMarkets } from "@/features/data/use-markets";
import { useFragment } from "@/features/market/fragment";
import { coinAmount, sideWord } from "@/features/markets/market-view";

/**
 * The verify centre (C12): a receipt (from `/verify#<receipt>`, kept in the fragment so the host never sees it),
 * a ticket hash, the batch signature and the pinned operator keys, all checked on this device against the latest
 * signed bundle. Resolution re-verify needs the operator's resolution records (S03); until they exist this page
 * says so instead of pretending to check.
 */
const HASH = /^[0-9a-f]{64}$/;

export function VerifyScreen() {
  const fragment = useFragment();
  const data = useMarkets();
  const [input, setInput] = useState("");
  const value = (fragment ?? "").replace(/^#/, "");

  useEffect(() => {
    if (value) setInput(value);
  }, [value]);

  const submit = (text: string) => {
    setInput(text);
    const clean = text.trim().replace(/^.*#/, "");
    history.replaceState(history.state, "", clean ? `#${clean}` : window.location.pathname);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };

  const receipt = value && !HASH.test(value) ? decodeReceipt(value) : null;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-5 py-6 rail:px-8 rail:py-8">
      <h1 className="font-display text-page-title text-foreground">Verify</h1>
      <SearchField
        label="Receipt link or ticket hash"
        placeholder="Paste a receipt link or a ticket hash"
        value={input}
        onChange={submit}
      />
      {fragment === null || data.status === "loading" ? (
        <Skeleton className="h-48 rounded-group" />
      ) : data.status === "error" ? (
        <DataErrorState error={data.error} network={data.network} onRetry={data.refetch} />
      ) : data.status === "unpublished" ? (
        <EmptyState
          title="Nothing published to verify against"
          reason={`No signed batch exists on ${NETWORK_LABEL[data.network]} yet.`}
        />
      ) : (
        <>
          <BatchCard bundle={data.bundle} network={data.network} />
          {value === "" ? (
            <p className="rounded-group bg-card p-5 text-row-detail text-muted-foreground">
              Open a receipt's verify link, or paste one above. A ticket hash (64 hex characters) is searched in every
              market's signed list. Everything is checked here; nothing is sent.
            </p>
          ) : HASH.test(value) ? (
            <HashCard hash={value} bundle={data.bundle} />
          ) : receipt ? (
            <ReceiptCard receipt={receipt} bundle={data.bundle} network={data.network} />
          ) : (
            <EmptyState
              icon={<XCircle />}
              tone="warn"
              title="That isn't a Kakure receipt"
              reason="Receipt links end in /verify# followed by the receipt. Copy it again from the ticket's Receipt section."
            />
          )}
        </>
      )}
      <KeysCard />
    </div>
  );
}

function Check({ ok, children }: { ok: boolean | null; children: ReactNode }) {
  const icon =
    ok === null ? (
      <CircleDashed aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
    ) : ok ? (
      <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-up" />
    ) : (
      <XCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-down" />
    );
  return (
    <li className="flex gap-2.5 text-row-detail text-foreground">
      {icon}
      <span>
        <span className="sr-only">{ok === null ? "Not checked: " : ok ? "Passed: " : "Failed: "}</span>
        {children}
      </span>
    </li>
  );
}

function BatchCard({ bundle, network }: { bundle: Bundle; network: Network }) {
  return (
    <section className="rounded-group bg-card p-5" aria-label="Signed batch">
      <ul className="flex flex-col gap-2">
        <Check ok>
          Batch {bundle.seq} ({NETWORK_LABEL[network]}) is signed by the operator key pinned in this build, and its
          bytes hash to the value in latest.json.
        </Check>
        <Check ok>The signed address list it names matches the hash in its file name.</Check>
      </ul>
    </section>
  );
}

function HashCard({ hash, bundle }: { hash: string; bundle: Bundle }) {
  const market = bundle.markets.find((candidate) => candidate.leaves.includes(hash));
  return (
    <section className="rounded-group bg-card p-5" aria-label="Ticket hash">
      <ul className="flex flex-col gap-2">
        <Check ok={Boolean(market)}>
          {market
            ? `Listed in batch ${bundle.seq} for ${market.id}: this ticket is counted.`
            : `Not in any market's list in batch ${bundle.seq}. It may not be mined yet, may be late, or its market may be archived.`}
        </Check>
      </ul>
    </section>
  );
}

function ReceiptCard({ receipt, bundle, network }: { receipt: Receipt; bundle: Bundle; network: Network }) {
  const market = bundle.markets.find((candidate) => candidate.id === receipt.marketId);
  const coin = NETWORK_COIN[receipt.network];
  const size = BigInt(receipt.sizeZat);
  const leaf = receipt.nonce
    ? ticketHashHex({
        network: receipt.network,
        marketId: receipt.marketId,
        side: receipt.side,
        sizeZat: size,
        nonce: fromBase64Url(receipt.nonce),
      })
    : null;
  const payout = market?.outcome === receipt.side ? winningPayout(market, receipt.side, size) : null;
  return (
    <section className="flex flex-col gap-4 rounded-group bg-card p-5" aria-label="Receipt">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-title text-foreground">
          {sideWord(receipt.side)} · {coinAmount(size, coin)}
        </h2>
        <Pill tone={receipt.nonce ? "accent" : "neutral"}>{receipt.nonce ? "Provable receipt" : "Outcome slip"}</Pill>
      </div>
      <p className="text-row-detail text-muted-foreground">{market?.rules.question ?? receipt.marketId}</p>
      <ul className="flex flex-col gap-2">
        {receipt.network !== network ? (
          <Check ok={false}>This receipt is for {NETWORK_LABEL[receipt.network]}. Switch networks to check it.</Check>
        ) : !market ? (
          <Check ok={null}>
            {receipt.marketId} isn't in batch {bundle.seq}. This page reads only the latest signed batch; checking an
            archived market needs the operator's archived batches, which aren't published yet.
          </Check>
        ) : (
          <>
            {leaf ? (
              <Check ok={market.leaves.includes(leaf)}>
                {market.leaves.includes(leaf)
                  ? `Its hash, recomputed here from the receipt's nonce, is in batch ${bundle.seq}'s signed list.`
                  : `Its recomputed hash isn't in batch ${bundle.seq}'s list (${market.leaves.length} tickets listed).`}
              </Check>
            ) : (
              <Check ok={null}>An outcome slip carries no nonce, so it can't be matched to the signed list.</Check>
            )}
            <Check ok={market.outcome ? true : null}>
              {market.outcome
                ? market.outcome === "refund"
                  ? "The market refunded every ticket."
                  : `Resolved ${sideWord(market.outcome)}: this ticket ${market.outcome === receipt.side ? "won" : "lost"}.${payout === null ? "" : ` A winning ${coinAmount(size, coin)} ticket is paid ${coinAmount(payout, coin)}.`}`
                : "Not resolved yet."}
            </Check>
            <Check ok={null}>
              Re-verifying the result from the venues' own candles arrives with the operator's resolution records
              {market.resolution ? ` (${market.resolution})` : ""}. It isn't built yet, so nothing is re-checked here.
            </Check>
          </>
        )}
      </ul>
    </section>
  );
}

const KEY_HEAD = 8;
const KEY_TAIL = 8;

function KeysCard() {
  return (
    <section className="rounded-group bg-card p-5" aria-labelledby="keys-title">
      <h2 id="keys-title" className="flex items-center gap-2 text-title text-foreground">
        <ShieldCheck aria-hidden className="size-5" /> Operator keys in this build
      </h2>
      <dl className="mt-3 flex flex-col gap-2">
        {(Object.keys(OPERATOR_PUBLIC_KEYS) as Network[]).map((network) => {
          const key = OPERATOR_PUBLIC_KEYS[network];
          return (
            <div key={network} className="flex flex-wrap items-baseline justify-between gap-2">
              <dt className="text-row-detail text-muted-foreground">{NETWORK_LABEL[network]}</dt>
              <dd className="text-row-strong break-all text-foreground tabular-nums" title={key ?? undefined}>
                {key ? `${key.slice(0, KEY_HEAD)}…${key.slice(-KEY_TAIL)}` : "Not pinned yet"}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="mt-3 text-meta text-muted-foreground">
        Keys are built into the app, never fetched. Files signed by any other key are refused.
      </p>
    </section>
  );
}
