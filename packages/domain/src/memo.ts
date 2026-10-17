import {
  CLOSE_SIDES,
  EVENT_SIDES,
  MARKET_ID_PATTERN,
  MEMO_FIELD_SEPARATOR,
  MEMO_FIELDS,
  MEMO_KEY_SEPARATOR,
  MEMO_MAX_BYTES,
  MEMO_PREFIX,
  NETWORK_MEMO_CODE,
  NETWORKS,
  type Network,
  NONCE_B64URL_LENGTH,
  NONCE_BYTES,
  type Side,
  TICKET_SIZES_ZAT,
} from "./constants";
import { fromBase64Url, toBase64Url, utf8 } from "./encoding";

/** Everything a bet carries. The memo holds no identity: no names, emails or wallet IDs (L16, D12). */
export interface BetMemo {
  network: Network;
  marketId: string;
  side: Side;
  sizeZat: bigint;
  /** 16 random bytes, generated on the bettor's device only. */
  nonce: Uint8Array;
  /** A fresh Unified Address with an Orchard receiver; the payout or refund goes here. */
  payoutAddress: string;
}

export class MemoError extends Error {
  override name = "MemoError";
}

const SIDES: readonly string[] = [...CLOSE_SIDES, ...EVENT_SIDES];
const UNIFIED_ADDRESS = /^u(test)?1[02-9ac-hj-np-z]+$/;
/** Zingo appends "\nReply to:\n<address>" to some memos; our memo never contains a newline. */
const FIRST_LINE = /^[^\n\r]*/;

/** Builds the plain-text memo: `kakure:v1;n=<net>;m=<market>;s=<side>;z=<zat>;k=<nonce>;p=<payout UA>`. */
export function encodeBetMemo(bet: BetMemo): string {
  assertValid(bet);
  const values: Record<(typeof MEMO_FIELDS)[number], string> = {
    n: NETWORK_MEMO_CODE[bet.network],
    m: bet.marketId,
    s: bet.side,
    z: bet.sizeZat.toString(),
    k: toBase64Url(bet.nonce),
    p: bet.payoutAddress,
  };
  const memo = [MEMO_PREFIX, ...MEMO_FIELDS.map((key) => `${key}${MEMO_KEY_SEPARATOR}${values[key]}`)].join(
    MEMO_FIELD_SEPARATOR,
  );
  if (utf8.encode(memo).length > MEMO_MAX_BYTES) {
    throw new MemoError(`Memo is longer than ${MEMO_MAX_BYTES} bytes`);
  }
  return memo;
}

/** Parses a received memo. Strict: exact prefix, exact field order, no unknown fields. */
export function decodeBetMemo(raw: string): BetMemo {
  const memo = (FIRST_LINE.exec(raw)?.[0] ?? "").trim();
  if (utf8.encode(memo).length > MEMO_MAX_BYTES) {
    throw new MemoError("Memo too long");
  }
  const [prefix, ...fields] = memo.split(MEMO_FIELD_SEPARATOR);
  if (prefix !== MEMO_PREFIX || fields.length !== MEMO_FIELDS.length) {
    throw new MemoError("Not a Kakure bet memo");
  }

  const values = new Map<string, string>();
  fields.forEach((field, index) => {
    const at = field.indexOf(MEMO_KEY_SEPARATOR);
    const key = field.slice(0, at);
    if (at < 1 || key !== MEMO_FIELDS[index]) {
      throw new MemoError(`Expected field ${MEMO_FIELDS[index]} at position ${index}`);
    }
    values.set(key, field.slice(at + 1));
  });

  const networkCode = values.get("n");
  const network = NETWORKS.find((candidate) => NETWORK_MEMO_CODE[candidate] === networkCode);
  if (!network) {
    throw new MemoError(`Unknown network code: ${networkCode}`);
  }
  const sizeText = values.get("z") ?? "";
  if (!/^\d+$/.test(sizeText)) {
    throw new MemoError("Ticket size is not an integer");
  }
  const nonceText = values.get("k") ?? "";
  if (nonceText.length !== NONCE_B64URL_LENGTH) {
    throw new MemoError("Nonce has the wrong length");
  }

  const bet: BetMemo = {
    network,
    marketId: values.get("m") ?? "",
    side: (values.get("s") ?? "") as Side,
    sizeZat: BigInt(sizeText),
    nonce: fromBase64Url(nonceText),
    payoutAddress: values.get("p") ?? "",
  };
  assertValid(bet);
  return bet;
}

/** Generates the per-ticket nonce with the platform CSPRNG (Web Crypto; React Native via expo-crypto's polyfill). */
export function newNonce(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
}

function assertValid(bet: BetMemo): void {
  if (!MARKET_ID_PATTERN.test(bet.marketId)) {
    throw new MemoError(`Bad market id: ${bet.marketId}`);
  }
  if (!SIDES.includes(bet.side)) {
    throw new MemoError(`Bad side: ${bet.side}`);
  }
  if (!TICKET_SIZES_ZAT.includes(bet.sizeZat)) {
    throw new MemoError(`Not a ticket size: ${bet.sizeZat}`);
  }
  if (bet.nonce.length !== NONCE_BYTES) {
    throw new MemoError("Nonce must be 16 bytes");
  }
  // Shape only. The Orchard-receiver check (PD18) needs the F4Jumble decoder in @kakure/zaddr-wasm,
  // and the operator re-checks it at ingest.
  if (!UNIFIED_ADDRESS.test(bet.payoutAddress) || bet.payoutAddress.includes(MEMO_FIELD_SEPARATOR)) {
    throw new MemoError("Payout address must be a Unified Address");
  }
  const testnetAddress = bet.payoutAddress.startsWith("utest1");
  if (testnetAddress !== (bet.network === "testnet")) {
    throw new MemoError("Payout address is for the other network");
  }
}
