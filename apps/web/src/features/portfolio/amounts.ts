"use client";

import { zatToZec } from "@kakure/domain";
import { usePrefs } from "@/features/settings/prefs-store";

/** The privacy eye (C9, R6): when amounts are hidden they are not in the page at all, only "Hidden". */
export const HIDDEN = "Hidden";

export function useAmounts(coin: string) {
  const { hideAmounts } = usePrefs();
  const format = (zat: bigint, signed = false) => {
    if (hideAmounts) return HIDDEN;
    const sign = signed && zat > 0n ? "+" : zat < 0n ? "−" : "";
    return `${sign}${zatToZec(zat < 0n ? -zat : zat)} ${coin}`;
  };
  return { hidden: hideAmounts, format };
}
