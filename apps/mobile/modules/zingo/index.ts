import type { Balance, ChainHint, Network } from "./src/Zingo.types";
import Native from "./src/ZingoModule";

export type * from "./src/Zingo.types";

const CHAIN: Record<Network, ChainHint> = { mainnet: "main", testnet: "test" };

/** Opens this device's wallet for `network`, if one exists. Never creates one. */
export const openWallet = (network: Network, serverUri: string) => Native.openWallet(CHAIN[network], serverUri);

/**
 * Creates a wallet for `network`. The seed stays in the iOS Keychain; the reply
 * carries only the status and birthday. Rejects with ERR_ZINGO_WALLET_EXISTS
 * rather than replace an existing wallet.
 */
export const createWallet = (network: Network, serverUri: string) => Native.createWallet(CHAIN[network], serverUri);

/** The wallet's Orchard-only unified address (derived once, then reused). */
export const getAddress = () => Native.getAddress();

/** Launches (or resumes) the sync task; poll `syncStatus` for progress. */
export const sync = () => Native.sync();

export const syncStatus = () => Native.syncStatus();

export const balance = () => Native.balance() as Promise<Balance>;

/** Proposal + confirm, transmitted over the Nym mixnet. */
export const send = (address: string, zatoshis: bigint, memo: string) => {
  if (zatoshis <= 0n) {
    throw new RangeError("zatoshis must be positive");
  }
  return Native.send(address, zatoshis.toString(), memo);
};

export const mixnetStatus = () => Native.mixnetStatus();
