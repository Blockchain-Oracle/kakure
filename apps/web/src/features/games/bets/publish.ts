"use client";

import type { ReceiptToken } from "@kakure/arcade";
import type { Network, Trading } from "@kakure/domain";
import { blind, randomScalar, unblind, verifyDleq } from "@kakure/ecash";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { mintCall } from "@/features/wallet/api";
import type { PositionRecord } from "@/features/wallet/records";
import { apply, current, exclusive } from "@/features/wallet/wallet-store";
import { ArcadeError } from "../player/api";
import { playerKey } from "../player/device-key";
import { publishToken, retractReceipt } from "./api";

/** The arcade's answer when this key has no such call up (already taken back, or never put up from here). */
const NOT_ON_BOARD = 404;
const SECRET_BYTES = 32;
const HEX_RADIX = 16;
const SCALAR_HEX = 64;

interface Vouched {
  right: boolean;
  signature: { C_: string; dleq: { e: string; s: string } };
}

/**
 * Publishing a paid call to the Bets board, and taking it back (plan §0 R7 under v2, after its privacy reviews).
 *
 * The device asks the operator over Oblivious HTTP to vouch for the call, sending the position's secret and a blinded
 * point of a random receipt secret; the operator blind-signs it under its "right" or its "wrong" key with a DLEQ proof,
 * once per position. The device checks the proof against the key the signed bundle publishes, unblinds the signature,
 * and gives the arcade only that token, which the operator has never seen: nothing joins the published call to the
 * trade or to this device's nickname. The secret and blinding factor are kept in the vault before asking, so a lost
 * answer is asked again with the same bytes and the operator answers from its cache.
 */
export function publishPosition(network: Network, trading: Trading, key: string): Promise<{ right: boolean }> {
  return exclusive(network, async () => {
    let record = (await current(network)).positions.find((p) => p.key === key);
    if (!record?.certificate || record.state !== "paid") throw new Error("Only a paid call can be published.");
    const token = record.receipt?.token ?? (await vouch(network, trading, record));
    record = (await current(network)).positions.find((p) => p.key === key) ?? record;
    const accepted = await publishToken(token);
    await apply(network, [
      {
        ...record,
        published: { receipt: accepted.receipt, right: accepted.right, at: Date.now(), player: playerKey() },
      },
    ]);
    return { right: accepted.right };
  });
}

/** The operator's blind receipt for this position, asked for once and kept on the position. */
async function vouch(network: Network, trading: Trading, record: PositionRecord): Promise<ReceiptToken> {
  const keys = trading.receiptKeys;
  const certificate = record.certificate;
  if (!keys || !certificate) throw new Error("The operator hasn't published its receipt keys yet.");
  const pending = record.receipt?.pending ?? {
    secret: bytesToHex(crypto.getRandomValues(new Uint8Array(SECRET_BYTES))),
    r: randomScalar().toString(HEX_RADIX).padStart(SCALAR_HEX, "0"),
  };
  if (!record.receipt?.pending) await apply(network, [{ ...record, receipt: { pending } }]);
  const r = BigInt(`0x${pending.r}`);
  const { B_ } = blind(utf8ToBytes(pending.secret), r);
  const vouched = await mintCall<Vouched>(
    network,
    trading,
    "POST",
    "/v1/receipt",
    JSON.stringify({ position: certificate.id, secret: record.secret, blinded: B_ }),
  );
  const K = vouched.right ? keys.right : keys.wrong;
  // The proof that the published key signed it: a key made for this device alone would fail here.
  if (!verifyDleq(vouched.signature.dleq, B_, vouched.signature.C_, K)) {
    throw new Error("The operator's receipt doesn't check out against its published key.");
  }
  const token: ReceiptToken = {
    v: 2,
    network,
    right: vouched.right,
    secret: pending.secret,
    C: unblind(vouched.signature.C_, r, K),
    dleq: { ...vouched.signature.dleq, r: pending.r },
  };
  await apply(network, [{ ...record, receipt: { token } }]);
  return token;
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
