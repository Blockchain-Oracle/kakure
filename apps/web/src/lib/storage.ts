/** localStorage that never throws (private windows, blocked storage); device-only, never synced. */
export const safeStorage = {
  getItem(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Storage full or blocked: the app still works for this visit.
    }
  },
  removeItem(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Nothing to clean up.
    }
  },
  /** Every stored pair; the query persister's sweep uses it to drop expired entries (it filters by its prefix). */
  entries(): Array<[string, string]> {
    const out: Array<[string, string]> = [];
    try {
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i);
        const value = key === null ? null : window.localStorage.getItem(key);
        if (key !== null && value !== null) out.push([key, value]);
      }
    } catch {
      // Blocked storage: nothing to sweep.
    }
    return out;
  },
};
