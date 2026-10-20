/**
 * The landing's words (Mitoshi's structure and word count, mitoshi-code-study §7; plan §00). Every claim is something
 * Kakure does today on Zcash testnet: live Windows priced by the house's public formula, private chips from one
 * shielded deposit, every request through an Oblivious HTTP relay, every settlement recomputable from signed prints.
 * Every number on the page is read from the signed bundle or the price relay in the visitor's browser, never written
 * here. The privacy rows are plan §00's "Who sees what" table.
 */
export const START = "/trade#BTC";

/** Surfaces that ship in later stages (plan §0 R4–R5): flip each to true when its stage lands. */
export const SHIPPED = { arcade: false, duel: false } as const;

export const WORDS = {
  nav: {
    label: "Kakure",
    home: "Kakure home",
    links: [
      { href: "/markets", label: "Markets" },
      { href: START, label: "Trade" },
      { href: "/games", label: "Games" },
      { href: "#how", label: "How it works" },
      { href: "/privacy", label: "Privacy" },
    ],
    docs: "Docs",
    app: "Get the app",
    start: "Start trading",
    menu: "Menu",
  },
  hero: {
    kicker: "Live on Zcash testnet",
    title: ["Trade every minute.", "Stay"],
    accent: "hidden.",
    line: "Call Bitcoin, Ether, Solana and Zcash up or down, from one minute to a day, with private chips from a shielded deposit. Prices move live. Your trades don't lead back to you.",
    start: "Start trading",
    privacy: "How privacy works",
    beat: (seq: number, time: string) => `Bundle ${seq} · signed ${time}`,
    live: (n: number) => `${n} Windows trading`,
    waiting: "Checking the latest signed bundle…",
  },
  window: {
    label: (symbol: string) => `${symbol} live Window`,
    length: (length: string) => `${length} Window`,
    question: (symbol: string, line: string) => `${symbol} up or down from ${line}?`,
    up: "UP",
    down: "DOWN",
    pays: (x: string) => `pays ${x}`,
    notOffered: "not offered",
    house: "the house's live price",
    open: "Open the terminal",
    connecting: "Connecting to prices…",
    none: "The next Window opens in a moment.",
  },
  stage: {
    kicker: "One app",
    title: ["Every Window.", "Nobody watching."],
    line: "The terminal, the markets and your positions, right in your browser. No account, no sign-up: one deposit from your own wallet becomes private chips.",
    label: "Kakure on three phones: the trade terminal, the markets and open positions",
  },
  tape: { label: "Trading now", signed: (seq: number) => `signed bundle ${seq}` },
  bento: {
    kicker: "What you can call",
    title: "Six assets. Seven Window lengths. Two buttons.",
    soon: "Soon",
    crypto: {
      eyebrow: "24/7",
      title: "Crypto, round the clock",
      line: "BTC, ETH, SOL, XRP and DOGE, in Windows from 1 minute to 1 day.",
    },
    zcash: {
      eyebrow: "Home turf",
      title: "Zcash itself",
      line: "ZEC's own price, on every Window length.",
    },
    range: { title: "Range", line: "Call where it closes: inside a band, or outside it." },
    parlay: { title: "Parlays", line: "Two or three Windows in one position. The payouts multiply." },
    games: { title: "Arcade", line: "Line Rider and Candle Hop on real price tapes." },
    duel: { title: "Duel", line: "Three calls, head to head. Picks stay sealed till lock." },
    private: {
      eyebrow: "Private by default",
      title: "No account. No cookies. No name.",
      line: "Your chips are blind-signed, so the house can't tell which deposit funded which trade.",
    },
  },
  how: {
    kicker: "How it works",
    title: "Deposit. Trade. Withdraw.",
    steps: [
      {
        n: "01",
        title: "Deposit once",
        line: "Pay shielded ZEC from Zodl or Zingo. It becomes private chips on this device, blind-signed by the mint.",
        shot: "money",
        alt: "The wallet on a phone: the chip balance with Deposit and Withdraw",
      },
      {
        n: "02",
        title: "Trade in a tap",
        line: "UP or DOWN at the house's live price. Close early, trail it, or let it ride to the close.",
        shot: "trade",
        alt: "The trade terminal on a phone: BTC's live chart with UP and DOWN and what each pays",
      },
      {
        n: "03",
        title: "Withdraw privately",
        line: "Winnings come back as chips. Cash out to any shielded address, split into ordinary notes.",
        shot: "positions",
        alt: "Open positions on a phone, valued live at the house's bid",
      },
    ],
  },
  privacy: {
    kicker: "Who sees what",
    title: ["The prices are public.", "You aren't."],
    columns: ["You", "The relay", "The operator", "Everyone else"],
    rows: [
      { what: "Your IP address", sees: [true, true, false, false] },
      { what: "Each trade: its Window, side and stake", sees: [true, false, true, false] },
      { what: "Which deposit paid for which trade", sees: [true, false, false, false] },
      { what: "Your chip balance", sees: [true, false, false, false] },
      { what: "Your withdrawal address", sees: [true, false, true, false] },
      { what: "Prices, the formula and every settlement", sees: [true, true, true, true] },
    ],
    sees: "Sees it",
    never: "Never sees it",
    note: "Requests travel through an Oblivious HTTP relay: it sees your IP but only encrypted bytes, and the operator sees trades but never an IP. Kakure runs both, so that split rests on not combining them; Tor helps. Volume per Window is published only in groups of three trades.",
    more: "The full privacy model",
  },
  proof: {
    kicker: "Settled in public",
    title: "Every minute is signed.",
    body: "A bundle is signed every minute by the operator key built into this site, and your browser checks it before showing a single number. Every settlement can be recomputed from the venues' signed prints.",
    figures: { bundle: "Signed bundles", live: "Windows trading now", settled: "Settled, last 10 min" },
    settled: "Just settled",
    won: { up: "UP won", down: "DOWN won", void: "Refunded" },
    none: "The next Windows settle within a minute.",
    proof: "Recompute them yourself",
  },
  games: {
    kicker: "Games",
    title: "Range, Moonshot, and an arcade on real tapes.",
    line: "Range and Moonshot are open now, priced by the same house. The arcade is free to play and opens next.",
    cabinets: [
      { name: "Range", tag: "Live", line: "Inside the band, or outside it.", href: "/games/range", live: true },
      {
        name: "Moonshot",
        tag: "Live",
        line: "A direction and a reach, up to ×25.",
        href: "/games/moonshot",
        live: true,
      },
      { name: "Line Rider", tag: "Free", line: "Ride a real minute of BTC.", href: "/games", live: false },
      { name: "Duel", tag: "Free", line: "Three calls against a rival.", href: "/games", live: false },
    ],
    open: "Enter the games hall",
  },
  final: {
    title: ["Your first trade.", "One deposit away."],
    line: "Right here in your browser, funded from your own Zcash wallet.",
    start: "Start trading",
    scan: "Open Kakure on your phone",
    qr: "QR code to Kakure's trade terminal",
  },
  footer: {
    tagline: "Trade every minute. Stay hidden.",
    built: "A private real-time prediction market on Zcash. Testnet TAZ has no value.",
    keys: "Operator keys built into this site",
    notSet: "not set yet",
    license: "MIT licensed. Third-party notices are in the repository.",
  },
} as const;
