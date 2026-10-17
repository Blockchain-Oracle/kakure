import { viewTicket } from "@kakure/query";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { CLOSE_REMINDER_MS } from "@/constants";
import { useMarkets } from "@/data/markets";
import { assetFor } from "@/markets/assets";
import { WINDOW_LABEL } from "@/markets/market-view";
import { useTickets } from "@/tickets/use-tickets";

/**
 * Local notifications only (R5, PD10): scheduled on this device from public times in the signed bundle, with
 * generic text (no amounts, no side). There is no push token, no server, nothing leaves the phone. Permission is
 * asked once this device holds a ticket that a reminder would help.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

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

async function scheduleAt(identifier: string, at: number, title: string, body: string) {
  if (at <= Date.now()) return;
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  if (existing.some((notification) => notification.identifier === identifier)) return;
  await Notifications.scheduleNotificationAsync({
    identifier,
    content: { title, body },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at) },
  });
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
      for (const ticket of tickets) {
        const view = viewTicket(ticket, bundle, now);
        if (view.status === "waiting" || view.status === "counted") {
          const asset = assetFor({ kind: ticket.kind, subject: ticket.subject });
          const window = WINDOW_LABEL[ticket.window].toLowerCase();
          await scheduleAt(
            `close:${ticket.network}:${ticket.marketId}`,
            Date.parse(ticket.closesAt) - CLOSE_REMINDER_MS,
            "Kakure",
            `Your ${asset.symbol} ${window} market closes in 10 min`,
          ).catch(() => undefined);
        }
      }
      for (const run of bundle?.payoutRuns ?? []) {
        await scheduleAt(
          `payout:${data.network}:${run.allSentBy}`,
          Date.parse(run.allSentBy),
          "Kakure",
          "Payout batch sent",
        ).catch(() => undefined);
      }
    })();
  }, [tickets, bundle, data.network]);
}
