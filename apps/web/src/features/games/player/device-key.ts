"use client";

import { publicKeyFor, signDocument } from "@kakure/signing";
import { STORAGE_PREFIX } from "@/constants";
import { safeStorage } from "@/lib/storage";
import { HEX_PAD, HEX_RADIX, SECRET_BYTES } from "./constants";

/**
 * This device's arcade key (plan §0 R4): an Ed25519 key made on the device the first time it's needed, kept in this
 * browser only. Its public half is the player the arcade service knows: a nickname is bound to it, and every claim and
 * score is signed by it. It holds no money and isn't in the vault backup; Forget this device clears it with the rest,
 * and the nickname goes with it.
 */
const KEY = `${STORAGE_PREFIX}arcade.key`;
const HEX = /^[0-9a-f]{64}$/;

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(HEX_RADIX).padStart(HEX_PAD, "0")).join("");
const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, HEX_RADIX));

let cached: { secret: Uint8Array; player: string } | null = null;

function load(): { secret: Uint8Array; player: string } {
  if (cached) return cached;
  let stored = safeStorage.getItem(KEY);
  if (!stored || !HEX.test(stored)) {
    stored = toHex(crypto.getRandomValues(new Uint8Array(SECRET_BYTES)));
    safeStorage.setItem(KEY, stored);
  }
  const secret = fromHex(stored);
  cached = { secret, player: toHex(publicKeyFor(secret)) };
  return cached;
}

/** The player key (hex) the service knows this device by. */
export function playerKey(): string {
  return load().player;
}

/** A document signed by this device's key (canonical JSON without `sig`, as the service verifies it). */
export function signAsPlayer<T extends Record<string, unknown>>(document: T): T & { sig: string } {
  return signDocument(document, load().secret);
}

/** Forget this device ran (or storage changed): the next read loads afresh. */
export function dropCachedKey(): void {
  cached = null;
}
