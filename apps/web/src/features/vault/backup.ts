"use client";

import { fromBase64Url, type Network, toBase64Url } from "@kakure/domain";
import type { Ticket } from "@kakure/query";
import { EXPORT_FILE_EXTENSION } from "@/constants";
import { type ChipRecord, importedChip } from "@/features/wallet/records";
import { IV_BYTES, KDF_ITERATIONS, passphraseKey, SALT_BYTES } from "./passphrase";
import { commit, type Entry, type EntryType, loadEntries, vaultReset } from "./vault-db";

/**
 * Encrypted backup (R6, plan §00): one network's whole vault (chips, positions, deposits and spends in flight, pool-era
 * tickets; never replay episodes) sealed
 * with a passphrase (PBKDF2-SHA-256 → AES-GCM-256). The file is the only copy outside this device; nothing is uploaded.
 * Chips are bearer money, so the file is too: whoever has it and the passphrase can spend them.
 *
 * Import adds what this device doesn't have and keeps what it does. Imported chips may have been spent since the
 * file was made (on this device or another), so they're held apart until the mint says which are still unspent.
 */
interface BackupFile {
  kind: "kakure-vault" | "kakure-tickets";
  /** 2: vault entries; 1: tickets only (before the vault). */
  v: 1 | 2;
  network: Network;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  iv: string;
  data: string;
}

/** What a backup carries: money and positions. Replays stay on the device that recorded them. */
const ALL: readonly EntryType[] = ["ticket", "chip", "deposit", "spend", "position"];
const decoder = new TextDecoder();
const encoder = new TextEncoder();

export interface BackupSummary {
  tickets: number;
  chips: number;
  /** Chip value, in zatoshi. */
  chipZat: number;
  inFlight: number;
  positions: number;
}

function summarise(entries: readonly Entry[]): BackupSummary {
  const chips = entries.filter((entry) => entry.type === "chip") as Entry<ChipRecord>[];
  return {
    tickets: entries.filter((entry) => entry.type === "ticket").length,
    chips: chips.length,
    chipZat: chips.reduce((sum, entry) => sum + entry.value.proof.amount, 0),
    inFlight: entries.filter((entry) => entry.type === "deposit" || entry.type === "spend").length,
    positions: entries.filter((entry) => entry.type === "position").length,
  };
}

export async function exportVault(
  network: Network,
  passphrase: string,
): Promise<{ file: Blob; name: string; summary: BackupSummary }> {
  const entries = await loadEntries(network, ALL);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await passphraseKey(passphrase, salt, KDF_ITERATIONS, ["encrypt"]);
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(entries)));
  const file: BackupFile = {
    kind: "kakure-vault",
    v: 2,
    network,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: KDF_ITERATIONS, salt: toBase64Url(salt) },
    iv: toBase64Url(iv),
    data: toBase64Url(new Uint8Array(sealed)),
  };
  const day = new Date().toISOString().slice(0, "yyyy-mm-dd".length);
  return {
    file: new Blob([JSON.stringify(file)], { type: "application/json" }),
    name: `kakure-${network}-${day}${EXPORT_FILE_EXTENSION}`,
    summary: summarise(entries),
  };
}

export class ImportError extends Error {
  override name = "ImportError";
}

/** Imports into the given network only; a file from the other network is refused (plan §13.16). */
export async function importVault(network: Network, text: string, passphrase: string): Promise<BackupSummary> {
  let file: BackupFile;
  try {
    file = JSON.parse(text) as BackupFile;
  } catch {
    throw new ImportError("This isn't a Kakure backup.");
  }
  const known = (file.kind === "kakure-vault" && file.v === 2) || (file.kind === "kakure-tickets" && file.v === 1);
  if (!known) throw new ImportError("This isn't a Kakure backup.");
  if (file.network !== network) {
    throw new ImportError(`This backup is for ${file.network}. Switch to ${file.network} to import it.`);
  }
  let plain: unknown[];
  try {
    const salt = new Uint8Array(fromBase64Url(file.kdf.salt));
    const key = await passphraseKey(passphrase, salt, file.kdf.iterations, ["decrypt"]);
    const iv = new Uint8Array(fromBase64Url(file.iv));
    const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, new Uint8Array(fromBase64Url(file.data)));
    plain = JSON.parse(decoder.decode(data)) as unknown[];
  } catch {
    throw new ImportError("Wrong passphrase, or the file is damaged.");
  }
  const incoming: Entry[] =
    file.v === 1
      ? (plain as Ticket[])
          .filter((ticket) => ticket.network === network)
          .map((ticket) => ({ type: "ticket", key: ticket.hash, value: ticket }))
      : (plain as Entry[]).filter((entry) => ALL.includes(entry.type));
  const here = new Set((await loadEntries(network, ALL)).map((entry) => `${entry.type}:${entry.key}`));
  const added = incoming
    .filter((entry) => !here.has(`${entry.type}:${entry.key}`))
    .map((entry) =>
      entry.type === "chip" ? { ...entry, value: importedChip(entry.value as ChipRecord, network) } : entry,
    );
  await commit(network, added);
  vaultReset();
  return summarise(added);
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
