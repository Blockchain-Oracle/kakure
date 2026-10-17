/**
 * Every way reading the public files can fail, so each screen can name the fix (kawase.md §3.3:
 * "errors that name the fix"). Only `offline` and `unreachable` are worth retrying.
 */
export type DataErrorKind =
  | "offline" // the device has no connection
  | "unreachable" // the data host didn't answer
  | "http" // the host answered with an error status
  | "missing" // a file named by a signed file is not there
  | "format" // not JSON, or not the frozen schema
  | "signature" // the signature doesn't match the pinned key
  | "key-not-pinned" // this build has no operator key for the network
  | "mismatch"; // a valid file for another network or another batch

export class DataError extends Error {
  override name = "DataError";

  constructor(
    readonly kind: DataErrorKind,
    readonly file: string,
    detail?: string,
  ) {
    super(detail ? `${kind}: ${file} (${detail})` : `${kind}: ${file}`);
  }

  get retryable(): boolean {
    return this.kind === "offline" || this.kind === "unreachable" || this.kind === "http";
  }
}

export function isDataError(error: unknown): error is DataError {
  return error instanceof DataError;
}
