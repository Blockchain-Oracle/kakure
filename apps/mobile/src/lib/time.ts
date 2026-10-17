import { useSyncExternalStore } from "react";
import { CLOCK_TICK_MS } from "@/constants";

const SECOND_MS = 1000;
const MINUTE_S = 60;
const HOUR_S = 3600;
const DAY_S = 86_400;
const PAD = 2;

let now = Date.now();
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

/** One shared one-second clock for every countdown on screen. */
export function useNow(): number {
  return useSyncExternalStore(
    subscribe,
    () => now,
    () => now,
  );
}

const pad = (value: number) => String(value).padStart(PAD, "0");

/** "2d 4h", "1:04:09", "12:30", "0:05": tabular-friendly countdown. */
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

export const formatClock = (iso: string | number) => timeFormat.format(new Date(iso));
export const formatDateTime = (iso: string | number) => dateTimeFormat.format(new Date(iso));

/** "at 19:50" today, else "Sat 18 Oct, 19:50". */
export function formatWhen(iso: string | number, at: number): string {
  const date = new Date(iso);
  const sameDay = new Date(at).toDateString() === date.toDateString();
  return sameDay ? `at ${formatClock(iso)}` : formatDateTime(iso);
}
