/**
 * Canonical JSON for signing, the subset of RFC 8785 (JCS) Kakure needs:
 * object keys sorted by UTF-16 code units, no whitespace, strings and integers only (no floats, no NaN),
 * so the operator (Rust) and every client produce byte-identical input to the signature.
 */
export type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [key: string]: CanonicalValue };

export class CanonicalJsonError extends Error {
  override name = "CanonicalJsonError";
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new CanonicalJsonError(`Only safe integers can be signed (got ${value}); send amounts as strings`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  throw new CanonicalJsonError(`Cannot sign a value of type ${typeof value}`);
}
