import { BETS_MIN_RECEIPTS, RECEIPT_MIN_TRADES } from "@kakure/arcade";

const PERCENT = 100;

/** Everything Bets and profiles say (plan §0 R7 under v2). */
export const BETS = {
  publish: {
    title: "On the Bets board",
    off: "Off: this call stays on this device",
    on: (right: boolean) => (right ? "Published · a right call" : "Published · a wrong call"),
    busy: "Checking the signed record…",
    switchLabel: "Publish this call to the Bets board",
    explain: `Counts this call under your nickname: the board shows right calls and calls, from ${BETS_MIN_RECEIPTS} on, never the market, side, size or return. Publishing sends this position's signed certificate to Kakure's arcade, so Kakure can match it to your trade. Turn it off to take it back.`,
    needName: "Pick a nickname to publish",
    notThisNetwork: (network: string) => `The Bets board counts ${network} positions.`,
    notEligible: "Only a single Up or Down call, once paid, can be published.",
    rule: `A call counts once its Window decides Up or Down and had at least ${RECEIPT_MIN_TRADES} trades.`,
  },
  board: {
    tab: "Bets",
    periods: { week: "This week", all: "All time" } as Record<string, string>,
    periodLabel: "Bets period",
    figure: (right: number, calls: number) => `${right}/${calls}`,
    byline: (right: number, calls: number) => `${Math.round((right / calls) * PERCENT)}% right · ${calls} calls`,
    empty: {
      why: "No one on the Bets board yet",
      detail: `A nickname appears once ${BETS_MIN_RECEIPTS} of its published calls have settled, the day after.`,
      action: "Trade a Window",
    },
    foot: "Published calls only, counted the day after they're published. Never a market, side, size or return.",
  },
  profile: {
    title: "Profile",
    onX: (handle: string) => `Signed in with X as @${handle}`,
    missing: "No such nickname",
    missingDetail: "Nicknames are claimed in the games. Check the spelling, or pick one from a board.",
    duel: "Duel",
    duelLine: (rating: number, won: number, finished: number) => `${rating} Elo · ${won} won of ${finished}`,
    arcade: "Arcade",
    bets: "Bets",
    betsLine: (right: number, calls: number) => `${right} right of ${calls} calls`,
    none: "Nothing yet",
    badges: "Badges",
    noBadges: "Badges come from duels, arcade ranks and published calls.",
    foot: "A profile shows only public play under a nickname: never an address, a balance or a trade.",
  },
  badge: {
    duelist: "Duelist",
    ladder: "Ladder climber",
    "podium-line-rider": "Line Rider podium",
    "podium-candle-hop": "Candle Hop podium",
    "top10-line-rider": "Line Rider top 10",
    "top10-candle-hop": "Candle Hop top 10",
    caller: "On the Bets board",
    sharp: "Sharp caller",
  } as Record<string, string>,
} as const;
