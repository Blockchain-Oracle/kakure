"use client";

import { luckyBestStreak, luckyStreak } from "@kakure/arcade";
import { cadenceLabel, type Network, parseWindowId } from "@kakure/domain";
import { NETWORK_COIN } from "@/constants";
import { multipleOf, zecText } from "@/features/terminal/format";
import type { PositionRecord } from "@/features/wallet/records";
import { LUCKY } from "./copy";
import { resultOf, useKeptDraws } from "./lucky-store";
import "./lucky-floor.css";

/**
 * Your draws (Mitoshi's Lucky floor, made private): Mitoshi showed everyone's latest draws from its server; here a draw
 * never leaves the device, so the floor is this device's own, each with what its Window decided, and the streak.
 */
export function useLuckyRecord(network: Network, positions: readonly PositionRecord[]) {
  const draws = useKeptDraws().filter((d) => d.network === network);
  const byKey = new Map(positions.map((p) => [p.key, p]));
  const rows = draws.map((d) => ({
    draw: d,
    result: d.positionKey ? resultOf(byKey.get(d.positionKey)) : null,
  }));
  const decided = rows.filter((r) => r.result !== null).map((r) => ({ result: r.result ?? "riding" }));
  return { rows, streak: luckyStreak(decided), best: luckyBestStreak([...decided].reverse()) };
}

export function LuckyFloor({ network, positions }: { network: Network; positions: readonly PositionRecord[] }) {
  const { rows } = useLuckyRecord(network, positions);
  const coin = NETWORK_COIN[network];
  return (
    <section className="lk-floor" aria-label={LUCKY.floor.title}>
      <div className="lk-floor-head">
        <h2 className="lk-floor-title">{LUCKY.floor.title}</h2>
        <span className="lk-floor-scope">{LUCKY.floor.scope}</span>
      </div>
      {rows.length === 0 ? (
        <p className="lk-note">{LUCKY.floor.empty}</p>
      ) : (
        <ol className="lk-floor-list">
          {rows.map(({ draw, result }) => {
            const parsed = draw.windowId ? parseWindowId(draw.windowId) : null;
            return (
              <li key={`${draw.seed}-${draw.at}`} className="lk-floor-row" data-result={result ?? "drawn"}>
                <span className="lk-floor-what">
                  <span className="lk-floor-call">
                    {draw.draw.asset} {draw.draw.side === "up" ? "▲" : "▼"} ×{draw.draw.multiplier}
                  </span>
                  <span className="lk-floor-sub">
                    {[
                      parsed ? cadenceLabel(parsed.lane.cadenceSec) : null,
                      draw.dealtAskE4 ? multipleOf(draw.dealtAskE4) : null,
                      draw.positionKey ? `${zecText(draw.stakeZat)} ${coin}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="lk-floor-verdict">{result ? LUCKY.floor.result[result] : LUCKY.floor.notPlaced}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
