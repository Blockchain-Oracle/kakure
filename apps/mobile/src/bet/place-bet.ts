import {
  type AddressList,
  encodeBetMemo,
  type Market,
  type Network,
  newNonce,
  type Side,
  toBase64Url,
} from "@kakure/domain";
import { ticketLeaf } from "@kakure/query";
import * as Zingo from "@zingo";
import { BET_POOLS, FEE_RESERVE_ZAT, HASH_SHORT } from "@/constants";
import { fire } from "@/feedback/fire";
import { devLog } from "@/lib/dev-log";
import { type AppTicket, payoutAddressUsed } from "@/tickets/ticket-db";
import { putTicket, updateTicket } from "@/tickets/use-tickets";
import { errorOf, refreshWallet, walletStore, warmMixnet } from "@/wallet/wallet-store";

/**
 * The one-tap bet (C3): a fixed ticket paid by the built-in wallet with the same memo as the web's QR.
 * 1. Check the Ironwood balance covers the ticket and fee (a bet never spends Orchard: D6, and the native side
 *    refuses any proposal that would spend another pool).
 * 2. A fresh Orchard-only payout address for this ticket (D8), a fresh nonce, the memo (encodeBetMemo).
 * 3. Save the ticket BEFORE any money moves, so the bet can always be found and proven (plan §13.2).
 * 4. Send over the Nym mixnet; phases land on the ticket as they happen.
 */
export class BetError extends Error {
  override name = "BetError";
  constructor(
    readonly kind: "no-wallet" | "not-enough-ironwood" | "no-addresses" | "closed" | "address-reused",
    message: string,
  ) {
    super(message);
  }
}

const RANDOM_WORDS = 1;
/** Uint32 values span 0..2^32. */
const WORD_RANGE = 4_294_967_296;

/** A uniformly random address from the signed list (D7), by rejection sampling so no address is favoured. */
export function pickAddress(list: AddressList): string | undefined {
  const count = list.addresses.length;
  if (count === 0) return undefined;
  const limit = WORD_RANGE - (WORD_RANGE % count);
  for (;;) {
    const [word = 0] = crypto.getRandomValues(new Uint32Array(RANDOM_WORDS));
    if (word < limit) return list.addresses[word % count];
  }
}

/**
 * A fresh Orchard-only payout address for one ticket (D8). Two tickets paying out to one address would let the
 * operator link them, so a repeat is a fault: nothing is saved or sent (audit O21).
 */
export async function freshPayoutAddress(): Promise<string> {
  const payout = await Zingo.newPayoutAddress();
  if (await payoutAddressUsed(payout.address)) {
    devLog("payout address reuse detected; bet stopped");
    throw new BetError(
      "address-reused",
      "The wallet gave a payout address an earlier ticket already uses, so this bet was stopped and nothing was sent. Try again: each try asks the wallet for a new address.",
    );
  }
  return payout.address;
}

/** Whether the Ironwood pool can pay this ticket now (confirmed notes only). */
export function canPay(sizeZat: bigint): { ok: boolean; shortBy: bigint } {
  const pools = walletStore.get().pools;
  const available = pools?.ironwoodConfirmed ?? 0n;
  const needed = sizeZat + FEE_RESERVE_ZAT;
  return { ok: available >= needed, shortBy: needed > available ? needed - available : 0n };
}

export interface BetRequest {
  network: Network;
  market: Market;
  side: Side;
  sizeZat: bigint;
  addresses: AddressList | null;
}

/** Builds and saves the ticket, then pays it. Resolves with the saved ticket once the send settles. */
export async function placeBet(
  { network, market, side, sizeZat, addresses }: BetRequest,
  onSaved?: (hash: string) => void,
): Promise<AppTicket> {
  const wallet = walletStore.get();
  if (wallet.phase !== "ready" || wallet.network !== network) {
    throw new BetError("no-wallet", "Open or create this network's wallet first.");
  }
  if (!canPay(sizeZat).ok) {
    throw new BetError("not-enough-ironwood", "Your Ironwood balance doesn't cover this ticket and its fee.");
  }
  const marketAddress = addresses ? pickAddress(addresses) : undefined;
  if (!marketAddress) {
    throw new BetError("no-addresses", "The signed address list hasn't loaded yet.");
  }

  const payoutAddress = await freshPayoutAddress();
  const nonce = newNonce();
  const memo = encodeBetMemo({ network, marketId: market.id, side, sizeZat, nonce, payoutAddress });
  const draft = {
    network,
    marketId: market.id,
    side,
    sizeZat: sizeZat.toString(),
    nonce: toBase64Url(nonce),
    payoutAddress,
    marketAddress,
    createdAt: Date.now(),
    question: market.rules.question,
    subject: market.subject,
    kind: market.kind,
    window: market.window,
    cutoffAt: market.cutoffAt,
    closesAt: market.closesAt,
  };
  const ticket: AppTicket = {
    ...draft,
    hash: ticketLeaf(draft),
    source: "wallet",
    send: { state: "sending", phase: "route", at: Date.now() },
  };
  await putTicket(ticket);
  onSaved?.(ticket.hash);

  // Live steps for route → proving; "sent" is written once by the settle below (no race with a late event).
  const phases = Zingo.onSendPhase((event) => {
    if (event.requestId !== ticket.hash) return;
    devLog(`bet ${ticket.hash.slice(0, HASH_SHORT.file)} phase ${event.phase} at +${Date.now() - ticket.createdAt} ms`);
    if (event.phase === "sent") return;
    void updateTicket(network, ticket.hash, (saved) => ({
      ...saved,
      send: {
        ...(saved.send ?? { state: "sending", at: Date.now() }),
        phase: event.phase,
        ...(event.txids?.[0] ? { txid: event.txids[0] } : {}),
        ...(event.fee === undefined ? {} : { fee: event.fee }),
      },
    }));
  });

  let reachedConfirm = false;
  const confirmWatch = Zingo.onSendPhase((event) => {
    if (event.requestId === ticket.hash && event.phase === "proving") reachedConfirm = true;
  });
  try {
    const sent = await Zingo.send(marketAddress, sizeZat, memo, {
      allowedPools: [...BET_POOLS],
      requestId: ticket.hash,
    });
    const settled: AppTicket = {
      ...ticket,
      send: {
        state: "sent",
        phase: "sent",
        ...(sent.txids[0] ? { txid: sent.txids[0] } : {}),
        fee: sent.fee,
        at: Date.now(),
      },
    };
    await putTicket(settled);
    devLog(
      `bet ${ticket.hash.slice(0, HASH_SHORT.file)} sent txid ${sent.txids[0] ?? "?"} fee ${sent.fee} from [${sent.sourcePools.join(",")}] timings ${JSON.stringify(sent.timings)}`,
    );
    fire("send", { identity: `sent:${ticket.hash}` });
    void refreshWallet();
    return settled;
  } catch (error) {
    const { code, message } = errorOf(error);
    // Before confirm() nothing left the wallet. During confirm the outcome is unknown: never re-send blindly,
    // the activity check settles it (kawase.md §3.3 "Unknown outcome").
    const state = reachedConfirm && code !== "ERR_ZINGO_POOL_REFUSED" ? "unknown" : "failed";
    const failed: AppTicket = { ...ticket, send: { state, error: `${code}: ${message}`, at: Date.now() } };
    devLog(`bet ${ticket.hash.slice(0, HASH_SHORT.file)} ${state}: ${code}: ${message}`);
    await putTicket(failed);
    fire("error");
    // The route itself failed: bring a fresh one up now, so trying again doesn't pay the bootstrap.
    if (code === "ERR_ZINGO_MIXNET") void warmMixnet();
    throw error;
  } finally {
    phases.remove();
    confirmWatch.remove();
  }
}
