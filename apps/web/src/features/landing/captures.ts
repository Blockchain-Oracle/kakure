/**
 * Real captures of the testnet web app at phone size (390 × 844 CSS px at 2×, dark theme), taken from the running app
 * on the operator's signed testnet bundle and the live price relay. Nothing in them can be scanned or copied (O13): no
 * deposit QR, and no address shown in full.
 */
export const CAPTURES = {
  trade: {
    src: "/captures/trade.webp",
    alt: "The trade terminal: BTC's live Window chart, UP and DOWN with what each pays",
  },
  markets: {
    src: "/captures/markets.webp",
    alt: "Markets by Window length, each card with its live price, line and what UP and DOWN pay",
  },
  money: { src: "/captures/money.webp", alt: "The wallet: the private chip balance with Deposit and Withdraw" },
  positions: { src: "/captures/positions.webp", alt: "Open positions, valued live at the house's bid" },
} as const;

export type CaptureName = keyof typeof CAPTURES;
