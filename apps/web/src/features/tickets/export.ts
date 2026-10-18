"use client";

import { fromBase64Url, type Network, toBase64Url } from "@kakure/domain";
import type { Ticket } from "@kakure/query";
import { EXPORT_FILE_EXTENSION } from "@/constants";
import { IV_BYTES, KDF_ITERATIONS, passphraseKey, SALT_BYTES } from "./passphrase";
import { loadTickets, saveTicket } from "./ticket-db";

/**
 * Encrypted export and import (R6, plan §2): the tickets of one network, sealed with a passphrase
 * (PBKDF2-SHA-256 → AES-GCM-256). The file is the only copy outside this device; nothing is uploaded.
 */
interface ExportFile {
  kind: "kakure-tickets";
  v: 1;
  network: Network;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  iv: string;
  data: string;
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export async function exportTickets(
  network: Network,
  passphrase: string,
): Promise<{ file: Blob; name: string; count: number }> {
  const tickets = await loadTickets(network);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await passphraseKey(passphrase, salt, KDF_ITERATIONS, ["encrypt"]);
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(tickets)));
  const file: ExportFile = {
    kind: "kakure-tickets",
    v: 1,
    network,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: KDF_ITERATIONS, salt: toBase64Url(salt) },
    iv: toBase64Url(iv),
    data: toBase64Url(new Uint8Array(sealed)),
  };
  const day = new Date().toISOString().slice(0, "yyyy-mm-dd".length);
  return {
    file: new Blob([JSON.stringify(file)], { type: "application/json" }),
    name: `kakure-tickets-${network}-${day}${EXPORT_FILE_EXTENSION}`,
    count: tickets.length,
  };
}

export class ImportError extends Error {
  override name = "ImportError";
}

/** Imports into the given network only; a file from the other network is refused (plan §13.16). */
export async function importTickets(network: Network, text: string, passphrase: string): Promise<number> {
  let file: ExportFile;
  try {
    file = JSON.parse(text) as ExportFile;
  } catch {
    throw new ImportError("This isn't a Kakure ticket file.");
  }
  if (file.kind !== "kakure-tickets" || file.v !== 1) throw new ImportError("This isn't a Kakure ticket file.");
  if (file.network !== network) {
    throw new ImportError(`This file holds ${file.network} tickets. Switch to ${file.network} to import it.`);
  }
  let tickets: Ticket[];
  try {
    const salt = new Uint8Array(fromBase64Url(file.kdf.salt));
    const key = await passphraseKey(passphrase, salt, file.kdf.iterations, ["decrypt"]);
    const iv = new Uint8Array(fromBase64Url(file.iv));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, new Uint8Array(fromBase64Url(file.data)));
    tickets = JSON.parse(decoder.decode(plain)) as Ticket[];
  } catch {
    throw new ImportError("Wrong passphrase, or the file is damaged.");
  }
  for (const ticket of tickets) {
    if (ticket.network === network) await saveTicket(ticket);
  }
  return tickets.length;
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
