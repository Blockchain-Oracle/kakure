import type { Balance, ChainHint, Network, SendPhaseEvent } from "./src/Zingo.types";
import Native from "./src/ZingoModule";

export type * from "./src/Zingo.types";

const CHAIN: Record<Network, ChainHint> = { mainnet: "main", testnet: "test" };

/** Opens this device's wallet for `network`, if one exists. Never creates one. */
export const openWallet = (network: Network, serverUri: string) => Native.openWallet(CHAIN[network], serverUri);

/**
 * Creates a wallet for `network`. The seed stays in the platform keystore; the reply carries only the status and
 * birthday. Rejects with ERR_ZINGO_WALLET_EXISTS rather than replace an existing wallet.
 */
export const createWallet = (network: Network, serverUri: string) => Native.createWallet(CHAIN[network], serverUri);

/** Restores from a typed recovery phrase. `birthday` 0 scans from the binding's library birthday. */
export const restoreWallet = (network: Network, serverUri: string, seedPhrase: string, birthday: number) =>
  Native.restoreWallet(CHAIN[network], serverUri, seedPhrase, birthday);

/** The recovery phrase, for the backup screen only (screenshot-blocked, behind the device lock). */
export const revealSeed = () => Native.revealSeed();

/** Deletes this network's wallet file and keystore item (Forget this device). */
export const forgetWallet = (network: Network) => Native.forgetWallet(CHAIN[network]);

/** The wallet's default Orchard-only unified address (the receive screen). */
export const getAddress = () => Native.getAddress();

/** A fresh Orchard-only diversified address, one per ticket's payout (D8). */
export const newPayoutAddress = () => Native.newPayoutAddress();

/** Launches (or resumes) the sync task; poll `syncStatus` for progress. */
export const sync = () => Native.sync();

export const syncStatus = () => Native.syncStatus();

export const balance = () => Native.balance() as Promise<Balance>;

export const activity = () => Native.activity();

/**
 * Proposal + confirm, transmitted over the Nym mixnet. `allowedPools` makes the native side refuse a proposal that
 * would spend any other pool (ERR_ZINGO_POOL_REFUSED), so a bet never spends Orchard. Phases arrive on `onSendPhase`
 * with the same `requestId`.
 */
export const send = (
  address: string,
  zatoshis: bigint,
  memo: string,
  options: { allowedPools?: string[]; requestId?: string } = {},
) => {
  if (zatoshis <= 0n) {
    throw new RangeError("zatoshis must be positive");
  }
  return Native.send(address, zatoshis.toString(), memo, options.allowedPools ?? [], options.requestId ?? "");
};

export const onSendPhase = (listener: (event: SendPhaseEvent) => void) => Native.addListener("onSendPhase", listener);

/** Brings the Nym mixnet to `ready` ahead of a bet (called at launch), so a bet pays only prove-and-send time. */
export const warmMixnet = () => Native.warmMixnet();

export const mixnetStatus = () => Native.mixnetStatus();

export const planOrchardDrain = () => Native.planOrchardDrain();

/** Moves every spendable Orchard note into Ironwood now; the amount crossing pools is visible on chain. */
export const drainOrchard = () => Native.drainOrchard();

/** Marks a file as never backed up (iOS iCloud; Android relies on `allowBackup: false`). */
export const excludeFromBackup = (path: string) => Native.excludeFromBackup(path);
export const excludeAppDataFromBackup = () => Native.excludeAppDataFromBackup();
