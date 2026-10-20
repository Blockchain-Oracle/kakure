"use client";

import { LANE_ASSETS, type LaneAsset } from "@kakure/domain";
import { buttonClass, EmptyState } from "@kakure/ui-web";
import { Layers } from "lucide-react";
import Link from "next/link";
import { parseMarketFragment, useFragment } from "./fragment";

/**
 * `/m#<network>/<market id>`, the per-market page of the pool design (plan §00 supersedes pools, per-bet payments and
 * 10-minute batches). Old links still land here: it says where trading moved, and opens the same asset's live Windows.
 */
export function RetiredMarket() {
  const fragment = useFragment();
  const parsed = fragment ? parseMarketFragment(fragment) : null;
  const name = parsed?.id.split("-")[0]?.toUpperCase() ?? "";
  const asset = (LANE_ASSETS as readonly string[]).includes(name) ? (name as LaneAsset) : null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 py-10">
      <EmptyState
        icon={<Layers />}
        title="Pool markets became live Windows"
        reason="Kakure's markets used to be pools, paid by one shielded payment per bet and priced in 10-minute batches. They're now Windows from 1 minute to 1 day, priced live by the house and traded in a tap with private chips."
        action={
          <>
            <Link href={asset ? `/trade#${asset}` : "/markets"} className={buttonClass("primary", "sm")}>
              {asset ? `Trade ${asset}` : "See the Windows"}
            </Link>
            <Link href="/portfolio" className={buttonClass("secondary", "sm")}>
              Your earlier tickets
            </Link>
          </>
        }
      />
    </div>
  );
}
