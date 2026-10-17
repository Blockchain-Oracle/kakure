"use client";

import { type Network, toHex } from "@kakure/domain";
import type { Ticket } from "@kakure/query";
import { TICKET_DB } from "@/constants";

/**
 * Tickets live only on this device, in IndexedDB, encrypted with AES-GCM under a non-extractable WebCrypto key
 * (plan §13.17). Each network has its own key and its own records (plan §13.16), so a testnet export can never
 * carry a mainnet ticket. Records are opaque `{ id, network, iv, data }`: not even the ticket hash is in the clear.
 */
interface SealedRecord {
  id: string;
  network: Network;
  iv: Uint8Array<ArrayBuffer>;
  data: ArrayBuffer;
}

const KEY_BITS = 256;
const IV_BYTES = 12;
const ALGORITHM = "AES-GCM";

let opening: Promise<IDBDatabase> | null = null;

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

async function networkKey(network: Network): Promise<CryptoKey> {
  const db = await open();
  const existing = await done(db.transaction(TICKET_DB.keys).objectStore(TICKET_DB.keys).get(network));
  if (existing instanceof CryptoKey) return existing;
  // Non-extractable: the key can be used here but never read out, not even by this page's own code.
  const key = await crypto.subtle.generateKey({ name: ALGORITHM, length: KEY_BITS }, false, ["encrypt", "decrypt"]);
  await done(db.transaction(TICKET_DB.keys, "readwrite").objectStore(TICKET_DB.keys).put(key, network));
  return key;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function loadTickets(network: Network): Promise<Ticket[]> {
  const db = await open();
  const key = await networkKey(network);
  const records = (await done(
    db.transaction(TICKET_DB.tickets).objectStore(TICKET_DB.tickets).index("network").getAll(network),
  )) as SealedRecord[];
  const tickets: Ticket[] = [];
  for (const record of records) {
    try {
      const plain = await crypto.subtle.decrypt({ name: ALGORITHM, iv: record.iv }, key, record.data);
      tickets.push(JSON.parse(decoder.decode(plain)) as Ticket);
    } catch {
      // A record this key can't open (e.g. after the key was reset) is skipped, never shown half-read.
    }
  }
  return tickets.sort((a, b) => b.createdAt - a.createdAt);
}

/** Stores (or replaces) a ticket. The record id is the ticket hash, hashed again so it isn't readable either. */
export async function saveTicket(ticket: Ticket): Promise<void> {
  const db = await open();
  const key = await networkKey(ticket.network);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const data = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, encoder.encode(JSON.stringify(ticket)));
  const id = toHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(`${ticket.network}:${ticket.hash}`))),
  );
  const record: SealedRecord = { id, network: ticket.network, iv, data };
  await done(db.transaction(TICKET_DB.tickets, "readwrite").objectStore(TICKET_DB.tickets).put(record));
}

/** Forget this device: the whole ticket database, keys included. */
export async function deleteTicketDatabase(): Promise<void> {
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
