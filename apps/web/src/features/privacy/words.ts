/**
 * Who learns what, and what Kakure can't hide, in plain words. Shared by /privacy and the landing.
 * Sources: context/11-chosen-direction/privacy-design.md ("Who learns what", "Residual risks") and plan §6.
 */
export const PARTIES: ReadonlyArray<{ party: string; learns: string; never: string }> = [
  {
    party: "Anyone watching the chain",
    learns: "That shielded transactions happened, with their timing, fee and shape.",
    never: "Who paid whom, how much, the memo, or that a transaction is a bet.",
  },
  {
    party: "The operator (us)",
    learns: "Each bet's amount, side, arrival time and payout address.",
    never: "Who you are or which wallet paid. Clients never contact the operator; it only publishes signed files.",
  },
  {
    party: "This website's host",
    learns: "Your IP address, when you visited and which pages you opened.",
    never: "Your bets, sides or payout address. The QR is built in your browser and market ids stay in the #fragment.",
  },
  {
    party: "Your wallet's server",
    learns: "Your IP and when you broadcast, unless your wallet uses Tor.",
    never: "The memo or the amount.",
  },
  {
    party: "Other bettors and the public",
    learns: "Odds in scheduled batches, once each side has 3 tickets, and the result.",
    never: "Any single bet: odds move only after 3 new tickets.",
  },
  {
    party: "An exchange where you cash out",
    learns: "The amount you deposit.",
    never: "Which bet it came from: every same-size winning ticket pays the same.",
  },
];

export const RESIDUALS = [
  "The operator sees every bet's amount, side and payout address, though not who placed it.",
  "Odds are reports signed by the operator, not cryptographic proofs.",
  "Custody and resolution are trusted: there are no smart contracts on Zcash.",
  "The final totals become public after the cutoff, and a determined observer can try the n−1 attack on a market with few bets.",
  "Miners set block timestamps within consensus limits, so the cutoff block has some latitude.",
  "Your own funding history and your wallet's server are outside Kakure's control.",
  "While few people use Kakure, the set of bettors you hide among is small.",
  "The published market addresses could be decrypted by a future break of today's cryptography (harvest now, decrypt later).",
  "Stock markets settle on two keyed sources (Pyth and Alpaca) that you can't re-fetch yourself.",
  "The mainnet node runs from an unsigned snapshot.",
];
