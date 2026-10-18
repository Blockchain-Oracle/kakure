import { toHex, utf8 } from "@kakure/domain";
import type { Ticket } from "@kakure/query";
import { blake2b } from "@noble/hashes/blake2.js";

/** BLAKE2b personalisation, 16 bytes like the domain's "Kakure_Ticket_v1" and "Kakure_Rules_v01". */
const FOLIO_PERSONAL = "Kakure_Folio_v01";
const FOLIO_BYTES = 3;

/**
 * A ticket's folio (#A1B2C3) for the slip, the email subject and the app's own screens. It comes from the ticket's
 * secret nonce, never from its published hash: an Outcome slip must not be matched to a leaf in the signed list,
 * which would date the bet (audit O3). Only the Provable mode, which shares the nonce, shows the hash itself.
 */
export function folioOf(ticket: Pick<Ticket, "nonce">): string {
  const bytes = blake2b(utf8.encode(ticket.nonce), {
    dkLen: FOLIO_BYTES,
    personalization: utf8.encode(FOLIO_PERSONAL),
  });
  return toHex(bytes).toUpperCase();
}
