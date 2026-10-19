import { type BundleV2, type LatestV2, NETWORKS, type Network } from "@kakure/domain";
import { useQuery } from "@tanstack/react-query";
import { createElement } from "react";
import { DataError, isDataError } from "./errors";
import type { DataSource } from "./fetch";
import { bundleV2Query, latestV2Query } from "./realtime";

export type RealtimeData =
  | { status: "loading" }
  | { status: "unpublished"; refetch: () => void }
  | { status: "error"; error: DataError; refetch: () => void }
  | {
      status: "ready";
      latest: LatestV2;
      bundle: BundleV2;
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

/** The real-time load every visitor makes (PD14): latest → bundle, the same files for everyone, every minute. */
export function useRealtimeData(source: DataSource, network: Network): RealtimeData {
  const latest = useQuery(latestV2Query(source, network));
  const bundle = useQuery(bundleV2Query(source, network, latest.data));
  const refetch = () => {
    void latest.refetch();
  };
  if (latest.data === null) return { status: "unpublished", refetch };
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
  if (error) return { status: "error", error: asDataError(error), refetch };
  return { status: "loading" };
}

function NetworkLoad({ source, network }: { source: DataSource; network: Network }) {
  const latest = useQuery(latestV2Query(source, network));
  useQuery(bundleV2Query(source, network, latest.data));
  return null;
}

/**
 * Mount once at the app root (O8): keeps BOTH networks' real-time files loaded and polled, whichever network is on
 * screen, so the host sees the same requests at the same times from every visitor.
 */
export function UniformRealtimeLoad({ source }: { source: DataSource }) {
  return NETWORKS.map((network) => createElement(NetworkLoad, { key: network, source, network }));
}
