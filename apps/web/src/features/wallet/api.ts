"use client";

import { fromBase64Url, type Network, type Trading } from "@kakure/domain";
import { ObliviousError, obliviousFetch } from "@kakure/ohttp";
import { loadBundleV2 } from "@kakure/query";
import { DATA_SOURCE } from "@/constants";

/**
 * The mint's API, every call through the Oblivious HTTP relay on this site's own origin (`/ohttp/<network>`): the relay
 * sees this device's IP but not the call; the operator sees the call but not the IP. The gateway key comes from the
 * signed bundle (`trading.gatewayKeys`), so every visitor encrypts to the same key. It rotates every hour.
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
  /** Trading (services/operator/src/trading.rs). */
  notTrading: 20_010,
  notOffered: 20_011,
  priceMoved: 20_012,
  noPrice: 20_013,
  overCap: 20_014,
  unknownPosition: 20_015,
  paid: 20_016,
  notSettled: 20_017,
} as const;

type Send = (gatewayKeys: string) => Promise<Response>;

/**
 * Sends a call; if the gateway says it no longer holds the key the bundle on screen named (the hour turned while this
 * device slept), fetches the current signed bundle and, when it names a different key, sends the same bytes to it once.
 * That's safe: the gateway couldn't read the first request, every spending call is answered from the mint's cache when
 * repeated (NUT-19), and every other call only reads. A forged rejection with no new key behind it is just a failure.
 */
async function sendToCurrentKey(network: Network, trading: Trading, send: Send): Promise<Response> {
  try {
    return await send(trading.gatewayKeys);
  } catch (error) {
    if (!(error instanceof ObliviousError && error.keyRejected)) throw error;
    const current = (await loadBundleV2(DATA_SOURCE, network).catch(() => null))?.trading;
    if (!current || current.gatewayKeys === trading.gatewayKeys) throw error;
    return send(current.gatewayKeys);
  }
}

export async function mintCall<T>(
  network: Network,
  trading: Trading,
  method: "GET" | "POST",
  path: string,
  body?: string,
): Promise<T> {
  let response: Response;
  try {
    response = await sendToCurrentKey(network, trading, (gatewayKeys) =>
      obliviousFetch({ relay: `/ohttp/${network}`, keyConfig: fromBase64Url(gatewayKeys) }, method, path, body),
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
