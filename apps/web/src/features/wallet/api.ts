"use client";

import { fromBase64Url, type Network, type Trading } from "@kakure/domain";
import { obliviousFetch } from "@kakure/ohttp";

/**
 * The mint's API, every call through the Oblivious HTTP relay on this site's own origin (`/ohttp/<network>`): the relay
 * sees this device's IP but not the call; the operator sees the call but not the IP. The gateway key comes from the
 * signed bundle (`trading.gatewayKeys`), so every visitor encrypts to the same key.
 */
const HTTP_OK = 200;

export class MintError extends Error {
  constructor(
    /** A NUT error code (11001 already spent, …) or Kakure's (20001 deposit short, …); 0 for a transport failure. */
    readonly code: number,
    message: string,
    /** True when the mint answered: nothing happened and nothing is pending. */
    readonly refused: boolean,
  ) {
    super(message);
  }
}

export const MINT_CODES = {
  alreadySpent: 11_001,
  depositShort: 20_001,
  badAddress: 20_002,
  tooSmall: 20_003,
} as const;

export async function mintCall<T>(
  network: Network,
  trading: Trading,
  method: "GET" | "POST",
  path: string,
  body?: string,
): Promise<T> {
  let response: Response;
  try {
    response = await obliviousFetch(
      { relay: `/ohttp/${network}`, keyConfig: fromBase64Url(trading.gatewayKeys) },
      method,
      path,
      body,
    );
  } catch (error) {
    throw new MintError(0, error instanceof Error ? error.message : "the relay didn't answer", false);
  }
  const json = (await response.json().catch(() => null)) as { detail?: string; code?: number } | null;
  if (response.status !== HTTP_OK) {
    throw new MintError(json?.code ?? 0, json?.detail ?? `the mint answered ${response.status}`, true);
  }
  return json as T;
}
