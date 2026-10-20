"use client";

import type { Network } from "@kakure/domain";
import { apply, current, exclusive } from "@/features/wallet/wallet-store";
import { publishCertificate, retractReceipt } from "./api";

/**
 * Publishing a paid position to the Bets board, and taking it back (plan §0 R7 under v2). The arcade checks the
 * certificate and keeps only the receipt; this device notes it on the position, in the vault, so the toggle shows it.
 */
export function publishPosition(network: Network, key: string): Promise<{ right: boolean }> {
  return exclusive(network, async () => {
    const record = (await current(network)).positions.find((p) => p.key === key);
    if (!record?.certificate || record.state !== "paid") throw new Error("Only a paid position can be published.");
    const accepted = await publishCertificate(record.certificate);
    await apply(network, [
      { ...record, published: { receipt: accepted.receipt, right: accepted.right, at: Date.now() } },
    ]);
    return { right: accepted.right };
  });
}

export function retractPosition(network: Network, key: string): Promise<void> {
  return exclusive(network, async () => {
    const record = (await current(network)).positions.find((p) => p.key === key);
    if (!record?.published) return;
    await retractReceipt(record.published.receipt);
    const { published: _, ...rest } = record;
    await apply(network, [rest]);
  });
}
