import type { Network } from "@kakure/domain";
import init, { checkPayoutAddress } from "../generated/zaddr.js";

/**
 * Why a payout address is refused, or "ok". The same rules as services/operator (PD18): a Unified Address for
 * this network, with an Orchard receiver, and no transparent receiver.
 */
export type PayoutAddressVerdict =
  | "ok"
  | "not-unified"
  | "wrong-network"
  | "no-orchard"
  | "transparent"
  | "unknown-network";

export type CheckPayoutAddress = (address: string, network: Network) => PayoutAddressVerdict;

let loading: Promise<CheckPayoutAddress> | null = null;

/**
 * Loads the WebAssembly module once (about 29 KB gzipped) and returns the checker. Call it from the bet sheet
 * only, so no other page pays for it. The address is checked in the browser and never sent anywhere.
 */
export function loadPayoutAddressCheck(): Promise<CheckPayoutAddress> {
  loading ??= init({ module_or_path: new URL("../generated/zaddr_bg.wasm", import.meta.url) }).then(
    () => (address, network) => checkPayoutAddress(address, network) as PayoutAddressVerdict,
  );
  loading.catch(() => {
    loading = null; // a failed fetch can be retried
  });
  return loading;
}
