import { type LaneInfo, outcomeOf, parseWindowId, referenceOf, type WindowState } from "@kakure/domain";

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
