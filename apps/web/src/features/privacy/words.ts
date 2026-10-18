import { ADDRESS_LIST_SIZE, MIN_NEW_TICKETS_PER_RELEASE, MIN_TICKETS_PER_SIDE } from "@kakure/domain";

/**
 * Who learns what, and what Kakure can't hide, in plain words. Shared by /privacy and the landing; the docs' privacy
 * page (apps/docs/content/docs/privacy.mdx) says the same. Sources: context/11-chosen-direction/privacy-design.md
 * ("Who learns what", "Residual risks"), plan §6, and the S08 privacy audit (context/16-privacy-audit/audit.md:
 * O1 grouped publication, PD28, O5/O18 servers, O11 address list).
 */
const GROUP = MIN_NEW_TICKETS_PER_RELEASE;
/** Union bound on two of n bets in one batch picking the same address from the list: n(n−1)/2 ÷ list size. */
const EXAMPLE_BETS = 10;
const PAIRS = (EXAMPLE_BETS * (EXAMPLE_BETS - 1)) / 2;
const PERCENT = 100;
const COLLISION_PERCENT = Math.ceil((PAIRS * PERCENT) / ADDRESS_LIST_SIZE);

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
    party: "Other bettors and the public",
    learns: `Each market's ticket count and ticket hashes, published only in groups of at least ${GROUP} new tickets; each side's totals once both sides have ${MIN_TICKETS_PER_SIDE}; the final totals and the result.`,
    never: "Any single bet: its side, its size or when it arrived.",
  },
  {
    party: "This website's host",
    learns: "Your IP address, when you visited and which pages you opened.",
    never:
      "Your bets, sides, payout address, network or the markets you look at. The QR is built in your browser, market ids stay in the #fragment, and every visitor downloads the same files for both networks.",
  },
  {
    party: "Kakure's price relay",
    learns: "Your IP, and when a tab showing prices is open.",
    never: "Which prices you watch: it streams every symbol to everyone, and your browser sends it nothing.",
  },
  {
    party: "Your wallet's server",
    learns:
      "Your IP, when your wallet syncs and broadcasts, and which transactions it fetches, bets and payouts included, unless your wallet uses Tor. With Zodl or Zingo that's your wallet's own server; the Kakure app syncs with zec.rocks and sends over Nym, so zec.rocks sees its IP when it syncs.",
    never: "The memo or the amount.",
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
  `Every published change, the final totals included, covers at least ${GROUP} new tickets. If all the tickets in a group took the same side, that group's side and total show (not whose tickets they are), and someone who places most of a group themselves can work out the rest (the n−1 attack).`,
  `If fewer than ${GROUP} tickets are still waiting to be listed when a market's cutoff block is final, they're refunded in full and never published. A bet that arrives last, alone, doesn't play.`,
  "Miners set block timestamps within consensus limits, so the cutoff block has some latitude.",
  `Each signed list holds ${ADDRESS_LIST_SIZE.toLocaleString("en-US")} market addresses and your browser picks one at random, so two bets in the same batch can share one (under ${COLLISION_PERCENT}% for ${EXAMPLE_BETS} bets); only the operator can see that. Each batch, used addresses are replaced together with random unused ones, so a new list doesn't show which were paid.`,
  "Your own funding history and your wallet's server are outside Kakure's control.",
  "The operator reads the chain from public light-wallet servers (zec.rocks) over Tor, so it relies on them to serve the chain honestly.",
  "While few people use Kakure, the set of bettors you hide among is small.",
  "The published market addresses could be decrypted by a future break of today's cryptography (harvest now, decrypt later).",
  "Stock markets settle on two keyed sources (Pyth and Alpaca) that you can't re-fetch yourself.",
];
