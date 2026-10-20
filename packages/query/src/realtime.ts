import {
  BUNDLE_INTERVAL_SEC,
  type BundleV2,
  bundleV2Schema,
  type LatestV2,
  latestV2Schema,
  type Network,
  type Prints,
  printsSchema,
} from "@kakure/domain";
import { queryOptions, skipToken } from "@tanstack/react-query";
import { LATEST_FILE, MAX_RETRIES } from "./constants";
import { DataError, isDataError } from "./errors";
import { type DataSource, fetchSigned } from "./fetch";

/**
 * The real-time public files (plan §00, version 2): `latest.json` and its bundle every minute, and the hourly prints
 * files. Same rules as version 1: the network leads every key, every file is signature-checked before parsing, the
 * bundle must hash to what the pointer names, and every visitor loads the same files at the same times (PD14).
 */
const MS = 1_000;
const BUNDLE_INTERVAL_MS = BUNDLE_INTERVAL_SEC * MS;
/** The worker caches `latest.json` for 20 s; look a little after the next minute's publish has landed there. */
const LATEST_GRACE_MS = 25_000;
const LATEST_RETRY_MS = 15_000;

export const realtimeKeys = {
  latest: (network: Network) => [network, "rt", "latest"] as const,
  bundle: (network: Network, file: string) => [network, "rt", "bundle", file] as const,
  prints: (network: Network, files: readonly string[]) => [network, "rt", "prints", files.join(",")] as const,
  previous: (network: Network, seq: number, hash: string) => [network, "rt", "previous", seq, hash] as const,
};

function retry(failureCount: number, error: unknown): boolean {
  return isDataError(error) && error.retryable && failureCount < MAX_RETRIES;
}

/** Poll `latest.json` just after the next minute's bundle should be visible, then every 15 s while it is late. */
function latestRefetchInterval(latest: LatestV2 | null | undefined, now = Date.now()): number {
  if (!latest) return LATEST_RETRY_MS;
  const due = Date.parse(latest.publishedAt) + BUNDLE_INTERVAL_MS + LATEST_GRACE_MS - now;
  return due > 0 ? due : LATEST_RETRY_MS;
}

export function latestV2Query(source: DataSource, network: Network) {
  return queryOptions({
    queryKey: realtimeKeys.latest(network),
    queryFn: ({ signal }): Promise<LatestV2 | null> =>
      fetchSigned(source, network, LATEST_FILE, latestV2Schema, { allowMissing: true, signal }),
    staleTime: (query) => Math.min(BUNDLE_INTERVAL_MS, latestRefetchInterval(query.state.data)),
    refetchInterval: (query) => latestRefetchInterval(query.state.data),
    retry,
  });
}

export function bundleV2Query(source: DataSource, network: Network, latest: LatestV2 | null | undefined) {
  return queryOptions({
    queryKey: realtimeKeys.bundle(network, latest?.bundle ?? ""),
    queryFn: latest
      ? async ({ signal }): Promise<BundleV2> => {
          const bundle = await fetchSigned(source, network, latest.bundle, bundleV2Schema, {
            sha256: latest.bundleHash,
            signal,
          });
          if (!bundle) throw new DataError("missing", latest.bundle);
          if (bundle.seq !== latest.seq) {
            throw new DataError("mismatch", latest.bundle, `seq ${bundle.seq}, expected ${latest.seq}`);
          }
          return bundle;
        }
      : skipToken,
    // Immutable: once fetched, a bundle never needs fetching again.
    staleTime: Number.POSITIVE_INFINITY,
    // When `latest.json` names the next minute's bundle, the one on screen stays until it lands, so quotes, Windows and
    // open sheets never blink out each minute. Never across networks: a switch starts from nothing.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[0] === network ? previous : undefined),
    retry,
  });
}

/**
 * The chain check (Proof): the bundle before this one, fetched by name, must carry the operator's signature and hash
 * to this bundle's `previous`, so no minute can be dropped or swapped without the link breaking. Resolves to the
 * previous bundle's seq; throws a DataError when the link doesn't hold.
 */
export function previousBundleQuery(source: DataSource, network: Network, bundle: BundleV2 | null | undefined) {
  const previous = bundle?.previous ?? null;
  const seq = bundle ? bundle.seq - 1 : -1;
  return queryOptions({
    queryKey: realtimeKeys.previous(network, seq, previous ?? ""),
    queryFn:
      previous && seq >= 0
        ? async ({ signal }): Promise<number> => {
            const file = `bundle-${seq}.json`;
            const before = await fetchSigned(source, network, file, bundleV2Schema, { sha256: previous, signal });
            if (!before) throw new DataError("missing", file);
            if (before.seq !== seq) throw new DataError("mismatch", file, `seq ${before.seq}, expected ${seq}`);
            return before.seq;
          }
        : skipToken,
    staleTime: Number.POSITIVE_INFINITY,
    retry,
  });
}

/**
 * Every hourly prints file the bundle names, all at once: fetching only the hour being checked would tell the host
 * which Window you look at (audit O22). Each file is signature-checked and must name its own network.
 */
export function printsQuery(source: DataSource, network: Network, bundle: BundleV2 | null | undefined) {
  const files = bundle?.prints ?? [];
  return queryOptions({
    queryKey: realtimeKeys.prints(network, files),
    queryFn: bundle
      ? async ({ signal }): Promise<Prints[]> =>
          Promise.all(
            files.map(async (file) => {
              const prints = await fetchSigned(source, network, file, printsSchema, { signal });
              if (!prints) throw new DataError("missing", file);
              return prints;
            }),
          )
      : skipToken,
    staleTime: Number.POSITIVE_INFINITY,
    retry,
  });
}
