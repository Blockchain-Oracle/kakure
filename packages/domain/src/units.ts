import { ZATOSHI_PER_ZEC, ZEC_DECIMALS } from "./constants";

const DECIMAL_ZEC = /^(\d+)(?:\.(\d{1,8}))?$/;

/** Formats zatoshi as a ZEC decimal with no trailing zeros, e.g. 1_000_000n → "0.01". */
export function zatToZec(zat: bigint): string {
  if (zat < 0n) {
    throw new RangeError("Amounts are never negative");
  }
  const whole = zat / ZATOSHI_PER_ZEC;
  const fraction = (zat % ZATOSHI_PER_ZEC).toString().padStart(ZEC_DECIMALS, "0").replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
}

/** Parses a ZEC decimal with at most 8 decimals (the ZIP 321 `amount` grammar) into zatoshi. */
export function zecToZat(zec: string): bigint {
  const match = DECIMAL_ZEC.exec(zec);
  if (!match) {
    throw new SyntaxError(`Not a ZEC amount: ${zec}`);
  }
  const [, whole = "0", fraction = ""] = match;
  return BigInt(whole) * ZATOSHI_PER_ZEC + BigInt(fraction.padEnd(ZEC_DECIMALS, "0"));
}
