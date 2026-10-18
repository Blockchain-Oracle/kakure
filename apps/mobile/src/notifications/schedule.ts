import type { Network } from "@kakure/domain";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { useMarkets } from "@/data/markets";
import { viewAppTicket } from "@/tickets/ticket-view";
import { useTickets } from "@/tickets/use-tickets";

/**
 * Local notifications only (R5, PD10): scheduled on this device from public times in the signed bundle. There is no
 * push token, no server, nothing leaves the phone. Permission is asked once this device holds a ticket a reminder
 * would help.
 *
 * The lock screen is public (audit O24): the text never names an asset, a market, a side or an amount, and markets
 * that close at the same moment share one notification, so not even the number of markets shows.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const TITLE = "Kakure";
const CLOSED_BODY = "A market you're in has closed";
const PAYOUT_BODY = "Payout batch sent";

interface Reminder {
  identifier: string;
  at: number;
  body: string;
}

let permission: Promise<boolean> | null = null;

function allowed(): Promise<boolean> {
  permission ??= (async () => {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted;
  })().catch(() => false);
  return permission;
}

/**
 * Makes this network's scheduled set exactly `wanted`: cancels this module's notifications that are no longer wanted or whose
 * text changed (older builds named the asset), and schedules the missing ones.
 */
async function reconcile(network: Network, wanted: readonly Reminder[]): Promise<void> {
  // This network's identifiers only: the other network's reminders and anything else on the device stay.
  const own = (identifier: string) =>
    identifier.startsWith(`close:${network}:`) || identifier.startsWith(`payout:${network}:`);
  const byId = new Map(wanted.map((reminder) => [reminder.identifier, reminder]));
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const kept = new Set<string>();
  for (const notification of scheduled) {
    if (!own(notification.identifier)) continue;
    const reminder = byId.get(notification.identifier);
    const same =
      reminder !== undefined && notification.content.title === TITLE && notification.content.body === reminder.body;
    if (same) kept.add(notification.identifier);
    else await Notifications.cancelScheduledNotificationAsync(notification.identifier).catch(() => undefined);
  }
  for (const reminder of wanted) {
    if (kept.has(reminder.identifier) || reminder.at <= Date.now()) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: reminder.identifier,
      content: { title: TITLE, body: reminder.body },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(reminder.at) },
    }).catch(() => undefined);
  }
}

export function useNotificationsForTickets(): void {
  const data = useMarkets();
  const tickets = useTickets(data.network);
  const bundle = data.status === "ready" ? data.bundle : null;

  useEffect(() => {
    if (!Array.isArray(tickets) || tickets.length === 0) return;
    void (async () => {
      if (!(await allowed())) return;
      const now = Date.now();
      const wanted = new Map<string, Reminder>();
      for (const ticket of tickets) {
        if (ticket.send?.state === "failed") continue;
        const view = viewAppTicket(ticket, bundle, now);
        if (view.status !== "waiting" && view.status !== "counted") continue;
        // Keyed by the close time, not the market: one line for every market closing then.
        const identifier = `close:${ticket.network}:${ticket.closesAt}`;
        wanted.set(identifier, { identifier, at: Date.parse(ticket.closesAt), body: CLOSED_BODY });
      }
      for (const run of bundle?.payoutRuns ?? []) {
        const identifier = `payout:${data.network}:${run.allSentBy}`;
        wanted.set(identifier, { identifier, at: Date.parse(run.allSentBy), body: PAYOUT_BODY });
      }
      await reconcile(data.network, [...wanted.values()]);
    })().catch(() => undefined);
  }, [tickets, bundle, data.network]);
}
