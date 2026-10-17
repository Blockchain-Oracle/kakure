import { MEMO_MAX_BYTES, ZIP321_SCHEME } from "./constants";
import { fromBase64Url, toBase64Url, utf8 } from "./encoding";
import { zatToZec, zecToZat } from "./units";

/** One ZIP 321 payment. Kakure only ever builds and reads single-payment URIs. */
export interface PaymentRequest {
  address: string;
  amountZat: bigint;
  /** Plain-text memo (wallets like Zodl iOS drop non-text memos). */
  memo?: string;
}

export class PaymentUriError extends Error {
  override name = "PaymentUriError";
}

const MEMO_PARAM = "memo";
const AMOUNT_PARAM = "amount";
const ADDRESS_PARAM = "address";
const QUERY_SEPARATOR = "?";
const PARAM_SEPARATOR = "&";
const VALUE_SEPARATOR = "=";
/** Parameters with an index (`address.1`) mean several payments, which Kakure never builds or accepts. */
const INDEXED_PARAM = /\.\d+$/;
/** ZIP 321: parameters prefixed `req-` are required; an unknown one makes the URI unusable. */
const REQUIRED_PREFIX = "req-";

/** Builds `zcash:<address>?amount=<ZEC>&memo=<base64url>` (ZIP 321: base64url without padding, ≤ 512 bytes). */
export function buildPaymentUri(request: PaymentRequest): string {
  const params = [`${AMOUNT_PARAM}=${zatToZec(request.amountZat)}`];
  if (request.memo !== undefined) {
    const bytes = utf8.encode(request.memo);
    if (bytes.length > MEMO_MAX_BYTES) {
      throw new PaymentUriError(`Memo is longer than ${MEMO_MAX_BYTES} bytes`);
    }
    params.push(`${MEMO_PARAM}=${toBase64Url(bytes)}`);
  }
  return `${ZIP321_SCHEME}${request.address}${QUERY_SEPARATOR}${params.join(PARAM_SEPARATOR)}`;
}

/**
 * Parses a single-payment ZIP 321 URI (address in the hier-part or as `address=`).
 * Rejects multi-payment URIs, unknown `req-` parameters, duplicate parameters and non-text memos.
 */
export function parsePaymentUri(uri: string): PaymentRequest {
  if (!uri.toLowerCase().startsWith(ZIP321_SCHEME)) {
    throw new PaymentUriError("Not a zcash: URI");
  }
  const body = uri.slice(ZIP321_SCHEME.length);
  const queryAt = body.indexOf(QUERY_SEPARATOR);
  const hierAddress = queryAt === -1 ? body : body.slice(0, queryAt);
  const query = queryAt === -1 ? "" : body.slice(queryAt + 1);

  const params = new Map<string, string>();
  for (const pair of query.split(PARAM_SEPARATOR).filter(Boolean)) {
    const at = pair.indexOf(VALUE_SEPARATOR);
    const key = at === -1 ? pair : pair.slice(0, at);
    const value = at === -1 ? "" : decodeURIComponent(pair.slice(at + 1));
    if (INDEXED_PARAM.test(key)) {
      throw new PaymentUriError("Multi-payment URIs are not supported");
    }
    if (params.has(key)) {
      throw new PaymentUriError(`Duplicate parameter: ${key}`);
    }
    if (key.startsWith(REQUIRED_PREFIX)) {
      throw new PaymentUriError(`Unsupported required parameter: ${key}`);
    }
    params.set(key, value);
  }

  const address = hierAddress || params.get(ADDRESS_PARAM) || "";
  if (!address || (hierAddress && params.has(ADDRESS_PARAM))) {
    throw new PaymentUriError("Exactly one address is required");
  }
  const amountText = params.get(AMOUNT_PARAM);
  if (amountText === undefined) {
    throw new PaymentUriError("Amount is required");
  }

  const request: PaymentRequest = { address, amountZat: zecToZat(amountText) };
  const memoText = params.get(MEMO_PARAM);
  if (memoText !== undefined) {
    const bytes = fromBase64Url(memoText);
    if (bytes.length > MEMO_MAX_BYTES) {
      throw new PaymentUriError("Memo too long");
    }
    request.memo = utf8.decode(bytes);
  }
  return request;
}
