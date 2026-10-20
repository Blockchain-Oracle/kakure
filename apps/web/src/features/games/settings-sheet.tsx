"use client";

import { hapticsAvailable } from "@kakure/sounds";
import { SegmentedControl, Sheet, Switch } from "@kakure/ui-web";
import { useSyncExternalStore } from "react";
import { NetworkSwitch } from "@/features/network/network-switch";
import { type MotionChoice, setPrefs, usePrefs } from "@/features/settings/prefs-store";
import { playSfx, setBgmVolume, setSfxVolume, useBgmVolume, useModalSfx, useSfxVolume } from "./audio";
import { VOLUME_STEP } from "./constants";
import { GAMES } from "./copy";
import { fireFeedback } from "./feedback";
import { useGames } from "./games-provider";
import { ACCENT_CHOICES, ACCENT_LABELS, setAccent } from "./settings";

const MOTION_ORDER: readonly MotionChoice[] = ["system", "full", "reduce"];
const noSubscription = () => () => undefined;

/**
 * The stage controls (Flicky's menu modal, Mitoshi `GameSettingsSheet.tsx`) on Kakure's sheet: the two volume wells,
 * haptics, motion and accent, the network on a phone (the strip owns the top there), and the credits as the foot line.
 * Each switch fires the cue it governs as it turns on, so the setting demonstrates itself. Sound, haptics and motion are
 * Kakure's own device settings, shared with the terminal.
 */
export function GameSettingsSheet() {
  const { settingsOpen, setSettingsOpen, accent, feedback, reducedMotion } = useGames();
  const prefs = usePrefs();
  const sfx = useSfxVolume();
  const bgm = useBgmVolume();
  const canVibrate = useSyncExternalStore(noSubscription, hapticsAvailable, () => true);
  useModalSfx(settingsOpen);
  const close = () => setSettingsOpen(false);

  return (
    <Sheet
      open={settingsOpen}
      onClose={close}
      title={GAMES.settings.title}
      className="gm-sheet"
      footer={
        <button type="button" className="gm-cta w-full" onClick={close}>
          {GAMES.settings.close}
        </button>
      }
    >
      <div className="gm-settings" data-reduced-motion={reducedMotion ? "true" : "false"}>
        <div className="gm-set-block">
          {prefs.sound ? null : (
            <div className="gm-set-row">
              <span className="gm-set-hint">{GAMES.settings.soundOff}</span>
              <button type="button" className="gm-seg-btn" onClick={() => setPrefs({ sound: true })}>
                {GAMES.settings.turnOn}
              </button>
            </div>
          )}
          <label className="gm-set-row gm-set-row--stack">
            <span className="gm-set-label">{GAMES.settings.sfx}</span>
            <input
              type="range"
              className="gm-range"
              min={0}
              max={1}
              step={VOLUME_STEP}
              value={sfx}
              disabled={!prefs.sound}
              aria-label={GAMES.settings.sfx}
              onChange={(event) => setSfxVolume(Number(event.target.value))}
              onPointerUp={() => playSfx("click")}
              onKeyUp={() => playSfx("click")}
            />
          </label>
          <label className="gm-set-row gm-set-row--stack">
            <span className="gm-set-label">{GAMES.settings.music}</span>
            <input
              type="range"
              className="gm-range"
              min={0}
              max={1}
              step={VOLUME_STEP}
              value={bgm}
              disabled={!prefs.sound}
              aria-label={GAMES.settings.music}
              onChange={(event) => setBgmVolume(Number(event.target.value))}
            />
          </label>
        </div>

        <div className="gm-set-row">
          <span className="gm-set-text">
            <span className="gm-set-label">{GAMES.settings.haptics}</span>
            {canVibrate ? null : <span className="gm-set-hint">{GAMES.settings.hapticsUnsupported}</span>}
          </span>
          <Switch
            label={GAMES.settings.haptics}
            checked={prefs.haptics}
            disabled={!canVibrate}
            onChange={(on) => {
              setPrefs({ haptics: on });
              if (on) fireFeedback("confirm");
            }}
          />
        </div>

        <div className="gm-set-row gm-set-row--stack">
          <span className="gm-set-label">{GAMES.settings.motion.label}</span>
          <SegmentedControl
            label={GAMES.settings.motion.label}
            size="sm"
            value={prefs.motion}
            onChange={(motion) => {
              setPrefs({ motion });
              feedback("tap");
            }}
            options={MOTION_ORDER.map((choice) => ({ value: choice, label: GAMES.settings.motion[choice] }))}
          />
        </div>

        <div className="gm-set-row gm-set-row--stack">
          <span className="gm-set-label">{GAMES.settings.accent}</span>
          <SegmentedControl
            label={GAMES.settings.accent}
            size="sm"
            value={accent}
            onChange={(choice) => {
              setAccent(choice);
              feedback("tap");
            }}
            options={ACCENT_CHOICES.map((choice) => ({
              value: choice,
              name: ACCENT_LABELS[choice],
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <span className="gm-seg-swatch" data-accent={choice} aria-hidden />
                  {ACCENT_LABELS[choice]}
                </span>
              ),
            }))}
          />
        </div>

        <div className="gm-set-row rail:hidden">
          <span className="gm-set-label">{GAMES.settings.network}</span>
          <NetworkSwitch />
        </div>

        <p className="gm-set-foot">{GAMES.settings.foot}</p>
      </div>
    </Sheet>
  );
}
