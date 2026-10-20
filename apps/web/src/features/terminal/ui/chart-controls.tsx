"use client";

import type { CandleInterval } from "@kakure/feeds/protocol";
import { fire, MUSIC_TRACK_NAMES, setMusic } from "@kakure/sounds";
import { cx } from "@kakure/ui-web";
import { CandlestickChart, ChevronDown, Crosshair, LineChart, Music2 } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import type { ChartHandle } from "../chart/live-chart";
import { MUSIC_TRACKS, OFF_CENTRE_POLL_MS, TRACK_CHIP_MS } from "../constants";
import { setTradeSettings, useTradeSettings } from "../settings";

/**
 * The chart controls (Owarine `ui/ChartControls.tsx`, Tradash's `aW` `aZ` `aq`): the interval pill (dimmed in line view)
 * opens a popover of minutes and hours & days, and picking one switches to candles; the round toggle swaps line and
 * candles; the music button shows an equaliser while on and a "♪ Track ›" chip that steps tracks; recentre appears
 * when the candle view is panned away.
 */
const MINUTE_INTERVALS: readonly CandleInterval[] = ["1m", "3m", "5m", "15m", "30m"];
const HOUR_INTERVALS: readonly CandleInterval[] = ["1h", "2h", "4h", "12h", "1d"];
const tap = () => fire("toggle", { haptic: "tick" });
/** The equaliser's bars start this far apart (Owarine: 0.12 s). */
const EQ_STAGGER_MS = 120;

export function ChartControls({ handle }: { handle: RefObject<ChartHandle | null> }) {
  const settings = useTradeSettings();
  const [menu, setMenu] = useState(false);
  const [chip, setChip] = useState(false);
  const [offCentre, setOffCentre] = useState(false);
  const chipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const candles = settings.chartView === "candles";

  useEffect(() => setMusic(settings.musicEnabled, settings.musicTrack), [settings.musicEnabled, settings.musicTrack]);
  useEffect(() => {
    if (!candles) {
      setOffCentre(false);
      return;
    }
    const id = setInterval(() => setOffCentre(handle.current?.offCentre() ?? false), OFF_CENTRE_POLL_MS);
    return () => clearInterval(id);
  }, [candles, handle]);

  const pick = (interval: CandleInterval) => {
    tap();
    setTradeSettings({ chartInterval: interval, chartView: "candles" });
    setMenu(false);
  };
  const showChip = () => {
    setChip(true);
    if (chipTimer.current) clearTimeout(chipTimer.current);
    chipTimer.current = setTimeout(() => setChip(false), TRACK_CHIP_MS);
  };

  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <button
          type="button"
          aria-label={`Candle interval: ${settings.chartInterval}`}
          aria-expanded={menu}
          onClick={() => {
            tap();
            setMenu((m) => !m);
          }}
          className={cx(
            "kk-glass flex h-10 items-center gap-1 rounded-full px-3.5 text-chip-label",
            !candles && "text-muted-foreground",
          )}
        >
          {settings.chartInterval}
          <ChevronDown aria-hidden className={cx("size-3.5 transition-transform", menu && "rotate-180")} />
        </button>
        {menu ? (
          <div className="kk-glass kk-pop absolute bottom-12 left-0 z-40 flex w-[17.5rem] flex-col gap-2 rounded-group p-3">
            {(
              [
                ["Minutes", MINUTE_INTERVALS],
                ["Hours & days", HOUR_INTERVALS],
              ] as const
            ).map(([title, list]) => (
              <div key={title}>
                <p className="mb-1.5 text-[0.6875rem] font-bold text-muted-foreground">{title}</p>
                <div className="grid grid-cols-5 gap-1.5">
                  {list.map((i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => pick(i)}
                      className={cx(
                        "h-8 rounded-full text-chip-label",
                        candles && settings.chartInterval === i ? "kk-up-solid" : "bg-secondary",
                      )}
                    >
                      {i}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        aria-label={candles ? "Switch to line" : "Switch to candles"}
        onClick={() => {
          tap();
          setTradeSettings({ chartView: candles ? "line" : "candles" });
        }}
        className="kk-glass grid size-10 place-items-center rounded-full"
      >
        <span key={candles ? "c" : "l"} className="kk-spin-in">
          {candles ? (
            <LineChart aria-hidden className="size-[1.125rem]" />
          ) : (
            <CandlestickChart aria-hidden className="size-[1.125rem]" />
          )}
        </span>
      </button>
      <button
        type="button"
        aria-label={settings.musicEnabled ? "Turn music off" : "Turn music on"}
        aria-pressed={settings.musicEnabled}
        onClick={() => {
          tap();
          const on = !settings.musicEnabled;
          setTradeSettings({ musicEnabled: on });
          if (on) showChip();
        }}
        className={cx("kk-glass grid size-10 place-items-center rounded-full", settings.musicEnabled && "text-up")}
      >
        {settings.musicEnabled ? <Equaliser /> : <Music2 aria-hidden className="size-[1.125rem]" />}
      </button>
      {chip && settings.musicEnabled ? (
        <button
          type="button"
          onClick={() => {
            tap();
            const next =
              MUSIC_TRACKS[(MUSIC_TRACKS.indexOf(settings.musicTrack) + 1) % MUSIC_TRACKS.length] ?? "arcade";
            setTradeSettings({ musicTrack: next });
            showChip();
          }}
          className="kk-glass kk-pop h-8 rounded-full px-3 text-[0.6875rem] font-bold"
        >
          ♪ {MUSIC_TRACK_NAMES[settings.musicTrack]} ›
        </button>
      ) : null}
      {offCentre ? (
        <button
          type="button"
          aria-label="Recentre"
          onClick={() => {
            tap();
            handle.current?.recentre();
          }}
          className="kk-glass grid size-10 place-items-center rounded-full"
        >
          <Crosshair aria-hidden className="size-[1.125rem]" />
        </button>
      ) : null}
    </div>
  );
}

/** Three bars that bounce while music plays (still under reduced motion). */
function Equaliser() {
  return (
    <span aria-hidden className="flex h-4 items-end gap-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="kk-eq w-1 rounded-full bg-current"
          style={{ animationDelay: `${i * EQ_STAGGER_MS}ms` }}
        />
      ))}
    </span>
  );
}
