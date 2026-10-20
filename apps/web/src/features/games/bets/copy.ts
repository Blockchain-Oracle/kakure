import { BETS_MIN_RECEIPTS, RECEIPT_MIN_TRADES } from "@kakure/arcade";

const PERCENT = 100;

/** Everything Bets and profiles say (plan §0 R7 under v2). */
export const BETS = {
  publish: {
    title: "On the Bets board",
    off: "Off: this call stays on this device",
    on: (right: boolean) => (right ? "Published · a right call" : "Published · a wrong call"),
    busy: "Asking the operator to vouch for it…",
    switchLabel: "Publish this call to the Bets board",
    explain: `Counts this call under your nickname. The operator checks it over the sealed path and signs only "right" or "wrong" for your arcade key; that is all the arcade receives. The board changes once a week and shows right calls and calls, from ${BETS_MIN_RECEIPTS} on, never a market, side, size or return. Its weekly changes, read against the public outcomes, can still narrow down which Windows you called, more so while few people trade. Kakure's operator can tell which trade it was. Turning it off takes it down at the week's turn.`,
    xName: "Your name is your X handle, so this ties the call to your X account.",
    needName: "Pick a nickname to publish",
    notThisNetwork: (network: string) => `The Bets board counts ${network} calls.`,
    loading: "Reading the Bets board…",
    notEligible: "Only a single Up or Down call, once paid, can be published.",
    rule: `A call counts when its Window decided Up or Down and at least ${RECEIPT_MIN_TRADES} trades were opened on it, while the operator still holds the position (two days after it's paid).`,
  },
  board: {
    tab: "Bets",
    periods: { week: "Last week", all: "All time" } as Record<string, string>,
    periodLabel: "Bets period",
    figure: (right: number, calls: number) => `${right}/${calls}`,
    byline: (right: number, calls: number) => `${Math.round((right / calls) * PERCENT)}% right · ${calls} calls`,
    empty: {
      why: "No one on the Bets board yet",
      detail: `Publish a paid call from its Share sheet (Portfolio, History). A nickname appears once ${BETS_MIN_RECEIPTS} of its published calls count, from the Monday after.`,
      action: "Your history",
    },
    foot: "Published calls only, counted from the week after they go up; the board changes each Monday (UTC). Never a market, side, size or return.",
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
