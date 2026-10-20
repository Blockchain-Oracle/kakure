import {
  compareDecimal,
  type LaneInfo,
  outcomeOf,
  type Prints,
  parseWindowId,
  referenceOf,
  type WindowState,
} from "@kakure/domain";

/**
 * Recomputes one settled Window from its own prints, with the operator's rule (`@kakure/domain` settle.ts): the
 * reference from the venues that had committed when it was set (published with it), then two of three votes. `null`
 * when its lane isn't listed.
 */
export function recompute(
  window: WindowState,
  lanes: ReadonlyMap<string, LaneInfo>,
): { lane: LaneInfo; outcome: "U" | "D" | "refund"; ok: boolean } | null {
  const parsed = parseWindowId(window.id);
  const lane = parsed ? lanes.get(parsed.lane.id) : undefined;
  if (!lane) return null;
  const reference = referenceOf(window.referenceVenues ?? lane.venues, window.opening ?? {});
  const outcome = reference === null ? "refund" : outcomeOf(lane.venues, window.opening ?? {}, window.closing ?? {});
  return { lane, outcome, ok: outcome === window.outcome && (reference ?? undefined) === window.reference };
}

const MINUTE_SEC = 60;
const MS = 1000;

/** Every loaded prints file's 1-minute closes, keyed `asset|venue|minute start`. */
export function minuteCloses(files: readonly Prints[]): Map<string, string | null> {
  const closes = new Map<string, string | null>();
  for (const file of files) {
    for (const [asset, venues] of Object.entries(file.closes)) {
      for (const [venue, rows] of Object.entries(venues ?? {})) {
        for (const [minute, close] of rows ?? []) closes.set(`${asset}|${venue}|${minute}`, close);
      }
    }
  }
  return closes;
}

/**
 * Whether a Window's prints are the minute closes signed in the hourly files (Codex review K8): each venue's opening
 * print is its close for the minute ending at the open, its closing print the one for the minute ending at the close,
 * compared as exact decimals. The operator never revises a minute once recorded, so they must agree. `null` when a
 * minute isn't in the files loaded (they hold the last day), so the check wasn't made rather than passed.
 */
export function printsMatch(
  window: WindowState,
  lane: LaneInfo,
  closes: ReadonlyMap<string, string | null>,
): boolean | null {
  const start = Date.parse(window.startsAt) / MS;
  const end = Date.parse(window.expiresAt) / MS;
  let checked = false;
  for (const [prints, minute] of [
    [window.opening, start - MINUTE_SEC],
    [window.closing, end - MINUTE_SEC],
  ] as const) {
    if (!prints) continue;
    for (const venue of lane.venues) {
      const print = prints[venue];
      if (print === undefined) continue;
      const key = `${lane.asset}|${venue}|${minute}`;
      if (!closes.has(key)) return null;
      const close = closes.get(key) ?? null;
      if ((print === null) !== (close === null)) return false;
      if (print !== null && close !== null && compareDecimal(print, close) !== 0) return false;
      checked = true;
    }
  }
  return checked ? true : null;
}
