/**
 * Real captures of the testnet web app at phone size (390 × 844 at 2×), taken in the built-in browser from the
 * running app with the operator's signed testnet files. The bet QR capture is the app's own hidden state, so no
 * scannable bet code is published.
 */
export const CAPTURED_ON = "17 Oct 2026";

export const CAPTURES = {
  betTicket: { src: "/captures/bet-ticket.jpg", alt: "The bet sheet: Up or Down and the fixed ticket sizes" },
  betAddress: {
    src: "/captures/bet-address.jpg",
    alt: "The payout address field, checked as shielded with an Orchard receiver",
  },
  betQr: { src: "/captures/bet-qr.jpg", alt: "The payment code, hidden while the window is in the background" },
  portfolio: { src: "/captures/portfolio.jpg", alt: "The portfolio with one open testnet ticket" },
  ticket: { src: "/captures/ticket.jpg", alt: "A ticket as a perforated receipt slip" },
} as const;
