/** Why the buttons are off, in one plain sentence (Owarine `why.ts`); null while the Window trades. */
export function whyNotTrading(input: {
  phase: string | null;
  trading: boolean;
  vault: string;
  hasQuote: boolean;
}): string | null {
  if (!input.trading) return "Trading isn't published on this network yet. Prices stay live.";
  if (input.vault === "locked") return "Your vault is locked. Unlock it on Portfolio to trade.";
  if (input.vault === "unavailable") return "This browser can't open your vault (a private window?). Trading needs it.";
  switch (input.phase) {
    case null:
      return "No Window open for this market right now.";
    case "opening":
      return "Waiting for this Window's opening print. Up and Down open in a few seconds.";
    case "riding":
      return "This Window has stopped taking trades. The next one opens shortly.";
    case "settled":
      return "This Window has settled. The next one opens shortly.";
    default:
      return input.hasQuote ? null : "Waiting for a live price.";
  }
}
