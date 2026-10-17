import { viewTicket } from "@kakure/query";
import { useEffect } from "react";
import { useMarkets } from "@/data/markets";
import { fire } from "@/feedback/fire";
import { useWallet } from "@/wallet/wallet-store";
import type { AppTicket } from "./ticket-db";
import { putTicket, useTickets } from "./use-tickets";

/**
 * Moves this device's tickets along as evidence arrives (plan §13.2, C3/C4):
 * - the wallet's own history marks a sent bet mined (its txid confirmed at a height), and settles an "unknown"
 *   send by finding the memo's nonce in what the wallet sent (never re-sending blindly);
 * - each signed bundle decides counted → won / lost / refunded / paid, remembered on the ticket so it stays
 *   readable after its market is archived.
 * Each outcome plays its sound and haptic once (identity = ticket hash + state).
 */
const OUTCOME_CUE = { counted: "confirmed", won: "win", lost: "loss", refunded: "received", paid: "received" } as const;

/** A send started before this JS session can't be followed any more (the app was closed or reloaded mid-send). */
const SESSION_START = Date.now();

export function useTicketTracker(): void {
  const data = useMarkets();
  const wallet = useWallet();
  const tickets = useTickets(data.network);
  const bundle = data.status === "ready" ? data.bundle : null;

  useEffect(() => {
    if (!Array.isArray(tickets)) return;
    const now = Date.now();
    for (const ticket of tickets) {
      let next: AppTicket = ticket;
      const send = ticket.send;
      if (send?.state === "sending" && send.at < SESSION_START) {
        next = { ...next, send: { ...send, state: "unknown", at: now } };
      }
      const pending = next.send;
      if (pending && wallet.network === ticket.network && wallet.activity.length > 0) {
        if (pending.state === "unknown") {
          const found = wallet.activity.find((transfer) =>
            transfer.memos?.some((memo) => memo.includes(`k=${ticket.nonce}`)),
          );
          if (found) next = { ...next, send: { ...pending, state: "sent", txid: found.txid, at: now } };
        }
        const current = next.send;
        if (current?.txid && current.minedHeight === undefined) {
          const transfer = wallet.activity.find((candidate) => candidate.txid === current.txid);
          if (transfer?.status === "confirmed")
            next = { ...next, send: { ...current, minedHeight: transfer.blockheight } };
          if (transfer?.status === "failed")
            next = {
              ...next,
              send: { ...current, state: "failed", error: "The network did not take this transaction." },
            };
        }
      }
      const view = viewTicket(next, bundle, now);
      if (view.market && view.seq !== null && next.last?.status !== view.status) {
        next = {
          ...next,
          last: {
            status: view.status,
            seq: view.seq,
            ...(view.payoutZat === null ? {} : { payoutZat: view.payoutZat.toString() }),
          },
        };
        const cue = OUTCOME_CUE[view.status as keyof typeof OUTCOME_CUE];
        if (cue) fire(cue, { identity: `${view.status}:${ticket.hash}` });
      }
      if (next !== ticket) void putTicket(next);
    }
  }, [tickets, bundle, wallet.activity, wallet.network]);
}
