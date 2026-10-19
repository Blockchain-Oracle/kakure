"use client";

import type { Network } from "@kakure/domain";
import type { Ticket } from "@kakure/query";
import { commit, loadEntries } from "@/features/vault/vault-db";

/**
 * Tickets in the device vault (plan §13.16–17): one `ticket` entry per ticket, keyed by its hash, which lives only
 * inside the ciphertext (the vault's record ids are random).
 */
export async function loadTickets(network: Network): Promise<Ticket[]> {
  const entries = await loadEntries<Ticket>(network, ["ticket"]);
  return entries.map((entry) => entry.value).sort((a, b) => b.createdAt - a.createdAt);
}

/** Stores (or replaces) a ticket. */
export async function saveTicket(ticket: Ticket): Promise<void> {
  await commit(ticket.network, [{ type: "ticket", key: ticket.hash, value: ticket }]);
}
