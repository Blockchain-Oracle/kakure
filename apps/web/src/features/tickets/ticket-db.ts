"use client";

import { fromBase64Url, NETWORKS, type Network, toBase64Url, toHex } from "@kakure/domain";
import type { Ticket } from "@kakure/query";
import { TICKET_DB } from "@/constants";
import { IV_BYTES, KDF_ITERATIONS, KEY_BITS, passphraseKey, SALT_BYTES } from "./passphrase";

/**
 * Tickets live only on this device, in IndexedDB, encrypted with AES-GCM (plan §13.17). Each network has its own key
 * and its own records (plan §13.16), so a testnet export can never carry a mainnet ticket. Records are opaque
 * `{ id, network, iv, data }` with a random id (N4): nothing in a record, not even its id, is derived from the ticket
 * hash, so the published ticket lists can't be matched against this browser's storage. The ticket hash lives only
 * inside the ciphertext; replacing a ticket finds its record through an in-memory index built by decrypting.
 *
 * Keys, two ways:
 * - Default: a non-extractable WebCrypto key per network, stored next to the records. Any code on this page can
 *   use it, but nothing can read it out.
 * - With the optional passphrase lock (O23): no usable key is stored. Each network's key is kept only wrapped
 *   (AES-GCM under PBKDF2-SHA-256 of the passphrase, 310,000 iterations), and unwrapped into memory, as a
 *   non-extractable key, when you unlock; closing the tab or "Lock now" forgets it. Someone with this browser's
 *   files then sees only ciphertext.
 */
interface SealedRecord {
  id: string;
  network: Network;
  iv: Uint8Array<ArrayBuffer>;
  data: ArrayBuffer;
}

/** The lock record, under LOCK_KEY in the keys store. */
interface LockRecord {
  v: 1;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  keys: Record<Network, { iv: string; wrapped: string }>;
}

const ALGORITHM = "AES-GCM";
const LOCK_KEY = "lock";

/** Thrown when the store is locked and no key is in memory: the UI asks for the passphrase. */
export class TicketsLockedError extends Error {
  override name = "TicketsLockedError";
}

let opening: Promise<IDBDatabase> | null = null;
/** Unwrapped keys while the lock is open, in memory only. */
const session = new Map<Network, CryptoKey>();

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(TICKET_DB.name, TICKET_DB.version);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TICKET_DB.keys)) db.createObjectStore(TICKET_DB.keys);
      if (!db.objectStoreNames.contains(TICKET_DB.tickets)) {
        db.createObjectStore(TICKET_DB.tickets, { keyPath: "id" }).createIndex("network", "network");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  opening.catch(() => {
    opening = null;
  });
  return opening;
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function readLock(db: IDBDatabase): Promise<LockRecord | null> {
  const value = await done(db.transaction(TICKET_DB.keys).objectStore(TICKET_DB.keys).get(LOCK_KEY));
  return (value as LockRecord | undefined) ?? null;
}

function newKey(extractable: boolean): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: ALGORITHM, length: KEY_BITS }, extractable, ["encrypt", "decrypt"]);
}

async function networkKey(network: Network): Promise<CryptoKey> {
  const db = await open();
  if (await readLock(db)) {
    const unlocked = session.get(network);
    if (!unlocked) throw new TicketsLockedError("The ticket store is locked.");
    return unlocked;
  }
  const existing = await done(db.transaction(TICKET_DB.keys).objectStore(TICKET_DB.keys).get(network));
  if (existing instanceof CryptoKey) return existing;
  // Non-extractable: the key can be used here but never read out, not even by this page's own code.
  const key = await newKey(false);
  await done(db.transaction(TICKET_DB.keys, "readwrite").objectStore(TICKET_DB.keys).put(key, network));
  return key;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Random 128-bit record id (N4). Ids from before were SHA-256 of the public ticket hash: 64 hex characters. */
const ID_BYTES = 16;
const LEGACY_ID = /^[0-9a-f]{64}$/;

function randomId(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(ID_BYTES)));
}

async function seal(ticket: Ticket, key: CryptoKey, id: string): Promise<SealedRecord> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const data = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, encoder.encode(JSON.stringify(ticket)));
  return { id, network: ticket.network, iv, data };
}

/** A network's decrypted tickets by ticket hash, with their record ids. In memory only, while the key is usable. */
type Index = Map<string, { id: string; ticket: Ticket }>;
const indexes = new Map<Network, Promise<Index>>();

/**
 * Decrypts a network's records once and indexes them. Old records keyed by the hash of their ticket get a random id
 * here (the ciphertext is unchanged), and duplicates of one ticket are dropped, in one transaction.
 */
async function readAndMigrate(network: Network, key: CryptoKey): Promise<Index> {
  const db = await open();
  const records = (await done(
    db.transaction(TICKET_DB.tickets).objectStore(TICKET_DB.tickets).index("network").getAll(network),
  )) as SealedRecord[];
  const index: Index = new Map();
  const moved: Array<{ from: string; record: SealedRecord }> = [];
  const dropped: string[] = [];
  for (const record of records) {
    let ticket: Ticket;
    try {
      const plain = await crypto.subtle.decrypt({ name: ALGORITHM, iv: record.iv }, key, record.data);
      ticket = JSON.parse(decoder.decode(plain)) as Ticket;
    } catch {
      // A record this key can't open (e.g. after the key was reset) is skipped, never shown half-read.
      continue;
    }
    if (index.has(ticket.hash)) {
      dropped.push(record.id);
      continue;
    }
    const id = LEGACY_ID.test(record.id) ? randomId() : record.id;
    if (id !== record.id) moved.push({ from: record.id, record: { ...record, id } });
    index.set(ticket.hash, { id, ticket });
  }
  if (moved.length > 0 || dropped.length > 0) {
    const transaction = db.transaction(TICKET_DB.tickets, "readwrite");
    const store = transaction.objectStore(TICKET_DB.tickets);
    for (const { from, record } of moved) {
      store.delete(from);
      store.put(record);
    }
    for (const id of dropped) store.delete(id);
    await committed(transaction);
  }
  return index;
}

function indexOf(network: Network): Promise<Index> {
  let index = indexes.get(network);
  if (!index) {
    const pending = networkKey(network).then((key) => readAndMigrate(network, key));
    pending.catch(() => {
      if (indexes.get(network) === pending) indexes.delete(network);
    });
    indexes.set(network, pending);
    index = pending;
  }
  return index;
}

async function readAll(network: Network): Promise<Ticket[]> {
  return [...(await indexOf(network)).values()].map((entry) => entry.ticket);
}

export async function loadTickets(network: Network): Promise<Ticket[]> {
  return (await readAll(network)).sort((a, b) => b.createdAt - a.createdAt);
}

/** Stores (or replaces) a ticket: a new random record id, or the id its earlier version already has. */
export async function saveTicket(ticket: Ticket): Promise<void> {
  const db = await open();
  const index = await indexOf(ticket.network);
  const id = index.get(ticket.hash)?.id ?? randomId();
  const record = await seal(ticket, await networkKey(ticket.network), id);
  await done(db.transaction(TICKET_DB.tickets, "readwrite").objectStore(TICKET_DB.tickets).put(record));
  index.set(ticket.hash, { id, ticket });
}

// ── The optional passphrase lock (O23, plan §13.17)

export type LockState = "off" | "locked" | "unlocked";

export async function lockState(): Promise<LockState> {
  const lock = await readLock(await open());
  if (!lock) return "off";
  return NETWORKS.every((network) => session.has(network)) ? "unlocked" : "locked";
}

/**
 * Turns the lock on, or changes its passphrase while unlocked: every ticket is re-encrypted under fresh keys, and
 * those keys are stored only wrapped by the passphrase. One transaction swaps records and keys, so a failure leaves
 * the store as it was.
 */
export async function setLock(passphrase: string): Promise<void> {
  const db = await open();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const wrapping = await passphraseKey(passphrase, salt, KDF_ITERATIONS, ["wrapKey", "unwrapKey"]);
  const records: SealedRecord[] = [];
  const keys = {} as LockRecord["keys"];
  const unwrapped = new Map<Network, CryptoKey>();
  const freshIndexes = new Map<Network, Index>();
  for (const network of NETWORKS) {
    const tickets = await readAll(network);
    // Extractable only for this moment, to be wrapped; the copy kept in memory is unwrapped as non-extractable.
    const fresh = await newKey(true);
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const wrapped = await crypto.subtle.wrapKey("raw", fresh, wrapping, { name: ALGORITHM, iv });
    keys[network] = { iv: toBase64Url(iv), wrapped: toBase64Url(new Uint8Array(wrapped)) };
    const kept = await crypto.subtle.unwrapKey("raw", wrapped, wrapping, { name: ALGORITHM, iv }, ALGORITHM, false, [
      "encrypt",
      "decrypt",
    ]);
    unwrapped.set(network, kept);
    const index: Index = new Map();
    for (const ticket of tickets) {
      const id = randomId();
      records.push(await seal(ticket, kept, id));
      index.set(ticket.hash, { id, ticket });
    }
    freshIndexes.set(network, index);
  }
  const lock: LockRecord = {
    v: 1,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: KDF_ITERATIONS, salt: toBase64Url(salt) },
    keys,
  };
  const transaction = db.transaction([TICKET_DB.keys, TICKET_DB.tickets], "readwrite");
  const keyStore = transaction.objectStore(TICKET_DB.keys);
  const ticketStore = transaction.objectStore(TICKET_DB.tickets);
  ticketStore.clear();
  for (const record of records) ticketStore.put(record);
  for (const network of NETWORKS) keyStore.delete(network);
  keyStore.put(lock, LOCK_KEY);
  await committed(transaction);
  session.clear();
  for (const [network, key] of unwrapped) session.set(network, key);
  replaceIndexes(freshIndexes);
}

function replaceIndexes(next: Map<Network, Index>) {
  indexes.clear();
  for (const [network, index] of next) indexes.set(network, Promise.resolve(index));
}

/** Opens the lock for this tab. Returns false for a wrong passphrase. */
export async function unlock(passphrase: string): Promise<boolean> {
  const lock = await readLock(await open());
  if (!lock) return true;
  const salt = new Uint8Array(fromBase64Url(lock.kdf.salt));
  const wrapping = await passphraseKey(passphrase, salt, lock.kdf.iterations, ["unwrapKey"]);
  const opened = new Map<Network, CryptoKey>();
  try {
    for (const network of NETWORKS) {
      const entry = lock.keys[network];
      const key = await crypto.subtle.unwrapKey(
        "raw",
        new Uint8Array(fromBase64Url(entry.wrapped)),
        wrapping,
        { name: ALGORITHM, iv: new Uint8Array(fromBase64Url(entry.iv)) },
        ALGORITHM,
        false,
        ["encrypt", "decrypt"],
      );
      opened.set(network, key);
    }
  } catch {
    return false;
  }
  for (const [network, key] of opened) session.set(network, key);
  indexes.clear();
  return true;
}

/** Forgets the unwrapped keys: the store stays locked until the passphrase is entered again. */
export function lockNow(): void {
  session.clear();
  indexes.clear();
}

/** Turns the lock off (while unlocked): re-encrypts under fresh non-extractable stored keys, in one transaction. */
export async function removeLock(): Promise<void> {
  const db = await open();
  const records: SealedRecord[] = [];
  const plain = new Map<Network, CryptoKey>();
  const freshIndexes = new Map<Network, Index>();
  for (const network of NETWORKS) {
    const tickets = await readAll(network);
    const key = await newKey(false);
    plain.set(network, key);
    const index: Index = new Map();
    for (const ticket of tickets) {
      const id = randomId();
      records.push(await seal(ticket, key, id));
      index.set(ticket.hash, { id, ticket });
    }
    freshIndexes.set(network, index);
  }
  const transaction = db.transaction([TICKET_DB.keys, TICKET_DB.tickets], "readwrite");
  const keyStore = transaction.objectStore(TICKET_DB.keys);
  const ticketStore = transaction.objectStore(TICKET_DB.tickets);
  ticketStore.clear();
  for (const record of records) ticketStore.put(record);
  for (const [network, key] of plain) keyStore.put(key, network);
  keyStore.delete(LOCK_KEY);
  await committed(transaction);
  session.clear();
  replaceIndexes(freshIndexes);
}

/** Forget this device: the whole ticket database, keys and lock included. */
export async function deleteTicketDatabase(): Promise<void> {
  session.clear();
  indexes.clear();
  const db = await opening?.catch(() => null);
  db?.close();
  opening = null;
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(TICKET_DB.name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}
