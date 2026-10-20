import {
  type AddressList,
  BATCH_INTERVAL_MS,
  type Bundle,
  type Latest,
  type Network,
  type Resolution,
} from "@kakure/domain";
import { queryOptions, skipToken } from "@tanstack/react-query";
import { LATEST_FILE, MAX_RETRIES, OVERDUE_POLL_MS, PUBLISH_GRACE_MS } from "./constants";
import { DataError, isDataError } from "./errors";
import { type DataSource, fetchSigned } from "./fetch";
import { addressListSchema, bundleSchema, latestSchema, resolutionSchema } from "./schemas";

/**
 * Every key starts with the network, so a switch never mixes mainnet and testnet data
 * and each network's cache can be persisted and cleared on its own (plan §13.16).
 */
export const queryKeys = {
  all: (network: Network) => [network] as const,
  latest: (network: Network) => [network, "latest"] as const,
  bundle: (network: Network, file: string) => [network, "bundle", file] as const,
  addresses: (network: Network, file: string) => [network, "addresses", file] as const,
  resolutions: (network: Network, bundleFile: string) => [network, "resolutions", bundleFile] as const,
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
    // Fresh for at most one batch interval, and never past the moment the next batch should be visible,
    // so a focus or a remount just after a publish fetches it instead of waiting out the interval.
    staleTime: (query) => Math.min(BATCH_INTERVAL_MS, latestRefetchInterval(query.state.data)),
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
    // The batch on screen stays until the next one lands; never across networks.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[0] === network ? previous : undefined),
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

/** Every resolution file a bundle names, sorted: the same set for everyone, whichever market is being checked. */
export function resolutionFiles(bundle: Bundle): string[] {
  const files = new Set<string>();
  for (const market of bundle.markets) if (market.resolution) files.add(market.resolution);
  return [...files].sort();
}

/**
 * All of a bundle's resolution evidence at once (O22): fetching one market's file would tell the host which
 * market you're checking, so /proof downloads the whole set the bundle names and reads each market's from it.
 * Each file is signature-checked, and must name the market that points to it.
 */
export function resolutionsQuery(source: DataSource, network: Network, bundle: Bundle | null | undefined) {
  const file = bundle ? `bundle-${bundle.seq}.json` : "";
  return queryOptions({
    queryKey: queryKeys.resolutions(network, file),
    queryFn: bundle
      ? async ({ signal }): Promise<Record<string, Resolution>> => {
          const names = resolutionFiles(bundle);
          const docs = await Promise.all(
            names.map((name) => fetchSigned(source, network, name, resolutionSchema, { signal })),
          );
          const byMarket: Record<string, Resolution> = {};
          docs.forEach((doc, index) => {
            const name = names[index] ?? "";
            if (!doc) throw new DataError("missing", name);
            const owner = bundle.markets.find((market) => market.resolution === name);
            if (owner && owner.id !== doc.market) {
              throw new DataError("mismatch", name, `names ${doc.market}, expected ${owner.id}`);
            }
            byMarket[doc.market] = doc;
          });
          return byMarket;
        }
      : skipToken,
    staleTime: BATCH_INTERVAL_MS,
    retry,
  });
}
