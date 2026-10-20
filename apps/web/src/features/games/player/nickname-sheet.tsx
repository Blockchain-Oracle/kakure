"use client";

import { NICKNAME_PATTERN } from "@kakure/arcade";
import { Sheet } from "@kakure/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { ARCADE } from "../arcade/copy";
import { useModalSfx } from "../audio";
import { ArcadeError, claimNickname } from "./api";
import { NICKNAME_MAX } from "./constants";
import { setNickname } from "./player-store";
import { arcadeKeys } from "./queries";
import { readXConfig, startXSignIn } from "./x-sign-in";

/** The service's answer when another key holds the name. */
const TAKEN = 409;
/** Whether Sign in with X is on changes only with a deploy. */
const X_CONFIG_STALE_MS = 3_600_000;

/**
 * Claiming a nickname (plan §0 R4): the name the boards show for this device's key. No account, no address and no
 * captcha: the browser does a small proof of work, signs the claim with the device key, and the site worker forwards it
 * with nothing of yours attached. Where the arcade has Sign in with X on (plan §0 R7), the X handle can be the name
 * instead, and the sheet says what that tells whom.
 */
export function NicknameSheet({
  open,
  onClose,
  onClaimed,
}: {
  open: boolean;
  onClose: () => void;
  onClaimed: (name: string) => void;
}) {
  useModalSfx(open);
  const client = useQueryClient();
  const inputId = useId();
  const [name, setName] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "working" } | { kind: "error"; message: string }>({
    kind: "idle",
  });
  const valid = NICKNAME_PATTERN.test(name);
  const working = state.kind === "working";
  const x = useQuery({
    queryKey: ["arcade", "x", "config"],
    queryFn: readXConfig,
    enabled: open,
    staleTime: X_CONFIG_STALE_MS,
  });
  const xConfig = x.data?.clientId ? x.data : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || working) return;
    setState({ kind: "working" });
    try {
      const claimed = await claimNickname(name);
      setNickname(claimed);
      void client.invalidateQueries({ queryKey: arcadeKeys.all });
      setState({ kind: "idle" });
      onClaimed(claimed);
    } catch (cause) {
      const message =
        cause instanceof ArcadeError && cause.status === TAKEN
          ? ARCADE.nickname.taken
          : cause instanceof Error
            ? cause.message
            : String(cause);
      setState({ kind: "error", message });
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={ARCADE.nickname.title} className="gm-sheet">
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <p className="text-body text-muted-foreground">{ARCADE.nickname.lead}</p>
        <label htmlFor={inputId} className="flex flex-col gap-2">
          <span className="text-row-strong text-foreground">{ARCADE.nickname.label}</span>
          <input
            id={inputId}
            value={name}
            onChange={(event) => {
              setName(event.target.value.trim());
              if (state.kind === "error") setState({ kind: "idle" });
            }}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={NICKNAME_MAX}
            aria-invalid={name.length > 0 && !valid}
            aria-describedby={`${inputId}-rule`}
            className="h-12 rounded-row border border-border bg-input px-4 font-mono text-body text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span id={`${inputId}-rule`} className="text-meta text-muted-foreground">
            {ARCADE.nickname.rule}
          </span>
        </label>
        {state.kind === "error" ? (
          <p role="alert" className="text-meta text-down">
            {state.message}
          </p>
        ) : null}
        <button type="submit" className="gm-cta" disabled={!valid || working}>
          {working ? (
            <>
              <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
              {ARCADE.nickname.working}
            </>
          ) : (
            ARCADE.nickname.claim
          )}
        </button>
        <p className="text-meta text-muted-foreground">{ARCADE.nickname.note}</p>
        {xConfig ? (
          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <button
              type="button"
              className="gm-cta gm-cta--quiet"
              disabled={working}
              onClick={() => {
                setState({ kind: "working" });
                void startXSignIn(xConfig).catch((cause: unknown) =>
                  setState({ kind: "error", message: cause instanceof Error ? cause.message : String(cause) }),
                );
              }}
            >
              {ARCADE.nickname.x.button}
            </button>
            <p className="text-meta text-muted-foreground">{ARCADE.nickname.x.note}</p>
          </div>
        ) : null}
        <p className="text-meta text-muted-foreground">{ARCADE.nickname.forget}</p>
      </form>
    </Sheet>
  );
}
