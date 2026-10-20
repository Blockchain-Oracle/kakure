"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { type InstallHint, installHintOf } from "./browser";

/**
 * The install state, captured app-wide (Mitoshi `features/install/install-store.ts`: `beforeinstallprompt` fires once,
 * early, so a listener mounted only on /download usually missed it). `InstallWatch` in the root layout subscribes on
 * every page, and the held prompt lasts the session. Server and first paint read "manual", so hydration matches.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export interface InstallSnapshot {
  /** Running installed: the standalone display mode, or Safari's own flag. */
  installed: boolean;
  /** The browser offered its install prompt (Chromium). */
  canPrompt: boolean;
  ios: boolean;
  hint: InstallHint;
}

export type InstallState = "installed" | "prompt" | "ios" | "manual";
export type InstallChoice = "accepted" | "dismissed";

const STANDALONE = "(display-mode: standalone)";
const SERVER: InstallSnapshot = { installed: false, canPrompt: false, ios: false, hint: "other" };
let snapshot: InstallSnapshot = SERVER;
let deferred: BeforeInstallPromptEvent | null = null;
let attached = false;
const listeners = new Set<() => void>();

function compute(): InstallSnapshot {
  const nav = navigator as Navigator & { standalone?: boolean };
  const installed = window.matchMedia?.(STANDALONE).matches === true || nav.standalone === true;
  // iPadOS reports a Mac; its touch points give it away. A user agent that says Android never is one (an emulated
  // Android on a Mac keeps the Mac's platform).
  const ua = navigator.userAgent;
  const ipad = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1 && !/\bAndroid\b/.test(ua);
  const ios = /iPhone|iPad|iPod/.test(ua) || ipad;
  return { installed, canPrompt: deferred !== null, ios, hint: ios ? "ios" : installHintOf(ua) };
}

function emit() {
  snapshot = compute();
  for (const listener of listeners) listener();
}

function attach() {
  if (attached || typeof window === "undefined") return;
  attached = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
  window.matchMedia?.(STANDALONE).addEventListener?.("change", emit);
  snapshot = compute();
}

function subscribe(listener: () => void): () => void {
  attach();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Opens the held prompt: the reader's choice, or null when none is held. A prompt is single-use either way. */
async function promptInstall(): Promise<InstallChoice | null> {
  if (!deferred) return null;
  try {
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    emit();
    return outcome;
  } catch {
    return null;
  }
}

export function useInstallState(): InstallSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => SERVER,
  );
}

export function useInstallPrompt(): {
  state: InstallState;
  hint: InstallHint;
  install: () => Promise<InstallChoice | null>;
  busy: boolean;
} {
  const s = useInstallState();
  const [busy, setBusy] = useState(false);
  const install = useCallback(async () => {
    setBusy(true);
    try {
      return await promptInstall();
    } finally {
      setBusy(false);
    }
  }, []);
  const state: InstallState = s.installed ? "installed" : s.canPrompt ? "prompt" : s.ios ? "ios" : "manual";
  return { state, hint: s.hint, install, busy };
}

/** Mounted once in the root layout so the prompt is caught on whichever page the browser fires it. */
export function InstallWatch() {
  useInstallState();
  return null;
}
