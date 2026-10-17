import { fromBase64Url, toBase64Url } from "@kakure/domain";
import * as ed25519 from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { canonicalJson } from "./canonical";

export { CanonicalJsonError, type CanonicalValue, canonicalJson } from "./canonical";

// noble-ed25519 v3 needs a SHA-512 implementation wired in for its synchronous API.
ed25519.hashes.sha512 = sha512;

const SIGNATURE_FIELD = "sig";
const SIGNATURE_BYTES = 64;
const PUBLIC_KEY_BYTES = 32;

/** The signed message is the canonical JSON of the document without its `sig` field, as UTF-8. */
export function signingInput(document: Record<string, unknown>): Uint8Array {
  const { [SIGNATURE_FIELD]: _ignored, ...unsigned } = document;
  return new TextEncoder().encode(canonicalJson(unsigned));
}

/** Verifies a published file against the operator key pinned in the build (never fetched; plan §13.11). */
export function verifyDocument(document: Record<string, unknown>, publicKey: Uint8Array): boolean {
  const signature = document[SIGNATURE_FIELD];
  if (typeof signature !== "string" || publicKey.length !== PUBLIC_KEY_BYTES) {
    return false;
  }
  const signatureBytes = fromBase64Url(signature);
  if (signatureBytes.length !== SIGNATURE_BYTES) {
    return false;
  }
  try {
    return ed25519.verify(signatureBytes, signingInput(document), publicKey);
  } catch {
    return false;
  }
}

/** Signs a document (used by fixtures and tests; the operator signs in Rust with the same input). */
export function signDocument<T extends Record<string, unknown>>(
  document: T,
  secretKey: Uint8Array,
): T & { sig: string } {
  const signature = ed25519.sign(signingInput(document), secretKey);
  return { ...document, sig: toBase64Url(signature) };
}

export function publicKeyFor(secretKey: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(secretKey);
}
