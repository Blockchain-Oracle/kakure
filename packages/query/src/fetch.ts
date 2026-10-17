import { type Network, toHex } from "@kakure/domain";
import { verifyDocument } from "@kakure/signing";
import { sha256 } from "@noble/hashes/sha2.js";
import { HTTP_NOT_FOUND, OPERATOR_PUBLIC_KEYS, PUBLIC_KEY_HEX_LENGTH } from "./constants";
import { DataError } from "./errors";

/** Where the public files live: `<base>/<network>/<file>` (default `/data`, served by services/data-worker). */
export interface DataSource {
  base: string;
  /** Override for tests or React Native; defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Override the pinned keys (fixtures only). Production builds read OPERATOR_PUBLIC_KEYS. */
  keys?: Readonly<Record<Network, string | null>>;
}

/** The subset of a zod schema used here, so this package needs no direct zod import. */
interface Schema<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: { message: string } };
}

const HEX_PAIR = /^[0-9a-f]+$/i;
const HEX_RADIX = 16;
const HEX_CHARS_PER_BYTE = 2;

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length !== PUBLIC_KEY_HEX_LENGTH || !HEX_PAIR.test(hex)) {
    return null;
  }
  const bytes = new Uint8Array(hex.length / HEX_CHARS_PER_BYTE);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * HEX_CHARS_PER_BYTE, (i + 1) * HEX_CHARS_PER_BYTE), HEX_RADIX);
  }
  return bytes;
}

export function operatorKey(source: DataSource, network: Network): Uint8Array | null {
  const hex = (source.keys ?? OPERATOR_PUBLIC_KEYS)[network];
  return hex ? hexToBytes(hex) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * Fetches one public file the same way for every visitor (no ids, no cookies, no referrer; PD14),
 * verifies the operator's signature over the raw JSON, then validates the frozen schema.
 * The signature is checked before parsing so unknown fields can't slip past it.
 * When `sha256` is given (from `latest.bundleHash`), the exact file bytes must hash to it (BUNDLE_HASH_ALGORITHM);
 * `sha256Prefix` checks a content-addressed name such as `addresses-<first 8 hex>.json`.
 * Returns `null` for a 404 only when `allowMissing` is set (nothing published yet).
 */
export async function fetchSigned<T extends { network: Network }>(
  source: DataSource,
  network: Network,
  file: string,
  schema: Schema<T>,
  {
    allowMissing = false,
    sha256: expectedHash,
    sha256Prefix,
    signal,
  }: { allowMissing?: boolean; sha256?: string; sha256Prefix?: string; signal?: AbortSignal } = {},
): Promise<T | null> {
  const doFetch = source.fetch ?? fetch;
  const url = `${source.base.replace(/\/$/, "")}/${network}/${file}`;
  let response: Response;
  try {
    response = await doFetch(url, {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    throw new DataError(isOffline() ? "offline" : "unreachable", file);
  }
  if (response.status === HTTP_NOT_FOUND) {
    if (allowMissing) {
      return null;
    }
    throw new DataError("missing", file);
  }
  if (!response.ok) {
    throw new DataError("http", file, String(response.status));
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (expectedHash !== undefined || sha256Prefix !== undefined) {
    const digest = toHex(sha256(bytes));
    if (expectedHash !== undefined && digest !== expectedHash.toLowerCase()) {
      throw new DataError("mismatch", file, "SHA-256 differs from latest.bundleHash");
    }
    if (sha256Prefix !== undefined && !digest.startsWith(sha256Prefix)) {
      throw new DataError("mismatch", file, "SHA-256 differs from the hash in the file name");
    }
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new DataError("format", file, "not JSON");
  }

  const key = operatorKey(source, network);
  if (!key) {
    throw new DataError("key-not-pinned", file, network);
  }
  if (!isRecord(raw) || !verifyDocument(raw, key)) {
    throw new DataError("signature", file);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new DataError("format", file, parsed.error.message);
  }
  if (parsed.data.network !== network) {
    throw new DataError("mismatch", file, `signed for ${parsed.data.network}`);
  }
  return parsed.data;
}
