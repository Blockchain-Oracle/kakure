/**
 * Real captures of the testnet web app at phone size (390 × 844), taken from the running static build with the
 * operator's signed testnet files and a test ticket built from the repo fixture address. Nothing in them can be
 * scanned or copied (O13): the payout address is blurred, the bet code is the app's own hidden state, and the
 * receipt's verify code is blurred.
 */
export const CAPTURED_ON = "18 Oct 2026";

export const CAPTURES = {
  betTicket: { src: "/captures/bet-ticket.jpg", alt: "The bet sheet: Up or Down and the fixed ticket sizes" },
  betAddress: {
    src: "/captures/bet-address.jpg",
    alt: "The payout address field (blurred here), checked as shielded with an Orchard receiver",
  },
  betQr: { src: "/captures/bet-qr.jpg", alt: "The payment code, hidden while the window is in the background" },
  portfolio: {
    src: "/captures/portfolio.jpg",
    alt: "The portfolio with one open testnet ticket waiting for its batch",
  },
  ticket: { src: "/captures/ticket.jpg", alt: "An outcome slip as a perforated receipt, its verify code blurred" },
} as const;
