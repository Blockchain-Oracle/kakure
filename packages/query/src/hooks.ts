import { BATCH_INTERVAL_MS, type Bundle, type Latest, type Network } from "@kakure/domain";
import { useQuery } from "@tanstack/react-query";
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
  // Fetched for uniformity and for the bet sheet; not needed to render the markets.
  useQuery(addressesQuery(source, network, bundle.data));

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

/** Whether the published bundle is older than the clock says it should be (the operator missed a batch). */
export function bundleLateBy(latest: Pick<Latest, "publishedAt">, now: number): number {
  const late = now - (nextBatchAt(latest) + PUBLISH_GRACE_MS);
  return late > 0 ? late : 0;
}

export { BATCH_INTERVAL_MS };
