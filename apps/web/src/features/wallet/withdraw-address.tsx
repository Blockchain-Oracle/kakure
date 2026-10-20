"use client";

import type { Network } from "@kakure/domain";
import { cx } from "@kakure/ui-web";
import type { CheckPayoutAddress, PayoutAddressVerdict } from "@kakure/zaddr-wasm";
import { Check, ClipboardPaste } from "lucide-react";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import { NETWORK_LABEL } from "@/constants";

/**
 * Where a withdrawal goes, checked live in the browser with zcash_address compiled to WebAssembly (PD18): a Unified
 * Address for this network with an Orchard receiver and no transparent receiver, the rules the operator applies. The
 * module loads only here.
 */
export type FieldVerdict = "empty" | "checking" | "unavailable" | PayoutAddressVerdict;

export interface WithdrawAddressState {
  value: string;
  setValue: (value: string) => void;
  verdict: FieldVerdict;
  paste: () => Promise<void>;
  focus: () => void;
  input: RefObject<HTMLTextAreaElement | null>;
}

export function useWithdrawAddress(network: Network): WithdrawAddressState {
  const [value, setValue] = useState("");
  const [check, setCheck] = useState<CheckPayoutAddress | null | "failed">(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let live = true;
    import("@kakure/zaddr-wasm")
      .then(({ loadPayoutAddressCheck }) => loadPayoutAddressCheck())
      .then((fn) => live && setCheck(() => fn))
      .catch(() => live && setCheck("failed"));
    return () => {
      live = false;
    };
  }, []);

  const trimmed = value.trim();
  const verdict: FieldVerdict =
    trimmed === ""
      ? "empty"
      : check === null
        ? "checking"
        : check === "failed"
          ? "unavailable"
          : check(trimmed, network);

  return {
    value,
    setValue,
    verdict,
    input,
    focus: () => input.current?.focus(),
    paste: async () => {
      try {
        setValue((await navigator.clipboard.readText()).trim());
      } catch {
        input.current?.focus();
      }
    },
  };
}

function message(verdict: FieldVerdict, network: Network): { text: string; tone: "ok" | "bad" | "quiet" } {
  const other = NETWORK_LABEL[network === "mainnet" ? "testnet" : "mainnet"];
  switch (verdict) {
    case "empty":
      return {
        text: "A fresh shielded address from your wallet's Receive screen. Your chips are paid out here.",
        tone: "quiet",
      };
    case "checking":
      return { text: "Checking the address on this device…", tone: "quiet" };
    case "unavailable":
      return { text: "The address checker didn't load. Reload the page to try again.", tone: "bad" };
    case "ok":
      return {
        text: `Shielded, with an Orchard receiver, for ${NETWORK_LABEL[network]}. The withdrawal goes here.`,
        tone: "ok",
      };
    case "not-unified":
      return {
        text: "That isn't a Unified Address. Copy the shielded (u…) address from your wallet's Receive screen.",
        tone: "bad",
      };
    case "wrong-network":
      return { text: `That address is for ${other}; you're on ${NETWORK_LABEL[network]}.`, tone: "bad" };
    case "no-orchard":
      return {
        text: "That address has no Orchard receiver, so a payout would cross pools and publish its amount. Use a fresh Unified Address from Zodl or Zingo.",
        tone: "bad",
      };
    case "transparent":
      return {
        text: "That address includes a transparent receiver, which would make your payout public. Use a shielded-only address.",
        tone: "bad",
      };
    case "unknown-network":
      return { text: "Unknown network.", tone: "bad" };
  }
}

export function WithdrawAddressField({ state, network }: { state: WithdrawAddressState; network: Network }) {
  const id = useId();
  const help = message(state.verdict, network);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-label text-muted-foreground">
          Withdraw to
        </label>
        <button
          type="button"
          onClick={() => void state.paste()}
          className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-chip-label text-secondary-foreground outline-none hover:bg-row-pressed focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ClipboardPaste aria-hidden className="size-3.5" /> Paste
        </button>
      </div>
      <textarea
        id={id}
        ref={state.input}
        value={state.value}
        onChange={(event) => state.setValue(event.target.value)}
        rows={3}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        placeholder={network === "testnet" ? "utest1…" : "u1…"}
        aria-describedby={`${id}-help`}
        aria-invalid={help.tone === "bad"}
        className={cx(
          "w-full resize-none rounded-row bg-input px-4 py-3 text-row-detail break-all text-foreground outline-none placeholder:text-muted-foreground",
          "focus-visible:ring-2 focus-visible:ring-ring",
          help.tone === "bad" && "ring-2 ring-destructive",
        )}
      />
      <p
        id={`${id}-help`}
        className={cx(
          "flex items-start gap-1.5 text-row-detail",
          help.tone === "ok" ? "text-up" : help.tone === "bad" ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {help.tone === "ok" ? <Check aria-hidden className="mt-0.5 size-4 shrink-0" /> : null}
        {help.text}
      </p>
    </div>
  );
}
