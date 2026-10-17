import { STORAGE_KEYS } from "@/constants";
import { readText, removeKey, writeText } from "@/lib/kv";
import { createStore, useStore } from "@/lib/store";

/** Whether first run finished on this device (the promise slides, a wallet, the backup and the lock offer). */
export const onboardedStore = createStore<boolean>(readText(STORAGE_KEYS.onboarded) === "1", (value) => {
  if (value) writeText(STORAGE_KEYS.onboarded, "1");
  else removeKey(STORAGE_KEYS.onboarded);
});

export const useOnboarded = () => useStore(onboardedStore);
