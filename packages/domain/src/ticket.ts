import { blake2b } from "@noble/hashes/blake2.js";
import { NETWORK_HASH_BYTE, type Network, type Side, TICKET_HASH_BYTES, TICKET_HASH_PERSONAL } from "./constants";
import { toHex, utf8 } from "./encoding";

const U64_BYTES = 8;
const BYTE_MASK = 0xffn;
const BITS_PER_BYTE = 8n;

export interface TicketLeaf {
  network: Network;
  marketId: string;
  side: Side;
  sizeZat: bigint;
  nonce: Uint8Array;
}

/**
 * The ticket hash published in each signed bundle (plan §3):
 * BLAKE2b-256(personal = "Kakure_Ticket_v1", net ‖ len(m) ‖ m ‖ side ‖ size_zat (u64 LE) ‖ nonce16).
 * Side and size sit inside the hash, so one merged, sorted list per market reveals neither (PD15),
 * and a bettor can still prove which side their ticket was counted on.
 */
export function ticketHash(leaf: TicketLeaf): Uint8Array {
  const market = utf8.encode(leaf.marketId);
  const side = utf8.encode(leaf.side);
  const preimage = new Uint8Array(1 + 1 + market.length + side.length + U64_BYTES + leaf.nonce.length);
  let offset = 0;
  preimage[offset++] = NETWORK_HASH_BYTE[leaf.network];
  preimage[offset++] = market.length;
  preimage.set(market, offset);
  offset += market.length;
  preimage.set(side, offset);
  offset += side.length;
  preimage.set(u64LittleEndian(leaf.sizeZat), offset);
  offset += U64_BYTES;
  preimage.set(leaf.nonce, offset);

  return blake2b(preimage, { dkLen: TICKET_HASH_BYTES, personalization: utf8.encode(TICKET_HASH_PERSONAL) });
}

export function ticketHashHex(leaf: TicketLeaf): string {
  return toHex(ticketHash(leaf));
}

function u64LittleEndian(value: bigint): Uint8Array {
  const bytes = new Uint8Array(U64_BYTES);
  let rest = value;
  for (let index = 0; index < U64_BYTES; index += 1) {
    bytes[index] = Number(rest & BYTE_MASK);
    rest >>= BITS_PER_BYTE;
  }
  return bytes;
}
