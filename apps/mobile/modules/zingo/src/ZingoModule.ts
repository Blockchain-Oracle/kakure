import { NativeModule, requireNativeModule } from "expo";

import type { ChainHint, MixnetStatus, SendResult, SyncStatus, WalletAddress, WalletStatus } from "./Zingo.types";

declare class ZingoNativeModule extends NativeModule {
  openWallet(chain: ChainHint, serverUri: string): Promise<WalletStatus>;
  createWallet(chain: ChainHint, serverUri: string): Promise<WalletStatus>;
  getAddress(): Promise<WalletAddress>;
  sync(): Promise<{ status: string }>;
  syncStatus(): Promise<SyncStatus>;
  balance(): Promise<unknown>;
  /** `zatoshis` is a decimal string: JS numbers cannot carry every u64. */
  send(address: string, zatoshis: string, memo: string): Promise<SendResult>;
  mixnetStatus(): Promise<MixnetStatus>;
}

export default requireNativeModule<ZingoNativeModule>("Zingo");
