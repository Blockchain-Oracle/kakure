/**
 * Request sizes, in Binary HTTP bytes, that every Oblivious HTTP request is padded up to (RFC 9292 §3.8): 4, 16 and 60
 * KiB. The largest stays under the relay's and gateway's 64 KiB limit with room for the OHTTP header, the HPKE key and
 * the AEAD tag (privacy re-audit V4).
 */
export const REQUEST_BUCKETS = [4 * 1024, 16 * 1024, 60 * 1024] as const;
