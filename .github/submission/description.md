Kakure is a real-time prediction market on Zcash where the prices are public and the traders aren't. Deposit shielded ZEC once, get private chips, then call BTC, ETH, SOL, XRP, DOGE or ZEC up or down on Windows from 1 minute to 1 day at a live price from a public formula. Close early, trail, set take-profit or stop, build parlays and range bands, and play games (an arcade on real price tapes, a sealed-pick Duel, Lucky).

Why it doesn't leak:
- Money in and out is shielded Zcash (Orchard/Ironwood); a deposit is matched by a memo id, never an account.
- Chips are Chaumian e-cash (Cashu BDHKE with DLEQ proofs against one public keyset), so the mint can't link a trade to the deposit that funded it.
- Every call travels through Oblivious HTTP (RFC 9458): the relay sees your IP, not the request; the operator sees the request, not your IP. Requests and answers are padded; the gateway key rotates hourly.
- Every visitor fetches the same signed files each minute; the asset you watch stays in the URL fragment.
- Stakes, chips and withdrawals use standard sizes and random timing; volume is shown only in groups of three trades.
- No account, cookie or analytics. Social features are opt-in nicknames bound to a device key, never to money.
The residuals (Kakure runs both relay and operator; timing; a small crowd) are written out on /privacy.

What is real: the operator (Rust, librustzcash) syncs Zcash testnet over Tor, prices and settles real 1-minute candles from Coinbase, Kraken and Bitstamp by 2-of-3 vote, and signs a bundle every minute that the browser verifies; Proof recomputes every settlement. Trades, closes, exits, parlays, bands, redemption, OHTTP and the e-cash mint run end to end on testnet. Games and boards run on a real arcade service with server-side replay.

What is not yet: testnet TAZ only (mainnet keyed, not opened); a real shielded deposit and withdrawal on this design still has to be recorded; no audit.
