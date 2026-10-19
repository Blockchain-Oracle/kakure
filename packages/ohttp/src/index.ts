import { AEAD_AES_128_GCM, CipherSuite, KDF_HKDF_SHA256, KEM_DHKEM_X25519_HKDF_SHA256 } from "hpke";
import { KeyConfig, OHTTPClient } from "ohttp-ts";

/**
 * Oblivious HTTP (RFC 9458) for Kakure's trading API (plan §00). Each call is Binary-HTTP encoded, HPKE-encrypted to the
 * operator gateway's key and POSTed to the relay (the data worker), which sees this device's IP but not the request;
 * the operator sees the request but not the IP. A fresh HPKE context per call (RFC 9458 §6.1). The key config comes
 * from the signed bundle, so every visitor encrypts to the same key and a relay can't swap it (§6.1, §7). Requests carry
 * no cookies, no referrer and no headers beyond the content type; a failed call is never retried on its own (§6.5).
 */

/** The one suite browsers, Workers and the Rust gateway all support. */
const SUITE = new CipherSuite(KEM_DHKEM_X25519_HKDF_SHA256, KDF_HKDF_SHA256, AEAD_AES_128_GCM);
const ORIGIN = "https://gateway.kakure";

export interface Oblivious {
  /** The relay endpoint (`/ohttp` on the site's own origin). */
  relay: string;
  /** `application/ohttp-keys` bytes, from the signed bundle. */
  keyConfig: Uint8Array;
}

export class ObliviousError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * One API call through the relay: `GET /v1/…` or `POST /v1/…` with a JSON body, sent as the exact text given (a retry
 * resends the same bytes, which the mint's cached responses key on). Returns the inner response.
 */
export async function obliviousFetch(
  oblivious: Oblivious,
  method: "GET" | "POST",
  path: string,
  body?: string,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const config = KeyConfig.select(SUITE, KeyConfig.parseMultiple(oblivious.keyConfig));
  const client = new OHTTPClient(SUITE, config);
  const inner = new Request(`${ORIGIN}${path}`, {
    method,
    ...(body === undefined ? {} : { body, headers: { "content-type": "application/json" } }),
  });
  const { init, context } = await client.encapsulateRequest(inner);
  const outer = await fetcher(oblivious.relay, {
    ...init,
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: "no-store",
  });
  if (!outer.ok) throw new ObliviousError(outer.status, `relay answered ${outer.status}`);
  return context.decapsulateResponse(outer);
}
