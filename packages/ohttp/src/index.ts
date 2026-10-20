import { AEAD_AES_128_GCM, CipherSuite, KDF_HKDF_SHA256, KEM_DHKEM_X25519_HKDF_SHA256 } from "hpke";
import { KeyConfig, OHTTPClient } from "ohttp-ts";
import { HTTP_BAD_REQUEST, KEY_PROBLEM_TYPE, REQUEST_BUCKETS } from "./constants";

/**
 * Oblivious HTTP (RFC 9458) for Kakure's trading API (plan §00). Each call is Binary-HTTP encoded, HPKE-encrypted to the
 * operator gateway's key and POSTed to the relay (the data worker), which sees this device's IP but not the request;
 * the operator sees the request but not the IP. A fresh HPKE context per call (RFC 9458 §6.1). The key config comes
 * from the signed bundle, so every visitor encrypts to the same key and a relay can't swap it (§6.1, §7). Requests carry
 * no cookies, no referrer and no headers beyond the content type; a failed call is never retried on its own (§6.5).
 * The gateway's key rotates every hour: a request to a key it no longer holds fails with `keyRejected`, and the caller
 * decides whether a newer signed bundle names a different key to resend to.
 */

/** The one suite browsers, Workers and the Rust gateway all support. */
const SUITE = new CipherSuite(KEM_DHKEM_X25519_HKDF_SHA256, KDF_HKDF_SHA256, AEAD_AES_128_GCM);
const ORIGIN = "https://gateway.kakure";

/**
 * Request sizes, in Binary HTTP bytes (RFC 9292 §3.8 zero padding): every request lands in one of a few fixed sizes, so
 * its length says nothing about the call or how many chips it carries (privacy re-audit V4). The largest stays under
 * the relay's and gateway's 64 KiB limit with room for the OHTTP header, the HPKE key and the AEAD tag. The gateway
 * pads its responses the same way.
 */

export function paddedRequestLength(size: number): number {
  return REQUEST_BUCKETS.find((bucket) => bucket >= size) ?? size;
}

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
    /**
     * The gateway answered RFC 9458 §5.3's `ohttp-key` problem: it holds no key with this request's id, so it couldn't
     * read the request. That answer isn't encrypted, so a relay could forge it; a caller resends only to a different
     * key from a newer signed bundle, and only a request the mint answers the same way twice.
     */
    readonly keyRejected = false,
  ) {
    super(message);
  }
}

async function isKeyProblem(response: Response): Promise<boolean> {
  if (response.status !== HTTP_BAD_REQUEST) return false;
  const problem = (await response.json().catch(() => null)) as { type?: unknown } | null;
  return problem?.type === KEY_PROBLEM_TYPE;
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
  const client = new OHTTPClient(SUITE, config, { padding: paddedRequestLength });
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
  if (!outer.ok) {
    if (await isKeyProblem(outer)) throw new ObliviousError(outer.status, "the gateway's key has rotated", true);
    throw new ObliviousError(outer.status, `relay answered ${outer.status}`);
  }
  return context.decapsulateResponse(outer);
}
