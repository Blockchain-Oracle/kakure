"use client";

import type { Network } from "@kakure/domain";
import { bundleLateBy, type DataError, type DataErrorKind } from "@kakure/query";
import { Button, cx, EmptyState } from "@kakure/ui-web";
import { CloudOff, FileX, KeyRound, RefreshCw, ShieldAlert, Unplug, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { DATA_SOURCE, NETWORK_LABEL } from "@/constants";
import { useOnline } from "@/lib/online";
import { formatAge, formatClock, useNow } from "@/lib/time";

interface Copy {
  icon: ReactNode;
  title: string;
  reason: (network: Network, file: string) => string;
  tone: "neutral" | "warn" | "destructive";
}

/** Every failure names its fix (kawase.md §3.3). Unverified data is never shown. */
const COPY: Record<DataErrorKind, Copy> = {
  offline: {
    icon: <WifiOff />,
    title: "You're offline",
    reason: () => "Reconnect and this page loads the latest signed batch on its own.",
    tone: "neutral",
  },
  unreachable: {
    icon: <CloudOff />,
    title: "Can't reach the data host",
    reason: () => `${DATA_SOURCE.base} didn't answer. Try again in a moment; nothing about you was sent.`,
    tone: "warn",
  },
  http: {
    icon: <CloudOff />,
    title: "The data host returned an error",
    reason: () => `${DATA_SOURCE.base} is up but refused the request. Try again in a moment.`,
    tone: "warn",
  },
  missing: {
    icon: <FileX />,
    title: "A published file is missing",
    reason: (_, file) => `latest.json names ${file}, which isn't on the host yet. It usually lands within a minute.`,
    tone: "warn",
  },
  format: {
    icon: <FileX />,
    title: "These files don't match this app",
    reason: () =>
      "The published files aren't schema v1. Reload to get the current app; if it persists, the operator needs to republish.",
    tone: "destructive",
  },
  signature: {
    icon: <ShieldAlert />,
    title: "Not signed by the Kakure operator",
    reason: () =>
      "This app only shows files signed with the operator key built into it, so nothing is shown rather than unverified odds.",
    tone: "destructive",
  },
  "key-not-pinned": {
    icon: <KeyRound />,
    title: "This build has no operator key",
    reason: (network) =>
      `There's no ${NETWORK_LABEL[network]} operator key pinned in packages/query/src/constants.ts, so published files can't be verified. Pin the key and rebuild.`,
    tone: "destructive",
  },
  mismatch: {
    icon: <Unplug />,
    title: "The published files don't line up",
    reason: (_, file) =>
      `${file} belongs to another batch or network. The next batch fixes this; try again in a minute.`,
    tone: "warn",
  },
};

export function DataErrorState({
  error,
  network,
  onRetry,
}: {
  error: DataError;
  network: Network;
  onRetry: () => void;
}) {
  const copy = COPY[error.kind];
  return (
    <EmptyState
      icon={copy.icon}
      tone={copy.tone}
      title={copy.title}
      reason={copy.reason(network, error.file)}
      detail={error.message}
      action={
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RefreshCw className="size-4" aria-hidden /> Try again
        </Button>
      }
    />
  );
}

/**
 * Marks shown data stale with its age (R7): offline, a failed refresh, or a bundle that is late on the clock.
 * Cached values stay at full ink (kawase.md §3.3).
 */
export function FreshnessStrip({
  publishedAt,
  checkedAt,
  refreshError,
  onRetry,
  className,
}: {
  publishedAt: string;
  checkedAt: number;
  refreshError: DataError | null;
  onRetry: () => void;
  className?: string;
}) {
  const now = useNow();
  const online = useOnline();
  if (now === 0) return null;
  const late = bundleLateBy({ publishedAt }, now);
  let message: string | null = null;
  if (!online) {
    message = `Offline · showing what this device saved at ${formatClock(checkedAt)}`;
  } else if (refreshError) {
    message = `Can't refresh · showing batch data from ${formatAge(now - Date.parse(publishedAt))} ago`;
  } else if (late > 0) {
    message = `The next batch is ${formatAge(late)} late · showing the last one, published ${formatClock(publishedAt)}`;
  }
  if (!message) return null;
  return (
    <div
      role="status"
      className={cx(
        "flex items-center justify-between gap-3 rounded-row bg-warn-surface px-4 py-2.5 text-row-detail text-warn",
        className,
      )}
    >
      <span className="flex items-center gap-2">
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
        {message}
      </span>
      {online ? (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-xs font-semibold underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
