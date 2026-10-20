"use client";

import { buttonClass, EmptyState } from "@kakure/ui-web";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, LoaderCircle, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ARCADE } from "../arcade/copy";
import { arcadeKeys } from "./queries";
import { finishXSignIn, type XFinish } from "./x-sign-in";

const X = ARCADE.nickname.x;

/**
 * `/x`: where X sends the tab back after Sign in with X (plan §0 R7). The code leaves the address bar before anything
 * else happens, goes to the arcade once, and the page says how it ended. The service worker never caches this page.
 */
export function XCallback() {
  const client = useQueryClient();
  const started = useRef(false);
  const [outcome, setOutcome] = useState<XFinish | { kind: "working" } | { kind: "failed"; message: string }>({
    kind: "working",
  });

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const search = location.search;
    history.replaceState(null, "", location.pathname);
    finishXSignIn(search)
      .then((done) => {
        setOutcome(done);
        void client.invalidateQueries({ queryKey: arcadeKeys.all });
      })
      .catch((cause: unknown) =>
        setOutcome({ kind: "failed", message: cause instanceof Error ? cause.message : String(cause) }),
      );
  }, [client]);

  const back = (
    <Link href="/games" className={buttonClass("secondary", "sm")}>
      {X.back}
    </Link>
  );
  return (
    <div className="mx-auto flex w-full max-w-(--layout-reading-max) flex-col gap-6 py-10">
      {outcome.kind === "working" ? (
        <EmptyState
          icon={<LoaderCircle className="animate-spin motion-reduce:animate-none" />}
          title={X.working}
          reason={X.workingDetail}
        />
      ) : outcome.kind === "linked" ? (
        <EmptyState
          icon={<CheckCircle2 />}
          title={X.done(outcome.nickname)}
          reason={X.doneDetail}
          action={
            <div className="flex gap-2">
              <Link href={`/u#${outcome.nickname}`} className={buttonClass("secondary", "sm")}>
                {X.profile}
              </Link>
              {back}
            </div>
          }
        />
      ) : (
        <EmptyState
          icon={<TriangleAlert />}
          tone="warn"
          title={X.failed}
          reason={outcome.kind === "denied" ? X.denied : outcome.kind === "stale" ? X.stale : outcome.message}
          action={back}
        />
      )}
    </div>
  );
}
