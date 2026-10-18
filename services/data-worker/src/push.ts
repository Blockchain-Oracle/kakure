import { fromBase64Url, type Network, OPERATOR_PUBLIC_KEYS, toHex } from "@kakure/domain";
import { signingInput } from "@kakure/signing";
import { LATEST_FILE } from "./constants";
import type { VerifiedFile } from "./store";

export type PushCheck = { ok: true; file: VerifiedFile } | { ok: false; reason: "malformed" | "unsigned" };

const BUNDLE_FILE = /^bundle-\d+\.json$/;
const keys = new Map<Network, Promise<CryptoKey | null>>();

/**
 * Accepts a pushed file only when it is a document signed by the key pinned for its network, naming that network.
 * This is the push's whole authentication: the operator holds no write credential, and anything else is refused.
 * Verification uses the runtime's native Ed25519 (cheap on the free plan's CPU budget) over the exact signing input
 * the clients check (@kakure/signing). The bytes are stored as sent, so `SHA-256(file)` stays the published hash.
 */
export async function checkPush(network: Network, name: string, body: ArrayBuffer): Promise<PushCheck> {
  let document: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(body));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return { ok: false, reason: "malformed" };
    document = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (document.network !== network || typeof document.sig !== "string") return { ok: false, reason: "unsigned" };

  const key = await publicKey(network);
  let valid = false;
  try {
    const signature = fromBase64Url(document.sig);
    valid = key !== null && (await crypto.subtle.verify("Ed25519", key, signature, signingInput(document)));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "unsigned" };

  const sha256 = toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", body)));
  const requires: VerifiedFile["requires"] = [];
  let seq: number | null = null;
  if (name === LATEST_FILE) {
    if (typeof document.bundle !== "string" || typeof document.bundleHash !== "string") {
      return { ok: false, reason: "malformed" };
    }
    if (typeof document.seq !== "number") return { ok: false, reason: "malformed" };
    seq = document.seq;
    requires.push({ name: document.bundle, sha256: document.bundleHash });
  } else if (BUNDLE_FILE.test(name)) {
    if (typeof document.addresses !== "string") return { ok: false, reason: "malformed" };
    requires.push({ name: document.addresses, sha256: null });
  }
  return { ok: true, file: { name, body, sha256, seq, requires } };
}

function publicKey(network: Network): Promise<CryptoKey | null> {
  let key = keys.get(network);
  if (!key) {
    const hex = OPERATOR_PUBLIC_KEYS[network];
    key =
      hex === null ? Promise.resolve(null) : crypto.subtle.importKey("raw", fromHex(hex), "Ed25519", false, ["verify"]);
    keys.set(network, key);
  }
  return key;
}

function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
}
