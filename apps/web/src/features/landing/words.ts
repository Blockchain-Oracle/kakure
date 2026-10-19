import { MIN_TICKETS_PER_SIDE } from "@kakure/domain";

/**
 * The landing's words (Mitoshi's structure and word count, mitoshi-code-study §7; plan §0 R3). Every claim is
 * something Kakure does today on Zcash testnet; a tile for something not live yet says "Soon", decided from the signed
 * batch where it can be (stocks, Range) and from `SHIPPED` where it can't (the arcade). Every number on the page is
 * read from the signed batch or the price relay in the visitor's browser, never written here.
 */
export const START = "/trade#BTC";

/** Surfaces that ship in later stages (plan §0 R4–R5): flip each to true when its stage lands. */
export const SHIPPED = { games: false, duel: false } as const;

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
    app: "Download",
    start: "Start betting",
    menu: "Menu",
  },
  hero: {
    kicker: "Live on Zcash testnet",
    title: ["Bets go in.", "Only the odds"],
    accent: "escape.",
    line: "Call the close on Bitcoin, Ether, Solana and Zcash with shielded ZEC. The odds are public. Who bet stays hidden.",
    start: "Start betting",
    privacy: "How privacy works",
    beat: (seq: number, time: string) => `Batch ${seq} · signed ${time}`,
    live: (n: number) => `${n} markets live`,
    waiting: "Checking the latest signed batch…",
  },
  window: {
    label: (symbol: string) => `${symbol} live window`,
    lane: "Hourly",
    question: (symbol: string, open: string) => `${symbol} closes above ${open}?`,
    closesIn: (t: string) => `betting closes in ${t}`,
    up: "UP",
    down: "DOWN",
    pays: (x: string) => `pays ${x}`,
    sealed: "sealed",
    sealedLine: `Odds open once each side has ${MIN_TICKETS_PER_SIDE} tickets`,
    open: "Open the terminal",
    connecting: "Connecting to prices…",
    none: "The next window opens on the hour.",
  },
  stage: {
    kicker: "One app",
    title: ["Every market.", "Nobody watching."],
    line: "The terminal, the markets and your tickets, right in your browser. No account and no deposit: you pay from your own wallet.",
    label: "Kakure on three phones: the trade terminal, the markets and a ticket",
  },
  tape: { label: "Live now", signed: (seq: number) => `signed batch ${seq}` },
  bento: {
    kicker: "What you can call",
    title: "Crypto, Zcash and stocks. Same two buttons.",
    soon: "Soon",
    crypto: {
      eyebrow: "24/7",
      title: "Crypto, round the clock",
      line: "BTC, ETH, SOL, XRP and DOGE. Hourly and daily windows.",
    },
    zcash: {
      eyebrow: "Home turf",
      title: "Zcash itself",
      line: "ZEC's own price, and chain events like the next upgrade.",
    },
    range: { title: "Range", line: "A ladder of strikes every day. Call the band." },
    stocks: { title: "US stocks", line: "Tesla, NVIDIA, Apple and more, priced by Pyth." },
    games: { title: "Arcade", line: "Line Rider and Candle Hop on real price tapes." },
    duel: { title: "Duel", line: "Three calls, head to head. Picks stay sealed till lock." },
    private: {
      eyebrow: "Private by default",
      title: "No account. No cookies. No trace.",
      line: "Pay by QR from Zodl or Zingo. Winnings go to a fresh shielded address.",
    },
  },
  how: {
    kicker: "How it works",
    title: "Pick. Pay. Get paid.",
    steps: [
      {
        n: "01",
        title: "Pick a window",
        line: "Up or down by the close, on a price every batch signs.",
        shot: "trade",
        alt: "The trade terminal on a phone: BTC's live window chart with UP and DOWN and what each pays",
      },
      {
        n: "02",
        title: "Pay from your wallet",
        line: "Scan the QR with Zodl or Zingo. Built on your device, sent nowhere.",
        shot: "pay",
        alt: "The payment QR on a phone, ready to scan with a Zcash wallet",
      },
      {
        n: "03",
        title: "Get paid, privately",
        line: "Winners are paid to your shielded address. Same-size tickets pay the same.",
        shot: "ticket",
        alt: "A ticket on a phone after its window closed",
      },
    ],
  },
  privacy: {
    kicker: "Who sees what",
    title: ["The odds are public.", "You aren't."],
    columns: ["You", "The operator", "Everyone else"],
    rows: [
      { what: "Your side and ticket size", you: true, operator: true, public: false },
      { what: "Your payout address", you: true, operator: true, public: false },
      { what: "Which wallet paid, and who you are", you: true, operator: false, public: false },
      { what: "Each side's totals (the odds)", you: true, operator: true, public: true },
      { what: "The signed close and the result", you: true, operator: true, public: true },
    ],
    sees: "Sees it",
    never: "Never sees it",
    note: `Totals are published only in groups, once each side has ${MIN_TICKETS_PER_SIDE} tickets, so no single bet can be picked out. Like any website, this site's host and the price relay see your IP; the full model lists every party.`,
    more: "The full privacy model",
  },
  proof: {
    kicker: "Settled in public",
    title: "Every close is signed.",
    body: "Each batch is signed by the operator key built into this site. Your browser checks the signature before it shows you a single number.",
    figures: { batch: "Signed batches", live: "Markets live now", settled: "Settled, last 12 h" },
    settled: "Just settled",
    won: { up: "UP won", down: "DOWN won", yes: "YES won", no: "NO won", void: "Refunded" },
    none: "The first close lands at the end of the hour.",
    proof: "See every signed file",
  },
  games: {
    kicker: "Arcade",
    title: "Practice on real price tapes.",
    line: "Free to play, scored on the same signed prices as the markets.",
    cabinets: [
      { name: "Line Rider", tag: "Free", line: "Ride a real minute of BTC." },
      { name: "Candle Hop", tag: "Free", line: "Hop the candles without falling." },
      { name: "Duel", tag: "Free", line: "Three calls against a rival." },
      { name: "Lucky", tag: "Your stake", line: "Spin a real bet, drawn on your device." },
    ],
    open: "Enter the arcade",
  },
  final: {
    title: ["Your first bet.", "One scan away."],
    line: "Right here in your browser, paid from your own Zcash wallet.",
    start: "Start betting",
    scan: "Scan for the Android app",
    qr: "QR code to Kakure's download page",
  },
  footer: {
    tagline: "Bets go in. Only the odds escape.",
    built: "A private prediction market on Zcash. Testnet TAZ has no value.",
    keys: "Operator keys built into this site",
    notSet: "not set yet",
    license: "MIT licensed. Third-party notices are in the repository.",
  },
} as const;
