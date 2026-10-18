import { NativeModule, requireNativeModule } from "expo";

import type {
  Activity,
  ChainHint,
  DrainPlan,
  DrainResult,
  MixnetStatus,
  MixnetWarm,
  SeedReveal,
  SendPhaseEvent,
  SendResult,
  SyncStatus,
  WalletAddress,
  WalletStatus,
} from "./Zingo.types";

type ZingoEvents = {
  onSendPhase: (event: SendPhaseEvent) => void;
};

declare class ZingoNativeModule extends NativeModule<ZingoEvents> {
  openWallet(chain: ChainHint, serverUri: string): Promise<WalletStatus>;
  createWallet(chain: ChainHint, serverUri: string): Promise<WalletStatus>;
  restoreWallet(chain: ChainHint, serverUri: string, seedPhrase: string, birthday: number): Promise<WalletStatus>;
  revealSeed(): Promise<SeedReveal>;
  forgetWallet(chain: ChainHint): Promise<WalletStatus>;
  getAddress(): Promise<WalletAddress>;
  newPayoutAddress(): Promise<WalletAddress>;
  sync(): Promise<{ status: string }>;
  syncStatus(): Promise<SyncStatus>;
  balance(): Promise<unknown>;
  activity(): Promise<Activity>;
  /** `zatoshis` is a decimal string: JS numbers cannot carry every u64. */
  send(address: string, zatoshis: string, memo: string, allowedPools: string[], requestId: string): Promise<SendResult>;
  warmMixnet(): Promise<MixnetWarm>;
  mixnetStatus(): Promise<MixnetStatus>;
  planOrchardDrain(): Promise<DrainPlan>;
  drainOrchard(): Promise<DrainResult>;
  excludeFromBackup(path: string): Promise<{ path: string }>;
  /** iOS: flags Documents and Library (and everything in them) as never backed up. Android: the manifest does it. */
  excludeAppDataFromBackup(): Promise<{ excluded: number; refused: number }>;
}

export default requireNativeModule<ZingoNativeModule>("Zingo");
