"use client";

import { buttonClass } from "@kakure/ui-web";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * `/trade` until the terminal lands in R2: it says so and goes to Markets, where every open window can be bet on now.
 * The page exists so the rail's first place, the dock's seal and key 1 already have their home.
 */
export function TradeRedirect() {
  const router = useRouter();
  useEffect(() => router.replace("/markets"), [router]);
  return (
    <div className="mx-auto flex max-w-(--layout-reading-max) flex-col items-start gap-4 py-6">
      <h1 className="font-display text-page-title text-foreground">Trade</h1>
      <p className="text-body text-muted-foreground">
        The trading terminal opens with the next release. Every open window can be bet on from Markets now; taking you
        there.
      </p>
      <Link href="/markets" className={buttonClass("primary", "md")}>
        Open Markets
      </Link>
    </div>
  );
}
