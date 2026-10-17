// biome-ignore-all lint/style/noMagicNumbers: UTF-8 byte ranges and masks (RFC 3629) read best as hex literals.
import { getRandomValues } from "expo-crypto";

/**
 * Web APIs the shared packages use (@kakure/domain, query, signing) that Hermes may not provide.
 * Each is installed only when missing, so the platform's own wins wherever it exists.
 */
type Global = typeof globalThis & {
  crypto?: { getRandomValues?: <T extends ArrayBufferView | null>(array: T) => T };
};
const scope = globalThis as Global;

if (typeof scope.crypto?.getRandomValues !== "function") {
  // expo-crypto fills typed arrays from the platform CSPRNG (SecRandomCopyBytes / SecureRandom).
  const crypto = scope.crypto ?? {};
  crypto.getRandomValues = getRandomValues as never;
  scope.crypto = crypto;
}

const REPLACEMENT = 0xfffd;
const CONTINUATION_MASK = 0xc0;
const CONTINUATION = 0x80;
const SIX_BITS = 0x3f;

/** A strict UTF-8 decoder (with `fatal`), for engines without TextDecoder. */
class Utf8Decoder {
  readonly encoding = "utf-8";
  readonly fatal: boolean;

  constructor(label = "utf-8", options: { fatal?: boolean } = {}) {
    if (label.toLowerCase().replace("-", "") !== "utf8") throw new RangeError(`Unsupported encoding: ${label}`);
    this.fatal = options.fatal ?? false;
  }

  decode(input?: ArrayBuffer | ArrayBufferView): string {
    if (!input) return "";
    const bytes =
      input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    const points: number[] = [];
    let index = 0;
    while (index < bytes.length) {
      const first = bytes[index] ?? 0;
      const length = first < 0x80 ? 1 : first >= 0xf0 && first < 0xf5 ? 4 : first >= 0xe0 ? 3 : first >= 0xc2 ? 2 : 0;
      if (length === 0 || index + length > bytes.length) {
        if (this.fatal) throw new TypeError("The encoded data was not valid UTF-8");
        points.push(REPLACEMENT);
        index += 1;
        continue;
      }
      let point = length === 1 ? first : first & (0xff >> (length + 1));
      let valid = true;
      for (let offset = 1; offset < length; offset += 1) {
        const next = bytes[index + offset] ?? 0;
        if ((next & CONTINUATION_MASK) !== CONTINUATION) valid = false;
        point = (point << 6) | (next & SIX_BITS);
      }
      const overlong = (length === 3 && point < 0x800) || (length === 4 && point < 0x10000);
      if (!valid || overlong || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) {
        if (this.fatal) throw new TypeError("The encoded data was not valid UTF-8");
        points.push(REPLACEMENT);
        index += 1;
        continue;
      }
      points.push(point);
      index += length;
    }
    let text = "";
    const CHUNK = 4096;
    for (let start = 0; start < points.length; start += CHUNK) {
      text += String.fromCodePoint(...points.slice(start, start + CHUNK));
    }
    return text;
  }
}

/** A usable TextDecoder exists and honours `fatal` (rejects a lone 0xFF). */
function decoderWorks(): boolean {
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder("utf-8", { fatal: true });
  } catch {
    return false;
  }
  try {
    decoder.decode(new Uint8Array([0xff]));
    return false;
  } catch {
    return true;
  }
}

if (typeof globalThis.TextDecoder === "undefined" || !decoderWorks()) {
  (globalThis as { TextDecoder: unknown }).TextDecoder = Utf8Decoder;
}
