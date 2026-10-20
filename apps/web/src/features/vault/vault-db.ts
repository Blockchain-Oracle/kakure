"use client";

import { fromBase64Url, NETWORKS, type Network, toBase64Url, toHex } from "@kakure/domain";
import { VAULT_DB } from "@/constants";
import { IV_BYTES, KDF_ITERATIONS, KEY_BITS, passphraseKey, SALT_BYTES } from "./passphrase";

/**
 * The device vault (plan §00, §13.16–17): everything Kakure keeps for you lives only on this device, in one IndexedDB
 * database, encrypted with AES-GCM: tickets, chips (bearer money), deposits and spends in flight. Each network has its
 * own key and records, so a testnet backup can never carry mainnet value. One lock, one backup file and one Forget
 * cover all of it.
 *
 * Records are opaque `{ id, network, iv, data }` with a random id (N4): nothing stored, not even an id, is derived
 * from a ticket hash or a chip's `Y`, so nothing in this browser's files can be matched against what the operator
 * publishes or keeps. Inside the ciphertext each record is an entry `{ type, key, value }`; records from before the
 * vault are bare tickets and read as `ticket` entries.
 *
 * Changes that must happen together (a swap's old chips out and new chips in; a mint's chips in and its deposit
 * marked done) go through `commit`: one IndexedDB transaction, so a crash leaves the before or the after, never half.
 * Everything is encrypted before the transaction opens, because IndexedDB commits as soon as a transaction idles.
 *
 * Keys, two ways:
 * - Default: a non-extractable WebCrypto key per network, stored next to the records. Any code on this page can
 *   use it, but nothing can read it out.
 * - With the optional passphrase lock (O23): no usable key is stored. Each network's key is kept only wrapped
 *   (AES-GCM under PBKDF2-SHA-256 of the passphrase, 310,000 iterations), and unwrapped into memory, as a
 *   non-extractable key, when you unlock; closing the tab or "Lock now" forgets it. Someone with this browser's
 *   files then sees only ciphertext.
 */
export type EntryType = "ticket" | "chip" | "deposit" | "spend" | "position" | "episode" | "lucky";

export interface Entry<T = unknown> {
  type: EntryType;
  /**
   * Unique within its type and network: a ticket's hash, a chip's `Y`, a deposit's id, a spend's id, a position's lock,
   * an episode's position, a Lucky draw's seed.
   */
  key: string;
  value: T;
}

export type EntryRef = Pick<Entry, "type" | "key">;

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

/** Thrown when the vault is locked and no key is in memory: the UI asks for the passphrase. */
export class VaultLockedError extends Error {
  override name = "VaultLockedError";
}

let opening: Promise<IDBDatabase> | null = null;
/** Unwrapped keys while the lock is open, in memory only. */
const session = new Map<Network, CryptoKey>();

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(VAULT_DB.name, VAULT_DB.version);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(VAULT_DB.keys)) db.createObjectStore(VAULT_DB.keys);
      if (!db.objectStoreNames.contains(VAULT_DB.records)) {
        db.createObjectStore(VAULT_DB.records, { keyPath: "id" }).createIndex("network", "network");
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
  const value = await done(db.transaction(VAULT_DB.keys).objectStore(VAULT_DB.keys).get(LOCK_KEY));
  return (value as LockRecord | undefined) ?? null;
}

function newKey(extractable: boolean): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: ALGORITHM, length: KEY_BITS }, extractable, ["encrypt", "decrypt"]);
}

async function networkKey(network: Network): Promise<CryptoKey> {
  const db = await open();
  if (await readLock(db)) {
    const unlocked = session.get(network);
    if (!unlocked) throw new VaultLockedError("The vault is locked.");
    return unlocked;
  }
  const existing = await done(db.transaction(VAULT_DB.keys).objectStore(VAULT_DB.keys).get(network));
  if (existing instanceof CryptoKey) return existing;
  // Non-extractable: the key can be used here but never read out, not even by this page's own code.
  const key = await newKey(false);
  await done(db.transaction(VAULT_DB.keys, "readwrite").objectStore(VAULT_DB.keys).put(key, network));
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

async function seal(network: Network, entry: Entry, key: CryptoKey, id: string): Promise<SealedRecord> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const data = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, encoder.encode(JSON.stringify(entry)));
  return { id, network, iv, data };
}

/** An entry, or a bare ticket stored before the vault (it has a `hash` and no `type`). */
function asEntry(plain: unknown): Entry | null {
  if (typeof plain !== "object" || plain === null) return null;
  const record = plain as Partial<Entry> & { hash?: unknown };
  if (typeof record.type === "string" && typeof record.key === "string") return record as Entry;
  if (typeof record.hash === "string") return { type: "ticket", key: record.hash, value: plain };
  return null;
}

const logical = (entry: EntryRef) => `${entry.type}:${entry.key}`;

/** A network's decrypted entries by logical key, with their record ids. In memory only, while the key is usable. */
type Index = Map<string, { id: string; entry: Entry }>;
const indexes = new Map<Network, Promise<Index>>();

/**
 * Decrypts a network's records once and indexes them. Old records keyed by the hash of their ticket get a random id
 * here (the ciphertext is unchanged), and duplicates of one entry are dropped, in one transaction.
 */
async function readAndMigrate(network: Network, key: CryptoKey): Promise<Index> {
  const db = await open();
  const records = (await done(
    db.transaction(VAULT_DB.records).objectStore(VAULT_DB.records).index("network").getAll(network),
  )) as SealedRecord[];
  const index: Index = new Map();
  const moved: Array<{ from: string; record: SealedRecord }> = [];
  const dropped: string[] = [];
  for (const record of records) {
    let entry: Entry | null;
    try {
      const plain = await crypto.subtle.decrypt({ name: ALGORITHM, iv: record.iv }, key, record.data);
      entry = asEntry(JSON.parse(decoder.decode(plain)));
    } catch {
      // A record this key can't open (e.g. after the key was reset) is skipped, never shown half-read.
      continue;
    }
    if (!entry) continue;
    if (index.has(logical(entry))) {
      dropped.push(record.id);
      continue;
    }
    const id = LEGACY_ID.test(record.id) ? randomId() : record.id;
    if (id !== record.id) moved.push({ from: record.id, record: { ...record, id } });
    index.set(logical(entry), { id, entry });
  }
  if (moved.length > 0 || dropped.length > 0) {
    const transaction = db.transaction(VAULT_DB.records, "readwrite");
    const store = transaction.objectStore(VAULT_DB.records);
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

async function readAll(network: Network): Promise<Entry[]> {
  return [...(await indexOf(network)).values()].map((item) => item.entry);
}

/** A network's entries of the given types. Throws VaultLockedError while the lock is on and closed. */
export async function loadEntries<T>(network: Network, types: readonly EntryType[]): Promise<Entry<T>[]> {
  return (await readAll(network)).filter((entry) => types.includes(entry.type)) as Entry<T>[];
}

/** Writes `puts` and removes `deletes` in one transaction: all of it, or none. An entry's record id is kept. */
export async function commit(
  network: Network,
  puts: readonly Entry[],
  deletes: readonly EntryRef[] = [],
): Promise<void> {
  const db = await open();
  const index = await indexOf(network);
  const key = await networkKey(network);
  const sealed = await Promise.all(
    puts.map((entry) => seal(network, entry, key, index.get(logical(entry))?.id ?? randomId())),
  );
  const transaction = db.transaction(VAULT_DB.records, "readwrite");
  const store = transaction.objectStore(VAULT_DB.records);
  const removed: string[] = [];
  for (const ref of deletes) {
    const item = index.get(logical(ref));
    if (item) {
      store.delete(item.id);
      removed.push(logical(ref));
    }
  }
  for (const record of sealed) store.put(record);
  await committed(transaction);
  for (const name of removed) index.delete(name);
  puts.forEach((entry, i) => {
    const record = sealed[i];
    if (record) index.set(logical(entry), { id: record.id, entry });
  });
}

// ── Change notices: the ticket list and the wallet re-read the vault after a lock change, an import or Forget.

const listeners = new Set<() => void>();

export function onVaultReset(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function vaultReset(): void {
  for (const listener of listeners) listener();
}

// ── The optional passphrase lock (O23, plan §13.17)

export type LockState = "off" | "locked" | "unlocked";

export async function lockState(): Promise<LockState> {
  const lock = await readLock(await open());
  if (!lock) return "off";
  return NETWORKS.every((network) => session.has(network)) ? "unlocked" : "locked";
}

/** Every entry of every network re-sealed under fresh keys, replacing the whole records store in one transaction. */
async function resealAll(
  keyFor: (network: Network) => Promise<CryptoKey>,
): Promise<{ records: SealedRecord[]; fresh: Map<Network, Index> }> {
  const records: SealedRecord[] = [];
  const fresh = new Map<Network, Index>();
  for (const network of NETWORKS) {
    const entries = await readAll(network);
    const key = await keyFor(network);
    const index: Index = new Map();
    for (const entry of entries) {
      const id = randomId();
      records.push(await seal(network, entry, key, id));
      index.set(logical(entry), { id, entry });
    }
    fresh.set(network, index);
  }
  return { records, fresh };
}

function replaceIndexes(next: Map<Network, Index>) {
  indexes.clear();
  for (const [network, index] of next) indexes.set(network, Promise.resolve(index));
}

/**
 * Turns the lock on, or changes its passphrase while unlocked: every entry is re-encrypted under fresh keys, and
 * those keys are stored only wrapped by the passphrase. One transaction swaps records and keys, so a failure leaves
 * the vault as it was.
 */
export async function setLock(passphrase: string): Promise<void> {
  const db = await open();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const wrapping = await passphraseKey(passphrase, salt, KDF_ITERATIONS, ["wrapKey", "unwrapKey"]);
  const keys = {} as LockRecord["keys"];
  const unwrapped = new Map<Network, CryptoKey>();
  const { records, fresh } = await resealAll(async (network) => {
    // Extractable only for this moment, to be wrapped; the copy kept in memory is unwrapped as non-extractable.
    const extractable = await newKey(true);
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const wrapped = await crypto.subtle.wrapKey("raw", extractable, wrapping, { name: ALGORITHM, iv });
    keys[network] = { iv: toBase64Url(iv), wrapped: toBase64Url(new Uint8Array(wrapped)) };
    const kept = await crypto.subtle.unwrapKey("raw", wrapped, wrapping, { name: ALGORITHM, iv }, ALGORITHM, false, [
      "encrypt",
      "decrypt",
    ]);
    unwrapped.set(network, kept);
    return kept;
  });
  const lock: LockRecord = {
    v: 1,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: KDF_ITERATIONS, salt: toBase64Url(salt) },
    keys,
  };
  const transaction = db.transaction([VAULT_DB.keys, VAULT_DB.records], "readwrite");
  const keyStore = transaction.objectStore(VAULT_DB.keys);
  const recordStore = transaction.objectStore(VAULT_DB.records);
  recordStore.clear();
  for (const record of records) recordStore.put(record);
  for (const network of NETWORKS) keyStore.delete(network);
  keyStore.put(lock, LOCK_KEY);
  await committed(transaction);
  session.clear();
  for (const [network, key] of unwrapped) session.set(network, key);
  replaceIndexes(fresh);
  vaultReset();
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
  vaultReset();
  return true;
}

/** Forgets the unwrapped keys: the vault stays locked until the passphrase is entered again. */
export function lockNow(): void {
  session.clear();
  indexes.clear();
  vaultReset();
}

/** Turns the lock off (while unlocked): re-encrypts under fresh non-extractable stored keys, in one transaction. */
export async function removeLock(): Promise<void> {
  const db = await open();
  const plain = new Map<Network, CryptoKey>();
  const { records, fresh } = await resealAll(async (network) => {
    const key = await newKey(false);
    plain.set(network, key);
    return key;
  });
  const transaction = db.transaction([VAULT_DB.keys, VAULT_DB.records], "readwrite");
  const keyStore = transaction.objectStore(VAULT_DB.keys);
  const recordStore = transaction.objectStore(VAULT_DB.records);
  recordStore.clear();
  for (const record of records) recordStore.put(record);
  for (const [network, key] of plain) keyStore.put(key, network);
  keyStore.delete(LOCK_KEY);
  await committed(transaction);
  session.clear();
  replaceIndexes(fresh);
  vaultReset();
}

/** Forget this device: the whole vault, keys and lock included. */
export async function deleteVault(): Promise<void> {
  session.clear();
  indexes.clear();
  const db = await opening?.catch(() => null);
  db?.close();
  opening = null;
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(VAULT_DB.name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
  vaultReset();
}
