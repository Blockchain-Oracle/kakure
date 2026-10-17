/** base64url without padding (RFC 4648 §5), as ZIP 321 requires for memos. */
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/;
const BYTES_PER_BASE64_GROUP = 3;
const HEX_RADIX = 16;
const HEX_DIGITS_PER_BYTE = 2;
const CHARS_PER_BASE64_GROUP = 4;

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** Decodes base64url; rejects `+`, `/` and `=`, which ZIP 321 says parsers MUST NOT accept. */
export function fromBase64Url(text: string): Uint8Array {
  if (!BASE64URL_PATTERN.test(text) || text.length % CHARS_PER_BASE64_GROUP === 1) {
    throw new SyntaxError("Not base64url without padding");
  }
  const remainder = text.length % CHARS_PER_BASE64_GROUP;
  const padded =
    text.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat(remainder === 0 ? 0 : CHARS_PER_BASE64_GROUP - remainder);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Length in characters of `byteLength` bytes encoded as unpadded base64url. */
export function base64UrlLength(byteLength: number): number {
  const fullGroups = Math.floor(byteLength / BYTES_PER_BASE64_GROUP) * CHARS_PER_BASE64_GROUP;
  const tail = byteLength % BYTES_PER_BASE64_GROUP;
  return fullGroups + (tail === 0 ? 0 : tail + 1);
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(HEX_RADIX).padStart(HEX_DIGITS_PER_BYTE, "0")).join("");
}

export const utf8 = {
  encode: (text: string): Uint8Array => new TextEncoder().encode(text),
  decode: (bytes: Uint8Array): string => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
};
