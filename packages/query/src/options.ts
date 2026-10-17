import { type AddressList, BATCH_INTERVAL_MS, type Bundle, type Latest, type Network } from "@kakure/domain";
import { queryOptions, skipToken } from "@tanstack/react-query";
import { LATEST_FILE, MAX_RETRIES, OVERDUE_POLL_MS, PUBLISH_GRACE_MS } from "./constants";
import { DataError, isDataError } from "./errors";
import { type DataSource, fetchSigned } from "./fetch";
import { addressListSchema, bundleSchema, latestSchema } from "./schemas";

/**
 * Every key starts with the network, so a switch never mixes mainnet and testnet data
 * and each network's cache can be persisted and cleared on its own (plan §13.16).
 */
export const queryKeys = {
  all: (network: Network) => [network] as const,
  latest: (network: Network) => [network, "latest"] as const,
  bundle: (network: Network, file: string) => [network, "bundle", file] as const,
  addresses: (network: Network, file: string) => [network, "addresses", file] as const,
};

/** Address lists are content-addressed: `addresses-<first 8 hex of the file's SHA-256>.json`. */
const ADDRESS_FILE = /^addresses-([0-9a-f]{8})\.json$/;

function retry(failureCount: number, error: unknown): boolean {
  return isDataError(error) && error.retryable && failureCount < MAX_RETRIES;
}

/** When the next bundle should be visible to clients: publish time + batch interval + edge cache. */
export function nextBatchAt(latest: Pick<Latest, "publishedAt">): number {
  return Date.parse(latest.publishedAt) + BATCH_INTERVAL_MS;
}

/** Poll `latest.json` right after the next batch should have landed, then every minute while it is late. */
function latestRefetchInterval(latest: Latest | null | undefined, now = Date.now()): number {
  if (!latest) {
    return OVERDUE_POLL_MS;
  }
  const due = nextBatchAt(latest) + PUBLISH_GRACE_MS - now;
  return due > 0 ? due : OVERDUE_POLL_MS;
}

/** `latest.json`: the signed pointer to the current bundle. `null` means nothing is published yet. */
export function latestQuery(source: DataSource, network: Network) {
  return queryOptions({
    queryKey: queryKeys.latest(network),
    queryFn: ({ signal }): Promise<Latest | null> =>
      fetchSigned(source, network, LATEST_FILE, latestSchema, { allowMissing: true, signal }),
    staleTime: BATCH_INTERVAL_MS,
    refetchInterval: (query) => latestRefetchInterval(query.state.data),
    retry,
  });
}

/** The bundle named by `latest.json`. Bundles are immutable; the seq inside must match the pointer. */
export function bundleQuery(source: DataSource, network: Network, latest: Latest | null | undefined) {
  return queryOptions({
    queryKey: queryKeys.bundle(network, latest?.bundle ?? ""),
    queryFn: latest
      ? async ({ signal }): Promise<Bundle> => {
          const bundle = await fetchSigned(source, network, latest.bundle, bundleSchema, {
            sha256: latest.bundleHash,
            signal,
          });
          if (!bundle) {
            throw new DataError("missing", latest.bundle);
          }
          if (bundle.seq !== latest.seq) {
            throw new DataError("mismatch", latest.bundle, `seq ${bundle.seq}, expected ${latest.seq}`);
          }
          return bundle;
        }
      : skipToken,
    staleTime: BATCH_INTERVAL_MS,
    retry,
  });
}

/** The signed list of market addresses the bundle points to; the bet builder picks one at random (D7). */
export function addressesQuery(source: DataSource, network: Network, bundle: Bundle | null | undefined) {
  return queryOptions({
    queryKey: queryKeys.addresses(network, bundle?.addresses ?? ""),
    queryFn: bundle
      ? async ({ signal }): Promise<AddressList> => {
          const prefix = ADDRESS_FILE.exec(bundle.addresses)?.[1];
          const list = await fetchSigned(source, network, bundle.addresses, addressListSchema, {
            ...(prefix ? { sha256Prefix: prefix } : {}),
            signal,
          });
          if (!list) {
            throw new DataError("missing", bundle.addresses);
          }
          return list;
        }
      : skipToken,
    staleTime: BATCH_INTERVAL_MS,
    retry,
  });
}
