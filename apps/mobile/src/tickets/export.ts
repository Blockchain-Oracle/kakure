import { fromBase64Url, type Network, toBase64Url } from "@kakure/domain";
import { gcm } from "@noble/ciphers/aes.js";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { EXPORT_KDF_ITERATIONS } from "@/constants";
import type { AppTicket } from "./ticket-db";
import { loadTickets, saveTicket } from "./ticket-db";
import { resetTickets } from "./use-tickets";

/**
 * Encrypted export and import (R6, plan §2): one network's tickets sealed with a passphrase, PBKDF2-SHA-256 →
 * AES-GCM-256, in the same file format as the web app, so a file moves between the site and the phone. The file is
 * the only copy outside this device; nothing is uploaded.
 */
interface ExportFile {
  kind: "kakure-tickets";
  v: 1;
  network: Network;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  iv: string;
  data: string;
}

const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const deriveKey = (passphrase: string, salt: Uint8Array, iterations: number) =>
  pbkdf2Async(sha256, encoder.encode(passphrase), salt, { c: iterations, dkLen: KEY_BYTES });

export class ImportError extends Error {
  override name = "ImportError";
}

export async function exportTickets(network: Network, passphrase: string): Promise<{ text: string; count: number }> {
  const tickets = await loadTickets(network);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt, EXPORT_KDF_ITERATIONS);
  const sealed = gcm(key, iv).encrypt(encoder.encode(JSON.stringify(tickets)));
  const file: ExportFile = {
    kind: "kakure-tickets",
    v: 1,
    network,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: EXPORT_KDF_ITERATIONS, salt: toBase64Url(salt) },
    iv: toBase64Url(iv),
    data: toBase64Url(sealed),
  };
  return { text: JSON.stringify(file), count: tickets.length };
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
  if (file.network !== network)
    throw new ImportError(`This file holds ${file.network} tickets. Switch to ${file.network} to import it.`);
  let tickets: AppTicket[];
  try {
    const key = await deriveKey(passphrase, fromBase64Url(file.kdf.salt), file.kdf.iterations);
    const plain = gcm(key, fromBase64Url(file.iv)).decrypt(fromBase64Url(file.data));
    tickets = JSON.parse(decoder.decode(plain)) as AppTicket[];
  } catch {
    throw new ImportError("Wrong passphrase, or the file is damaged.");
  }
  let count = 0;
  for (const ticket of tickets) {
    if (ticket.network !== network) continue;
    await saveTicket({ ...ticket, source: ticket.source ?? "qr" });
    count += 1;
  }
  resetTickets();
  return count;
}
