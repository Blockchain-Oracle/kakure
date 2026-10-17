import * as Zingo from "@zingo";
import * as Notifications from "expo-notifications";
import { clearAll } from "@/lib/kv";
import { onboardedStore } from "@/onboarding/onboarded";
import { eraseTickets } from "@/tickets/ticket-db";
import { resetTickets } from "@/tickets/use-tickets";
import { walletStore } from "@/wallet/wallet-store";

/**
 * Forget this device: both networks' wallets (file + keystore item), the encrypted ticket database and its key,
 * preferences, cached public data and scheduled reminders. Funds stay on chain; only the recovery words restore them.
 */
export async function forgetThisDevice(): Promise<void> {
  for (const network of ["testnet", "mainnet"] as const) {
    await Zingo.forgetWallet(network).catch(() => undefined);
  }
  await eraseTickets();
  resetTickets();
  await Notifications.cancelAllScheduledNotificationsAsync().catch(() => undefined);
  clearAll();
  walletStore.set({ ...walletStore.get(), phase: "absent", pools: null, address: null, activity: [] });
  onboardedStore.set(false);
}
