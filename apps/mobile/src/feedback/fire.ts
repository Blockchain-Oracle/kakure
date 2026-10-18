import { toHex, utf8 } from "@kakure/domain";
import { CUES, type CueName, type HapticWord, LADDER_SEMITONES } from "@kakure/sounds";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { type AudioPlayer, createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { getRandomBytes } from "expo-crypto";
import * as Haptics from "expo-haptics";
import * as SecureStore from "expo-secure-store";
import { AppState, Platform } from "react-native";
import { STORAGE_KEYS } from "@/constants";
import { readText, removeKey, writeText } from "@/lib/kv";
import { prefsStore } from "@/settings/prefs";
import { CUE_SOURCES, type CueSourceKey } from "./generated/cue-sources";

/**
 * The one call site for sound and haptics (kawase.md §9.1). Cues are @kakure/sounds' definitions rendered to WAV
 * (scripts/render-sounds.mjs). "No sound for ticks or navigation": a sound is for money and outcomes.
 * Nothing here ever throws into a money flow: every failure is swallowed.
 */

/** Hot cues get two players so a quick repeat overlaps instead of waiting for a rewind (Kawase's pool). */
const POOL_SIZE = 2;
const HOT: ReadonlySet<CueSourceKey> = new Set(["toggle", "adverse", "batch"]);
const IDENTITY_KEY = "kakure.cues.v2";
/** v1 kept identities in the clear (ticket hashes, txids): migrated to digests once, then removed. */
const LEGACY_IDENTITY_KEY = "kakure.cues.v1";
const IDENTITY_LIMIT = 500;
const KEY_BYTES = 32;
/** 128-bit digests: collisions are out of reach for a few hundred cues. */
const DIGEST_BYTES = 16;
const HEX_RADIX = 16;

const players = new Map<CueSourceKey, AudioPlayer[]>();
const next = new Map<CueSourceKey, number>();
let played: Set<string> | null = null;
let foreground = AppState.currentState === "active";

function sourceKey(cue: CueName, step: number): CueSourceKey {
  if (cue !== "profit") return cue as CueSourceKey;
  const clamped = Math.min(Math.max(0, step), LADDER_SEMITONES.length - 1);
  return `profit-${clamped}` as CueSourceKey;
}

function playersFor(key: CueSourceKey): AudioPlayer[] {
  const existing = players.get(key);
  if (existing) return existing;
  const count = HOT.has(key) || key.startsWith("profit") ? POOL_SIZE : 1;
  const created = Array.from({ length: count }, () => createAudioPlayer(CUE_SOURCES[key]));
  players.set(key, created);
  return created;
}

/** Creates every player at launch so the first cue plays on time (Kawase's warm-up). */
export function warmSounds(): void {
  try {
    void setAudioModeAsync({
      playsInSilentMode: false,
      interruptionMode: "mixWithOthers",
      shouldPlayInBackground: false,
    });
    for (const key of Object.keys(CUE_SOURCES) as CueSourceKey[]) playersFor(key);
  } catch {
    // Sounds are a courtesy.
  }
  // Read (and migrate) the cue memory now, so an older build's clear-text list is gone at launch (audit O4).
  played ??= readPlayed();
  AppState.addEventListener("change", (state) => {
    foreground = state === "active";
  });
}

function playSound(cue: CueName, step: number): void {
  if (!foreground) return;
  try {
    const key = sourceKey(cue, step);
    const pool = playersFor(key);
    const index = next.get(key) ?? 0;
    next.set(key, (index + 1) % pool.length);
    const player = pool[index];
    if (!player) return;
    player.seekTo(0);
    player.play();
  } catch {
    // A failed cue is never an error for the person.
  }
}

/** Android's own haptic constants per word (kawase.md §9.5): no VIBRATE permission, the system's feel. */
const ANDROID: Record<HapticWord, Haptics.AndroidHaptics> = {
  tick: Haptics.AndroidHaptics.Segment_Tick,
  move: Haptics.AndroidHaptics.Clock_Tick,
  press: Haptics.AndroidHaptics.Virtual_Key,
  snap: Haptics.AndroidHaptics.Gesture_End,
  confirm: Haptics.AndroidHaptics.Confirm,
  filled: Haptics.AndroidHaptics.Confirm,
  warn: Haptics.AndroidHaptics.Reject,
  fail: Haptics.AndroidHaptics.Reject,
  surge: Haptics.AndroidHaptics.Long_Press,
};

/** Haptic words (kawase.md §9.5): iOS semantic feedback, Android haptic constants. Failures are silent. */
export function haptic(word: HapticWord): void {
  if (!prefsStore.get().haptics) return;
  if (Platform.OS === "android") {
    Haptics.performAndroidHapticsAsync(ANDROID[word]).catch(() => undefined);
    return;
  }
  const run = (): Promise<void> => {
    switch (word) {
      case "tick":
      case "move":
        return Haptics.selectionAsync();
      case "press":
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      case "snap":
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
      case "confirm":
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
      case "filled":
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      case "warn":
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      case "fail":
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      case "surge":
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
  };
  run().catch(() => undefined);
}

let cueKey: Uint8Array | null | undefined;

/** The device-only key for cue digests, made on first use (secure-store, this device, while unlocked). */
function digestKey(): Uint8Array | null {
  if (cueKey !== undefined) return cueKey;
  const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
  try {
    let hex = SecureStore.getItem(STORAGE_KEYS.cueKey, options);
    if (!hex) {
      hex = toHex(getRandomBytes(KEY_BYTES));
      SecureStore.setItem(STORAGE_KEYS.cueKey, hex, options);
    }
    cueKey = Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, HEX_RADIX));
  } catch {
    // No keystore: identities are then remembered for this session only, never written in the clear.
    cueKey = null;
  }
  return cueKey;
}

/** An identity ("won:<ticket hash>", "send:<txid>") as an opaque digest; null without a key. */
function digest(identity: string): string | null {
  const key = digestKey();
  return key ? toHex(hmac(sha256, key, utf8.encode(identity)).slice(0, DIGEST_BYTES)) : null;
}

function readPlayed(): Set<string> {
  try {
    const stored = new Set(JSON.parse(readText(IDENTITY_KEY) ?? "[]") as string[]);
    const legacy = readText(LEGACY_IDENTITY_KEY);
    if (legacy !== null) {
      for (const identity of JSON.parse(legacy) as string[]) {
        const opaque = digest(identity);
        if (opaque) stored.add(opaque);
      }
      removeKey(LEGACY_IDENTITY_KEY);
      writeText(IDENTITY_KEY, JSON.stringify([...stored].slice(-IDENTITY_LIMIT)));
    }
    return stored;
  } catch {
    return new Set();
  }
}

/**
 * Whether this identity's cue already played. The kv-store is plain SQLite, so it holds only HMAC digests under a
 * device-only key: no ticket hash, outcome or txid is readable from it (audit O4).
 */
function seen(identity: string): boolean {
  played ??= readPlayed();
  const opaque = digest(identity);
  const entry = opaque ?? identity;
  if (played.has(entry)) return true;
  played.add(entry);
  if (opaque)
    writeText(IDENTITY_KEY, JSON.stringify([...played].filter((item) => !item.includes(":")).slice(-IDENTITY_LIMIT)));
  return false;
}

/** Forget this device: the digest key goes too, so old digests can't be tested against known hashes. */
export function forgetCueMemory(): void {
  played = null;
  cueKey = undefined;
  removeKey(IDENTITY_KEY);
  removeKey(LEGACY_IDENTITY_KEY);
  SecureStore.deleteItemAsync(STORAGE_KEYS.cueKey).catch(() => undefined);
}

/**
 * Plays a cue and its haptic. An outcome cue carries an `identity` (a ticket hash plus its state) and plays once per
 * identity, remembered on this device, so a remount or relaunch never replays a win.
 */
export function fire(cue: CueName, options: { identity?: string; step?: number; haptic?: HapticWord | false } = {}) {
  if (options.identity && seen(options.identity)) return;
  if (prefsStore.get().sound) playSound(cue, options.step ?? 0);
  const word = options.haptic === false ? undefined : (options.haptic ?? CUES[cue].haptic);
  if (word) haptic(word);
}
