"use client";

import type { ReceiptToken } from "@kakure/arcade";
import type { Network, Trading } from "@kakure/domain";
import { mintCall } from "@/features/wallet/api";
import { apply, current, exclusive } from "@/features/wallet/wallet-store";
import { ArcadeError } from "../player/api";
import { playerKey } from "../player/device-key";
import { publishToken, retractReceipt } from "./api";

/** The arcade's answer when this key has no such call up (already taken back, or never put up from here). */
const NOT_ON_BOARD = 404;

/**
 * Publishing a paid call to the Bets board, and taking it back (plan §0 R7 under v2, after its privacy review). The
 * device proves the position to the operator over Oblivious HTTP and gets back only a signed receipt token (right or
 * wrong, for this arcade key); the token is all the arcade ever receives. The publication is noted on the position, in
 * the vault, with the key it went up under.
 */
export function publishPosition(network: Network, trading: Trading, key: string): Promise<{ right: boolean }> {
  return exclusive(network, async () => {
    const record = (await current(network)).positions.find((p) => p.key === key);
    if (!record?.certificate || record.state !== "paid") throw new Error("Only a paid call can be published.");
    const player = playerKey();
    const token = await mintCall<ReceiptToken>(
      network,
      trading,
      "POST",
      "/v1/receipt",
      JSON.stringify({ position: record.certificate.id, secret: record.secret, player }),
    );
    const accepted = await publishToken(token);
    await apply(network, [
      { ...record, published: { receipt: accepted.receipt, right: accepted.right, at: Date.now(), player } },
    ]);
    return { right: accepted.right };
  });
}

export function retractPosition(network: Network, key: string): Promise<void> {
  return exclusive(network, async () => {
    const record = (await current(network)).positions.find((p) => p.key === key);
    const note = record?.published;
    if (!record || !note) return;
    // A note from a build before publishing named its key has none; this device's key is the only one it had.
    if (note.player && note.player !== playerKey()) {
      throw new Error("This call went up under another arcade key; only the device holding it can take it down.");
    }
    try {
      await retractReceipt(note.receipt);
    } catch (cause) {
      // Already off the board: the note goes too.
      if (!(cause instanceof ArcadeError && cause.status === NOT_ON_BOARD)) throw cause;
    }
    const { published: _, ...rest } = record;
    await apply(network, [rest]);
  });
}
