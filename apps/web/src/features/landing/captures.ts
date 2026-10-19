/**
 * Real captures of the testnet web app at phone size (390 × 844 CSS px at 2×, dark theme), taken from the running app
 * with the operator's signed testnet files. Nothing in them can be scanned or copied (O13): no payout address is
 * shown in full and the payment QR is captured hidden, as the app shows it whenever the window isn't in front.
 */
export const CAPTURES = {
  trade: {
    src: "/captures/trade.webp",
    alt: "The trade terminal: BTC's live window chart, UP and DOWN with what each pays",
  },
  markets: {
    src: "/captures/markets.webp",
    alt: "Markets by cadence lane, each card with its live price and sparkline",
  },
  pay: { src: "/captures/pay.webp", alt: "The pay sheet: the ticket summary and the payment QR, built on the device" },
  ticket: { src: "/captures/ticket.webp", alt: "Portfolio: a ticket waiting for its window to close" },
} as const;

export type CaptureName = keyof typeof CAPTURES;
