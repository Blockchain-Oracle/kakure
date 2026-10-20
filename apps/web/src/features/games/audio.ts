"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { setPrefs, usePrefs } from "@/features/settings/prefs-store";
import { safeStorage } from "@/lib/storage";
import { type ChipBed, createChipBed } from "./bed";
import { BGM_VOLUME_BASE, CENTS_PER_OCTAVE, PRESS, PRESS_FLOOR_MS, SFX_VOLUME_BASE, SLEEP_AFTER_MS } from "./constants";
import { gameKey } from "./keys";

/**
 * The games' audio (Mitoshi `features/games/audio.ts`): effects through Web Audio (decoded buffers, so rapid swipes
 * overlap instead of cutting each other off) and a music bed sequenced on the same clock (`bed.ts`). Flicky's grammar:
 * ten Kenney CC0 effects (`public/sounds/SOURCES.md`), unlocked on the first gesture, every load and play error
 * swallowed, and two persisted sliders (effects, music) instead of one mute. Pips's discipline for controls: a press and
 * its release are one sample varied together. Kakure's own Sounds switch (Settings) is the master: off, the games are
 * silent too.
 */
export type SfxName =
  | "swipe-up"
  | "swipe-down"
  | "card-win"
  | "card-loss"
  | "match-found"
  | "duel-win"
  | "duel-lose"
  | "click"
  | "modal-open"
  | "modal-close";

const SFX_NAMES: readonly SfxName[] = [
  "swipe-up",
  "swipe-down",
  "card-win",
  "card-loss",
  "match-found",
  "duel-win",
  "duel-lose",
  "click",
  "modal-open",
  "modal-close",
];
const fileOf = (name: SfxName) => `/sounds/${name}.mp3`;

const SFX_VOLUME_KEY = gameKey("sfxVolume");
const BGM_VOLUME_KEY = gameKey("bgmVolume");

interface Variation {
  cents: number;
  gain: number;
  cutoffHz: number;
}

let sfxVolume = 1;
let bgmVolume = 1;
let volumesRead = false;
let unlocked = false;
let ctx: AudioContext | null = null;
let sfxGain: GainNode | null = null;
const buffers = new Map<SfxName, AudioBuffer>();
let bed: ChipBed | null = null;
let bedGain: GainNode | null = null;
let bgmWanted = false;
let lastPress: Variation | null = null;
let pressedAtMs = 0;
let asleep = false;
let sleepTimer: ReturnType<typeof setTimeout> | null = null;

const listeners = new Set<() => void>();
function emit(): void {
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const clamp01 = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1);

function readVolume(key: string): number {
  const raw = safeStorage.getItem(key);
  return raw === null ? 1 : clamp01(Number(raw));
}

function ensureVolumes(): void {
  if (volumesRead || typeof window === "undefined") return;
  volumesRead = true;
  sfxVolume = readVolume(SFX_VOLUME_KEY);
  bgmVolume = readVolume(BGM_VOLUME_KEY);
}

/** Kakure's Sounds switch is the master (the frame passes it in); the sliders are the games' own levels under it. */
let masterOn = true;
const audibleSfx = (): number => (masterOn ? sfxVolume : 0);
const audibleBgm = (): number => (masterOn ? bgmVolume : 0);
const bedOn = () => bgmWanted && unlocked && audibleBgm() > 0 && !(typeof document !== "undefined" && document.hidden);

function sleepSoon(): void {
  if (sleepTimer) clearTimeout(sleepTimer);
  sleepTimer = setTimeout(() => {
    sleepTimer = null;
    if (ctx && ctx.state === "running" && !bedOn()) {
      asleep = true;
      void ctx.suspend().catch(() => undefined);
    }
  }, SLEEP_AFTER_MS);
}

function wake(): void {
  asleep = false;
  if (ctx && ctx.state !== "running" && ctx.state !== "closed") void ctx.resume().catch(() => undefined);
  sleepSoon();
}

// ── Unlock and the effects ──

/** iOS counts touchend, click and pointerup (not a touch pointerdown) as the gesture that lets audio start. */
const UNLOCK_EVENTS = ["touchend", "click", "pointerup", "keydown"] as const;

/** Mount once, in the games frame; returns an uninstaller that stops the bed and puts the context to sleep. */
export function installAudioUnlock(): () => void {
  if (typeof window === "undefined") return () => undefined;
  ensureVolumes();
  for (const event of UNLOCK_EVENTS) window.addEventListener(event, unlock, { capture: true, passive: true });
  return () => {
    for (const event of UNLOCK_EVENTS) window.removeEventListener(event, unlock, { capture: true });
    bed?.stop();
    if (sleepTimer) clearTimeout(sleepTimer);
    if (ctx && ctx.state === "running") {
      asleep = true;
      void ctx.suspend().catch(() => undefined);
    }
  };
}

function unlock(): void {
  if (unlocked) {
    if (!asleep && ctx && ctx.state !== "running" && ctx.state !== "closed") void ctx.resume().catch(() => undefined);
    return;
  }
  unlocked = true;
  try {
    if (typeof AudioContext !== "undefined") {
      ctx = new AudioContext();
      sfxGain = ctx.createGain();
      sfxGain.gain.value = SFX_VOLUME_BASE * audibleSfx();
      sfxGain.connect(ctx.destination);
      void ctx.resume().catch(() => undefined);
      sleepSoon();
      for (const name of SFX_NAMES) void loadBuffer(name);
    }
  } catch {
    // No audio on this platform: stay silent.
  }
  syncBgm();
}

async function loadBuffer(name: SfxName): Promise<void> {
  if (!ctx || buffers.has(name)) return;
  try {
    const response = await fetch(fileOf(name));
    buffers.set(name, await ctx.decodeAudioData(await response.arrayBuffer()));
  } catch {
    // A missing or undecodable file: that one effect stays silent.
  }
}

function source(name: SfxName): AudioBufferSourceNode | null {
  if (audibleSfx() === 0 || !unlocked || !ctx || !sfxGain) return null;
  const buffer = buffers.get(name);
  if (!buffer) return null;
  wake();
  const node = ctx.createBufferSource();
  node.buffer = buffer;
  return node;
}

/** The effects bus for a cue built from oscillators (the arcade's): null when silenced, locked or absent. */
export function sfxBus(): { ctx: AudioContext; out: GainNode } | null {
  if (audibleSfx() === 0 || !unlocked || !ctx || !sfxGain) return null;
  wake();
  return { ctx, out: sfxGain };
}

/** Fire and forget; a no-op when silenced, locked, or not loaded yet. */
export function playSfx(name: SfxName): void {
  try {
    const node = source(name);
    if (!node || !sfxGain) return;
    node.connect(sfxGain);
    node.start();
  } catch {
    // Enhancement only.
  }
}

// ── Pips's press and release ──

const between = (lo: number, hi: number): number => lo + Math.random() * (hi - lo);

function nextVariation(previous: Variation | null): Variation {
  let cents = between(-PRESS.centsRange, PRESS.centsRange);
  if (previous && Math.abs(cents - previous.cents) < PRESS.minCentsChange) {
    cents = previous.cents + (cents >= previous.cents ? PRESS.minCentsChange : -PRESS.minCentsChange);
    cents = Math.max(-PRESS.centsRange, Math.min(PRESS.centsRange, cents));
  }
  return {
    cents,
    gain: between(PRESS.gainLo, PRESS.gainHi),
    cutoffHz: between(PRESS.cutoffLoHz, PRESS.cutoffHiHz),
  };
}

function playVaried(variation: Variation, gainScale: number): void {
  try {
    const node = source("click");
    if (!node || !ctx || !sfxGain) return;
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    node.playbackRate.value = 2 ** (variation.cents / CENTS_PER_OCTAVE);
    filter.type = "lowpass";
    filter.frequency.value = variation.cutoffHz;
    gain.gain.value = variation.gain * gainScale;
    node.connect(filter).connect(gain).connect(sfxGain);
    node.start();
  } catch {
    // Enhancement only.
  }
}

/** The moment a control goes down. */
export function pressSfx(): void {
  lastPress = nextVariation(lastPress);
  pressedAtMs = Date.now();
  playVaried(lastPress, 1);
}

/** The moment it comes up: its press's own variation, quieter, and never before the floor. */
export function releaseSfx(): void {
  const variation = lastPress ?? nextVariation(null);
  const wait = Math.max(0, PRESS_FLOOR_MS - (Date.now() - pressedAtMs));
  const fire = () => playVaried(variation, PRESS.releaseGain);
  if (wait > 0) setTimeout(fire, wait);
  else fire();
}

// ── The bed ──

/** Asks for the music loop; it plays only while unlocked, audible and visible. */
export function startBgm(): void {
  bgmWanted = true;
  syncBgm();
}

export function stopBgm(): void {
  bgmWanted = false;
  syncBgm();
}

function ensureBed(): ChipBed | null {
  if (bed || !ctx) return bed;
  try {
    bedGain = ctx.createGain();
    bedGain.gain.value = BGM_VOLUME_BASE * audibleBgm();
    bedGain.connect(ctx.destination);
    bed = createChipBed(ctx, bedGain);
  } catch {
    bed = null;
  }
  return bed;
}

/** One reconciler: play exactly when wanted, unlocked, audible and visible. */
function syncBgm(): void {
  if (bedOn()) {
    wake();
    ensureBed()?.start();
  } else {
    bed?.stop();
    sleepSoon();
  }
}

if (typeof document !== "undefined") document.addEventListener("visibilitychange", syncBgm);

/** Kakure's Sounds switch (or a slider) changed: the buses follow it. */
export function applyMaster(on = masterOn): void {
  masterOn = on;
  if (sfxGain) sfxGain.gain.value = SFX_VOLUME_BASE * audibleSfx();
  if (bedGain) bedGain.gain.value = BGM_VOLUME_BASE * audibleBgm();
  syncBgm();
  emit();
}

// ── The two sliders, persisted ──

export function setSfxVolume(value: number): void {
  sfxVolume = clamp01(value);
  safeStorage.setItem(SFX_VOLUME_KEY, String(sfxVolume));
  applyMaster();
}

export function setBgmVolume(value: number): void {
  bgmVolume = clamp01(value);
  safeStorage.setItem(BGM_VOLUME_KEY, String(bgmVolume));
  applyMaster();
}

const getSfx = () => {
  ensureVolumes();
  return sfxVolume;
};
const getBgm = () => {
  ensureVolumes();
  return bgmVolume;
};

export function useSfxVolume(): number {
  return useSyncExternalStore(subscribe, getSfx, () => 1);
}

export function useBgmVolume(): number {
  return useSyncExternalStore(subscribe, getBgm, () => 1);
}

// ── Sheets ──

/** For a sheet driven by an `open` prop: the open and close chirps on its transitions. */
export function useModalSfx(open: boolean): void {
  const previous = useRef(false);
  useEffect(() => {
    if (previous.current === open) return;
    previous.current = open;
    playSfx(open ? "modal-open" : "modal-close");
  }, [open]);
}

// ── The rail's one-tap mute ──

let unmuteTo = { sfx: 1, bgm: 1 };

/** Both channels to zero, or back to where they were; the sliders stay the fine control. */
export function toggleMute(): void {
  ensureVolumes();
  if (sfxVolume > 0 || bgmVolume > 0) {
    unmuteTo = { sfx: sfxVolume || 1, bgm: bgmVolume || 1 };
    setSfxVolume(0);
    setBgmVolume(0);
  } else {
    setSfxVolume(unmuteTo.sfx);
    setBgmVolume(unmuteTo.bgm);
  }
}

const isMuted = () => {
  ensureVolumes();
  return sfxVolume === 0 && bgmVolume === 0;
};

/** Muted here, or by Kakure's Sounds switch. */
export function useMuted(): boolean {
  const prefs = usePrefs();
  return useSyncExternalStore(subscribe, isMuted, () => false) || !prefs.sound;
}

/** The one-tap mute: with Kakure's Sounds switch off it turns sound on (and the games' levels back up). */
export function useMuteToggle(): () => void {
  const prefs = usePrefs();
  return () => {
    if (prefs.sound) {
      toggleMute();
      return;
    }
    setPrefs({ sound: true });
    if (isMuted()) toggleMute();
  };
}
