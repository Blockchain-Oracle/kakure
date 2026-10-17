"use client";

import { useSyncExternalStore } from "react";
import { CLOCK_TICK_MS } from "@/constants";

const SECOND_MS = 1000;
const MINUTE_S = 60;
const HOUR_S = 3600;
const DAY_S = 86_400;
const PAD = 2;

let now = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const notify of listeners) notify();
    }, CLOCK_TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** One shared one-second clock for every countdown on the page (0 during prerender). */
export function useNow(): number {
  return useSyncExternalStore(
    subscribe,
    () => now || Date.now(),
    () => 0,
  );
}

const pad = (value: number) => String(value).padStart(PAD, "0");

/** "2d 4h", "1:04:09", "12:30", "0:05" — tabular-friendly countdown. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / SECOND_MS));
  const days = Math.floor(total / DAY_S);
  const hours = Math.floor((total % DAY_S) / HOUR_S);
  const minutes = Math.floor((total % HOUR_S) / MINUTE_S);
  const seconds = total % MINUTE_S;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${minutes}:${pad(seconds)}`;
}

/** "3 min", "2 h", "5 d" for ages. */
export function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / SECOND_MS));
  if (seconds < MINUTE_S) return `${seconds} s`;
  if (seconds < HOUR_S) return `${Math.round(seconds / MINUTE_S)} min`;
  if (seconds < DAY_S) return `${Math.round(seconds / HOUR_S)} h`;
  return `${Math.round(seconds / DAY_S)} d`;
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatClock(iso: string | number): string {
  return timeFormat.format(new Date(iso));
}

export function formatDateTime(iso: string | number): string {
  return dateTimeFormat.format(new Date(iso));
}

const weekdayTimeFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
const WEEK_DAYS = 7;
const WEEK_MS = WEEK_DAYS * DAY_S * SECOND_MS;

/** Compact for cards: "18:50" today, "Sun 01:00" this week, else the date and time. */
export function formatShortWhen(iso: string, reference: number): string {
  const date = new Date(iso);
  if (reference > 0 && new Date(reference).toDateString() === date.toDateString()) return timeFormat.format(date);
  if (reference > 0 && Math.abs(date.getTime() - reference) < WEEK_MS) return weekdayTimeFormat.format(date);
  return dateTimeFormat.format(date);
}

/** Clock time, plus the date when it isn't today. */
export function formatWhen(iso: string, reference: number): string {
  const date = new Date(iso);
  const sameDay = reference > 0 && new Date(reference).toDateString() === date.toDateString();
  return sameDay ? timeFormat.format(date) : dateTimeFormat.format(date);
}
