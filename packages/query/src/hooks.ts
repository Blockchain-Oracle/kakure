import { type AddressList, BATCH_INTERVAL_MS, type Bundle, type Latest, NETWORKS, type Network } from "@kakure/domain";
import { useQuery } from "@tanstack/react-query";
import { createElement } from "react";
import { PUBLISH_GRACE_MS } from "./constants";
import { DataError, isDataError } from "./errors";
import type { DataSource } from "./fetch";
import { addressesQuery, bundleQuery, latestQuery, nextBatchAt } from "./options";

export type MarketData =
  | { status: "loading" }
  | { status: "unpublished"; refetch: () => void }
  | { status: "error"; error: DataError; refetch: () => void }
  | {
      status: "ready";
      latest: Latest;
      bundle: Bundle;
      /** The signed market-address list the bundle names (null while it loads or if it failed). */
      addresses: AddressList | null;
      /** When this device last fetched `latest.json` successfully (ms). */
      checkedAt: number;
      /** A refresh failed while cached data is still shown: mark it stale with its age (R7). */
      refreshError: DataError | null;
      isFetching: boolean;
      refetch: () => void;
    };

function asDataError(error: unknown): DataError {
  return isDataError(error) ? error : new DataError("unreachable", "data");
}

/**
 * The uniform load every visitor makes (PD14): latest → bundle → address list, the same files for everyone,
 * whichever market they look at. Screens read markets from the bundle; ids never reach the host.
 */
export function useMarketData(source: DataSource, network: Network): MarketData {
  const latest = useQuery(latestQuery(source, network));
  const bundle = useQuery(bundleQuery(source, network, latest.data));
  // Fetched for uniformity (every visitor loads it) and for the bet sheet; not needed to render the markets.
  const addresses = useQuery(addressesQuery(source, network, bundle.data));

  const refetch = () => {
    void latest.refetch();
  };

  if (latest.data === null) {
    return { status: "unpublished", refetch };
  }
  if (latest.data && bundle.data) {
    const refreshError = latest.error ?? bundle.error;
    return {
      status: "ready",
      latest: latest.data,
      bundle: bundle.data,
      addresses: addresses.data ?? null,
      checkedAt: latest.dataUpdatedAt,
      refreshError: refreshError ? asDataError(refreshError) : null,
      isFetching: latest.isFetching || bundle.isFetching,
      refetch,
    };
  }
  const error = latest.error ?? bundle.error;
  if (error) {
    return { status: "error", error: asDataError(error), refetch };
  }
  return { status: "loading" };
}

function NetworkLoad({ source, network }: { source: DataSource; network: Network }) {
  const latest = useQuery(latestQuery(source, network));
  const bundle = useQuery(bundleQuery(source, network, latest.data));
  useQuery(addressesQuery(source, network, bundle.data));
  return null;
}

/**
 * Mount once at the app root (O8): keeps BOTH networks' latest → bundle → address list loaded and polled, each on
 * its own publish clock, whichever network is on screen, so the host sees the same requests at the same times from
 * every visitor and can't tell which network you use. Screens share these queries through the cache.
 */
export function UniformLoad({ source }: { source: DataSource }) {
  return NETWORKS.map((network) => createElement(NetworkLoad, { key: network, source, network }));
}

/** Whether the published bundle is older than the clock says it should be (the operator missed a batch). */
export function bundleLateBy(latest: Pick<Latest, "publishedAt">, now: number): number {
  const late = now - (nextBatchAt(latest) + PUBLISH_GRACE_MS);
  return late > 0 ? late : 0;
}

export { BATCH_INTERVAL_MS };
