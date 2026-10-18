"use client";

import { EXPORT_KDF_ITERATIONS } from "@/constants";

/**
 * The one passphrase KDF on the web (plan §2 Device storage, §13.17): PBKDF2-SHA-256 → AES-GCM-256, used for
 * export files and for the optional ticket-store lock.
 */
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
export const KEY_BITS = 256;
export const KDF_ITERATIONS = EXPORT_KDF_ITERATIONS;

const encoder = new TextEncoder();

export async function passphraseKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: KEY_BITS },
    false,
    usages,
  );
}
