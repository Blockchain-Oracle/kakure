import { buildPaymentUri, encodeBetMemo, fromBase64Url, type Network, newNonce, toBase64Url } from "@kakure/domain";
import { ticketLeaf } from "@kakure/query";
import * as Zingo from "@zingo";
import { fire } from "@/feedback/fire";
import type { AppTicket } from "@/tickets/ticket-db";
import { putTicket, ticketsNow } from "@/tickets/use-tickets";
import { walletStore } from "@/wallet/wallet-store";
import { BetError, type BetRequest, pickAddress } from "./place-bet";

/**
 * "Pay from another wallet" (C3): the same ticket as the web's QR. The payout goes to a fresh Orchard-only address
 * of this app's wallet (or the wallet must exist first), the ticket is saved before the code exists, and the code is
 * a ZIP 321 request with the memo, shown on a screenshot-blocked sheet.
 */
export async function prepareExternalTicket({
  network,
  market,
  side,
  sizeZat,
  addresses,
}: BetRequest): Promise<string> {
  const wallet = walletStore.get();
  if (wallet.phase !== "ready" || wallet.network !== network) {
    throw new BetError("no-wallet", "This app's wallet receives the payout, so open or create it first.");
  }
  const marketAddress = addresses ? pickAddress(addresses) : undefined;
  if (!marketAddress) throw new BetError("no-addresses", "The signed address list hasn't loaded yet.");
  const payout = await Zingo.newPayoutAddress();
  const nonce = newNonce();
  const draft = {
    network,
    marketId: market.id,
    side,
    sizeZat: sizeZat.toString(),
    nonce: toBase64Url(nonce),
    payoutAddress: payout.address,
    marketAddress,
    createdAt: Date.now(),
    question: market.rules.question,
    subject: market.subject,
    kind: market.kind,
    window: market.window,
    cutoffAt: market.cutoffAt,
    closesAt: market.closesAt,
  };
  const ticket: AppTicket = { ...draft, hash: ticketLeaf(draft), source: "qr" };
  await putTicket(ticket);
  fire("send", { identity: `built:${ticket.hash}` });
  return ticket.hash;
}

/** The ZIP 321 request for a saved QR ticket (rebuilt from the ticket, never stored as a string). */
export function paymentUriFor(network: Network, hash: string): string | null {
  const ticket = ticketsNow(network).find((candidate) => candidate.hash === hash);
  if (!ticket) return null;
  const memo = encodeBetMemo({
    network,
    marketId: ticket.marketId,
    side: ticket.side,
    sizeZat: BigInt(ticket.sizeZat),
    nonce: fromBase64Url(ticket.nonce),
    payoutAddress: ticket.payoutAddress,
  });
  return buildPaymentUri({ address: ticket.marketAddress, amountZat: BigInt(ticket.sizeZat), memo });
}
