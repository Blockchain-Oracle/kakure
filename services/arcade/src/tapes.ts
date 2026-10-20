import { cutTape, feedOf, type Tape } from "@kakure/arcade";
import {
  type BundleV2,
  bundleV2Schema,
  latestV2Schema,
  OPERATOR_PUBLIC_KEYS,
  type Prints,
  printsSchema,
} from "@kakure/domain";
import { verifyDocument } from "@kakure/signing";
import { hexToBytes } from "@noble/hashes/utils.js";
import { DATA_ORIGIN, DEV_KEYS, HOUR_SEC, LATEST_TTL_MS, PRINTS_HOURS, TAPE_NETWORK } from "./constants";

/**
 * Tapes from the signed hourly prints files (plan §0 R4): the same files every visitor downloads from the site, each
 * checked against the operator key pinned in the build before it's read. Prints files never change, so each is
 * fetched once; the bundle naming them is read again each minute.
 */
const MS = 1000;
const files = new Map<string, Prints>();
let latest: { at: number; bundle: BundleV2 } | null = null;

function operatorKey(): Uint8Array {
  const hex = DEV_KEYS[TAPE_NETWORK] ?? OPERATOR_PUBLIC_KEYS[TAPE_NETWORK];
  if (!hex) throw new Error(`no operator key for ${TAPE_NETWORK}`);
  return hexToBytes(hex);
}

async function signed<T extends { network: string }>(file: string, schema: { parse: (raw: unknown) => T }): Promise<T> {
  const response = await fetch(`${DATA_ORIGIN}/data/${TAPE_NETWORK}/${file}`);
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  const raw = (await response.json()) as Record<string, unknown>;
  if (!verifyDocument(raw, operatorKey())) throw new Error(`${file}: not signed by the operator`);
  const parsed = schema.parse(raw);
  if (parsed.network !== TAPE_NETWORK) throw new Error(`${file}: signed for ${parsed.network}`);
  return parsed;
}

export async function latestBundle(nowMs: number): Promise<BundleV2> {
  if (latest && nowMs - latest.at < LATEST_TTL_MS) return latest.bundle;
  const pointer = await signed("latest.json", latestV2Schema);
  latest = { at: nowMs, bundle: await signed(pointer.bundle, bundleV2Schema) };
  return latest.bundle;
}

async function prints(name: string): Promise<Prints> {
  const held = files.get(name);
  if (held) return held;
  const file = await signed(name, printsSchema);
  files.set(name, file);
  return file;
}

/**
 * The tape a seed rides: its feed's 1-minute closes from the feed's first voting exchange, over the twelve hours that
 * end with the newest prints file. Null when the files can't be read or hold too little (the run then plays on the
 * seed's own line, as Mitoshi's does when its index has nothing).
 */
export async function tapeFor(seed: string, nowMs: number): Promise<Tape | null> {
  try {
    const current = await latestBundle(nowMs);
    const names = current.prints.slice(-PRINTS_HOURS);
    const last = names.at(-1);
    if (!last) return null;
    const feed = feedOf(seed);
    const venue = current.lanes.find((lane) => lane.asset === feed)?.venues[0];
    if (!venue) return null;
    const loaded = await Promise.all(names.map(prints));
    const newest = loaded.at(-1);
    if (!newest) return null;
    const toSec = Date.parse(newest.hour) / MS + HOUR_SEC;
    const closes = loaded.flatMap((file) => file.closes[feed]?.[venue] ?? []);
    const tape = cutTape(feed, closes, toSec);
    return tape.points.length > 0 ? tape : null;
  } catch {
    return null;
  }
}
