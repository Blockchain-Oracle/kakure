/**
 * Who learns what, and what Kakure can't hide, in plain words (plan §00 "Who sees what" and "Residual risks"); the
 * landing's four-column table (features/landing/words.ts) and the docs' privacy page say the same. Checked against the
 * code: the site, its signed files and the Oblivious HTTP relay are one Cloudflare worker (`services/data-worker`,
 * `relay.ts` builds a fresh request with only its content type); the price relay is another
 * (`services/price-relay`) that sends every symbol to everyone, while a candle request names its interval and how far
 * back it reaches (`packages/chart/src/live/candle-view.ts`); per-Window volume counts only whole groups of three
 * trades (`bundle-v2.ts` `trades`, `volumeZat`); a withdrawal leaves as canonical notes, each at its own random time
 * (`services/operator/src/payouts.rs`); the house's book is published once an hour, rounded up to the per-side cap
 * (`house`); requests and responses are padded to fixed sizes (`packages/ohttp`, `gateway.rs`); stakes snap to the
 * 1-2-5 chip ladder and each position is redeemed at its own random time (terminal `settings.ts`, `use-upkeep.ts`).
 * Checked by the v2 privacy re-audit (V1–V11), 2026-10-20. The arcade (plan §0 R4): the site worker forwards
 * `/arcade/v1/` to the arcade service as a fresh request with only the method, path and body
 * (`services/data-worker/src/arcade.ts`); the service keeps nicknames, device keys and runs by day
 * (`services/arcade/src/store.ts`); Practice and the hall's records stay on the device (`features/games`).
 */
export const PROMISE = {
  lead: "The prices are public. You aren't.",
  line: "One shielded deposit becomes private chips, blind-signed so the mint can't tell which deposit they came from. Every request travels through an Oblivious HTTP relay: the relay sees your IP but only encrypted bytes, and the operator sees the trade but never your IP. No account, no sign-in.",
} as const;

export const PARTIES: ReadonlyArray<{ party: string; learns: string; never: string }> = [
  {
    party: "Anyone watching the chain",
    learns: "That shielded deposits and payouts happened, with their timing, fee and shape.",
    never: "Amounts, memos, who sent them, or which trades they paid for.",
  },
  {
    party: "This site and its relay",
    learns:
      "Your IP address, when you visit and trade, which pages you open, and which network you trade on. One Cloudflare worker serves the site, the signed files and the relay.",
    never:
      "What's inside a request: it's sealed to the operator's published key (RFC 9458). Nor the asset or Window you look at: it stays in the #fragment, and every visitor downloads the same signed files, for both networks.",
  },
  {
    party: "The operator (us)",
    learns: "Each deposit's amount; each trade's Window, side, stake and time; each withdrawal's address and amount.",
    never:
      "Your IP; which deposit paid for which trade; who you are. Every trade spends fresh chips, each signed with a proof (DLEQ) against one published set of keys and paid in the standard split, so no chip can be marked.",
  },
  {
    party: "Everyone else",
    learns:
      "The price formula, volatility, spread and caps; signed prices and outcomes; the chip keys; what the house owes, once an hour and rounded up; volume per Window, counted only in whole groups of three trades.",
    never: "Any single trade.",
  },
  {
    party: "Kakure's arcade service",
    learns:
      "Your nickname, the public key your device made for it, your runs (the game, the score, the inputs and the day) and your duels (the deck, both players' calls once both are locked in, the result and the day). Nicknames, scores and duel results are public on the boards.",
    never:
      "Your IP or any header of yours (the site forwards only the request itself), your wallet, your chips or your trades. Practice and your streaks never leave your device.",
  },
  {
    party: "Kakure's price relay",
    learns: "Your IP, when a tab showing prices is open, and which candle interval your chart shows and how far back.",
    never: "Which asset you watch: it streams and serves every symbol to everyone.",
  },
  {
    party: "Your wallet's server",
    learns:
      "Your IP, when your wallet syncs and broadcasts, and which transactions it fetches, unless your wallet uses Tor.",
    never: "The memo or the amount.",
  },
  {
    party: "An exchange where you cash out",
    learns: "The amounts it receives.",
    never:
      "Which trades they came from: a withdrawal is split into standard 1, 2 and 5 notes, each sent at its own random time.",
  },
];

export const RESIDUALS = [
  "Timing. A trade placed right after a deposit, or a withdrawal right after a win, can be matched by time. Chips come in standard amounts, stakes in standard sizes, redeems at random times and withdrawals at random times; spreading your own activity out does the rest.",
  "Linking trades. Each trade spends chips the mint can't trace, but the operator still sees every trade's Window, side, stake and time, so amounts and timing can hint that two trades share an owner, more so while few people trade.",
  "Kakure runs both the relay and the operator. Oblivious HTTP is built for two separate parties (RFC 9458), so keeping your IP apart from your trades rests on Kakure not combining the two. Using Tor keeps your IP from both.",
  "Custody and the house's solvency are trusted. Once an hour the signed bundle states the chips outstanding and the most the open positions could pay, each rounded up to the per-side cap so no single trade shows.",
  "Position certificates aren't blinded, so the operator links a position's open to its close or redemption. That's the same anonymous trade, so it reveals nothing new.",
  "Volume per Window moves in steps of at least three trades. Someone who places two trades of a group can work out the third's stake.",
  "The per-side cap: a trade the cap refuses tells whoever placed it which quarter of the cap that side of the Window has reached.",
  "Prices and outcomes are reports signed by the operator. Each print is an exchange's public 1-minute candle, so anyone can fetch them again and recompute.",
  "The operator reads the chain from public light-wallet servers over Tor, so it relies on them to serve the chain honestly.",
  "While few people use Kakure, the crowd you hide among is small.",
  "Oblivious HTTP and Zcash's note encryption use elliptic-curve key exchange, so traffic and transactions recorded today could be read after a future break of that cryptography (harvest now, decrypt later).",
  "The gateway key changes every hour, and the old one is deleted ten minutes later. If the operator were ever broken into, requests recorded on the way in the last hour or so could be read, never older ones. In those ten minutes, a request's key also shows whether its device had fetched the new key yet.",
  "The operator keeps deposit records and the fingerprints of spent chips for good: they are what stop a deposit minting twice or a chip spending twice. A withdrawal's address and amount are deleted a week after it is paid, and an address already paid can't be used again.",
  "The arcade isn't sealed like trades: the site sees your arcade calls (your nickname and scores) along with your IP, though it keeps no logs, and the arcade service never sees the IP. A nickname is public, so pick one that doesn't name you.",
  "This browser keeps your trade settings (stake size, trail, starred markets), your arcade key, nickname and runs and Practice's tally, and its history keeps the pages you opened. Lucky's draws, like your chips and positions, are kept encrypted in its vault. Forget this device clears the app's part, nickname included.",
  "Your own funding history and your wallet's server are outside Kakure's control.",
];

export const NETWORKS = {
  title: "Testnet and mainnet",
  lines: [
    "Testnet uses TAZ, which has no value; it is where Kakure runs today. Mainnet uses real ZEC and needs a deliberate slide to switch to.",
    "Each network keeps its own operator key, chips, positions and cached files on your device, and a backup from one network can't be imported into the other.",
  ],
} as const;
