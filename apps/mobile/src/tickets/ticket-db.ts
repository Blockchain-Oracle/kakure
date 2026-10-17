import type { Network } from "@kakure/domain";
import { toHex } from "@kakure/domain";
import type { Ticket } from "@kakure/query";
import * as Zingo from "@zingo";
import { getRandomBytes } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { deleteDatabaseAsync, openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import { Platform } from "react-native";
import { STORAGE_KEYS, TICKET_DB_NAME } from "@/constants";

/**
 * Tickets live only on this device (C9, R6), in an SQLCipher database whose 256-bit key is random, generated here,
 * and kept in secure-store readable only on this device while unlocked (plan §2 Device storage, §13.17). The file
 * is excluded from iCloud backups (Android: `allowBackup: false`). Every row carries its network (plan §13.16).
 */

/** How an in-app bet is travelling, before the bundle can count it (C3 states). */
export interface WalletSend {
  state: "sending" | "sent" | "failed" | "unknown";
  /** Native phase while sending: route → proving → sent. */
  phase?: "route" | "proving" | "sent";
  txid?: string;
  /** The wallet saw it mined at this height. */
  minedHeight?: number;
  fee?: number;
  error?: string;
  at: number;
}

export interface AppTicket extends Ticket {
  /** "wallet" = paid by the built-in wallet; "qr" = shown as a QR for another wallet. */
  source: "wallet" | "qr";
  send?: WalletSend;
}

const KEY_BYTES = 32;
let opened: Promise<SQLiteDatabase> | null = null;

async function databaseKey(): Promise<string> {
  const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
  const existing = await SecureStore.getItemAsync(STORAGE_KEYS.ticketKey, options);
  if (existing) return existing;
  const key = toHex(getRandomBytes(KEY_BYTES));
  await SecureStore.setItemAsync(STORAGE_KEYS.ticketKey, key, options);
  return key;
}

async function open(): Promise<SQLiteDatabase> {
  const key = await databaseKey();
  const db = await openDatabaseAsync(TICKET_DB_NAME);
  // SQLCipher raw key (x'…' skips the passphrase KDF; the key is already 256 random bits).
  await db.execAsync(`PRAGMA key = "x'${key}'";`);
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS tickets (
      hash TEXT PRIMARY KEY NOT NULL,
      network TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      body TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tickets_network ON tickets (network, created_at);
    CREATE TABLE IF NOT EXISTS drafts (network TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL);
  `);
  if (Platform.OS === "ios") {
    await Zingo.excludeFromBackup(db.databasePath).catch(() => undefined);
  }
  return db;
}

export function ticketDb(): Promise<SQLiteDatabase> {
  opened ??= open().catch((error: unknown) => {
    opened = null;
    throw error;
  });
  return opened;
}

export async function loadTickets(network: Network): Promise<AppTicket[]> {
  const db = await ticketDb();
  const rows = await db.getAllAsync<{ body: string }>(
    "SELECT body FROM tickets WHERE network = ? ORDER BY created_at DESC",
    network,
  );
  return rows.map((row) => JSON.parse(row.body) as AppTicket);
}

export async function saveTicket(ticket: AppTicket): Promise<void> {
  const db = await ticketDb();
  await db.runAsync(
    "INSERT OR REPLACE INTO tickets (hash, network, created_at, body) VALUES (?, ?, ?, ?)",
    ticket.hash,
    ticket.network,
    ticket.createdAt,
    JSON.stringify(ticket),
  );
}

export async function loadDraft<T>(network: Network): Promise<T | null> {
  const db = await ticketDb();
  const row = await db.getFirstAsync<{ body: string }>("SELECT body FROM drafts WHERE network = ?", network);
  return row ? (JSON.parse(row.body) as T) : null;
}

export async function saveDraft(network: Network, draft: unknown): Promise<void> {
  const db = await ticketDb();
  if (draft === null) await db.runAsync("DELETE FROM drafts WHERE network = ?", network);
  else await db.runAsync("INSERT OR REPLACE INTO drafts (network, body) VALUES (?, ?)", network, JSON.stringify(draft));
}

/** Forget this device: drops the database file and its key. */
export async function eraseTickets(): Promise<void> {
  if (opened) {
    const db = await opened.catch(() => null);
    await db?.closeAsync().catch(() => undefined);
    opened = null;
  }
  await deleteDatabaseAsync(TICKET_DB_NAME).catch(() => undefined);
  await SecureStore.deleteItemAsync(STORAGE_KEYS.ticketKey).catch(() => undefined);
}
