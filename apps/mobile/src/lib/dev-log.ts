/**
 * Development-only log lines (Metro's terminal), for measuring a run without screenshots. Release builds drop them
 * (`__DEV__` is false), and nothing secret is ever passed here: no seeds, keys, nonces or payout addresses.
 */
export function devLog(text: string): void {
  if (!__DEV__) return;
  // biome-ignore lint/suspicious/noConsole: development-only measurements.
  console.info(`[kakure] ${text}`);
}
