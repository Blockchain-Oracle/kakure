import { Skeleton, SkeletonLine } from "@kakure/ui-web";

const CARDS = ["a", "b", "c", "d", "e", "f"];

/** The markets page's own shape while the first signed batch loads (never a spinner page, never a number). */
export function MarketsSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading markets" className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {CARDS.map((key) => (
        <div key={key} className="flex flex-col gap-4 rounded-group bg-card p-5">
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <SkeletonLine className="w-16" />
              <SkeletonLine small className="w-28" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
          <div className="flex flex-col gap-2">
            <SkeletonLine className="w-full" />
            <SkeletonLine className="w-3/4" />
          </div>
          <SkeletonLine small className="w-40" />
          <Skeleton className="h-10 w-full rounded-row" />
        </div>
      ))}
    </div>
  );
}
