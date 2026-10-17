import Storage from "expo-sqlite/kv-store";

/**
 * Non-secret device preferences (network, sound, motion…). Secrets never go here: the ticket key lives in
 * secure-store, the seed in the platform keystore. Every failure is swallowed: a preference is never worth a crash.
 */
export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = Storage.getItemSync(key);
    return raw === null ? fallback : { ...fallback, ...(JSON.parse(raw) as T) };
  } catch {
    return fallback;
  }
}

export function readText(key: string): string | null {
  try {
    return Storage.getItemSync(key);
  } catch {
    return null;
  }
}

export function writeText(key: string, value: string): void {
  try {
    Storage.setItemSync(key, value);
  } catch {
    // Not saved: it applies for this session only.
  }
}

export function writeJson(key: string, value: unknown): void {
  writeText(key, JSON.stringify(value));
}

export function removeKey(key: string): void {
  try {
    Storage.removeItemSync(key);
  } catch {
    // Nothing stored.
  }
}

export function clearAll(): void {
  try {
    Storage.clearSync();
  } catch {
    // Nothing stored.
  }
}
