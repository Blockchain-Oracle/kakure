import type { Market } from "@kakure/domain";
import { nextBatchAt, viewTicket } from "@kakure/query";
import { router } from "expo-router";
import { View } from "react-native";
import { HASH_SHORT, NETWORK_COIN, TX_STEP_LABELS } from "@/constants";
import { useMarkets } from "@/data/markets";
import { Button } from "@/kit/button";
import { SheetBody } from "@/kit/screen";
import { Plate } from "@/kit/surface";
import { Txt } from "@/kit/text";
import { type Step, TxSteps } from "@/kit/tx-steps";
import { formatClock, useNow } from "@/lib/time";
import { coinAmount, SIDE_SIGN, sideWord } from "@/markets/market-view";
import { useTheme } from "@/theme/theme-provider";
import type { AppTicket } from "@/tickets/ticket-db";
import { useTickets } from "@/tickets/use-tickets";

/**
 * The bet's journey (C3 states), read from the saved ticket and the signed bundle, never assumed:
 * preparing private route → proving → sending privately → in mempool → counted. confirm() proves and sends over
 * Nym in one native call, so those two steps are active together. Failure always says whether money moved.
 */
export function stepsFor(ticket: AppTicket, counted: boolean, nextBatch: number | null): Step[] {
  const send = ticket.send;
  const sent = send?.state === "sent";
  const phase = send?.phase;
  const routeDone = sent || phase === "proving";
  const failed = send?.state === "failed";
  const state = (done: boolean, active: boolean): Step["state"] =>
    done ? "done" : failed && active ? "failed" : active ? "active" : "pending";
  const [route, proving, sending, mempool, countedLabel] = TX_STEP_LABELS;
  return [
    {
      label: route,
      state: state(routeDone, phase === "route" || !phase),
      ...(phase === "route" ? { detail: "Joining the Nym mixnet" } : {}),
    },
    { label: proving, state: state(sent, phase === "proving") },
    {
      label: sending,
      state: state(sent, phase === "proving"),
      ...(phase === "proving" ? { detail: "Proved and sent in one step over Nym" } : {}),
    },
    {
      label: mempool,
      state: state(sent, false),
      ...(send?.minedHeight
        ? { detail: `Mined at block ${send.minedHeight}` }
        : sent
          ? { detail: "Accepted by the network" }
          : {}),
    },
    {
      label: countedLabel,
      state: counted ? "done" : sent ? "active" : "pending",
      ...(!counted && sent && nextBatch ? { detail: `Next signed batch ${formatClock(nextBatch)}` } : {}),
    },
  ];
}

/**
 * `onRetry` returns to the bet form when nothing left the wallet. Trying again makes a new ticket (fresh nonce and
 * payout address); a failed ticket is never re-sent.
 */
export function BetProgress({ hash, market, onRetry }: { hash: string; market: Market; onRetry?: () => void }) {
  const theme = useTheme();
  const data = useMarkets();
  const now = useNow();
  const tickets = useTickets(data.network);
  const ticket = Array.isArray(tickets) ? tickets.find((candidate) => candidate.hash === hash) : undefined;
  if (!ticket) return null;
  const bundle = data.status === "ready" ? data.bundle : null;
  const view = viewTicket(ticket, bundle, now);
  const counted = ["counted", "won", "lost", "refunded", "paid"].includes(view.status);
  const nextBatch = data.status === "ready" ? nextBatchAt(data.latest) : null;
  const coin = NETWORK_COIN[ticket.network];
  const send = ticket.send;

  return (
    <SheetBody
      title={counted ? "Ticket counted" : send?.state === "failed" ? "Bet not sent" : "Placing your bet"}
      subtitle={`${SIDE_SIGN[ticket.side]} ${sideWord(ticket.side)} · ${coinAmount(BigInt(ticket.sizeZat), coin)} · ${market.rules.question}`}
    >
      <Plate>
        <TxSteps steps={stepsFor(ticket, counted, nextBatch)} />
      </Plate>
      {send?.state === "failed" ? (
        <Plate raised>
          <Txt variant="rowStrong">Nothing left your wallet.</Txt>
          <Txt variant="rowDetail" tone="muted">
            {send.error ?? "The payment wasn't sent."}
          </Txt>
        </Plate>
      ) : send?.state === "unknown" ? (
        <Plate raised>
          <Txt variant="rowStrong">Checking with your wallet.</Txt>
          <Txt variant="rowDetail" tone="muted">
            The send stopped partway, so it may or may not have gone out. It is never sent twice; your wallet's history
            settles it on the next sync.
          </Txt>
        </Plate>
      ) : null}
      <View style={{ gap: theme.space.sm }}>
        {send?.state === "failed" && onRetry ? (
          <Button label="Try again" onPress={onRetry} />
        ) : (
          <Button
            label="See the ticket"
            onPress={() => router.replace({ pathname: "/ticket/[hash]", params: { hash } })}
          />
        )}
        <Button label="Done" variant="secondary" size="md" onPress={() => router.back()} />
      </View>
      <Txt variant="meta" tone="text3">
        Ticket {hash.slice(0, HASH_SHORT.line)}… is saved on this phone. It counts once its hash appears in a signed
        batch.
      </Txt>
    </SheetBody>
  );
}
