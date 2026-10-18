import { MIN_NEW_TICKETS_PER_RELEASE, MIN_TICKETS_PER_SIDE, TICKET_SIZES_ZAT, zatToZec } from "@kakure/domain";
import { buttonClass, cx } from "@kakure/ui-web";
import { Clock, Lock, Undo2, Users } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { PARTIES } from "@/features/privacy/words";
import { CAPTURED_ON, CAPTURES } from "./captures";

/**
 * The landing's static sections (refero-design-research §3.4–3.7). Server components: no JavaScript ships for
 * them. Every claim is something Kakure does today; images are real captures of the testnet app.
 */
const PHONE_WIDTH = 390;
const PHONE_HEIGHT = 844;
const STEP_DIGITS = 2;
const SMALLEST = zatToZec(TICKET_SIZES_ZAT[0] ?? 0n);
const LARGEST = zatToZec(TICKET_SIZES_ZAT[TICKET_SIZES_ZAT.length - 1] ?? 0n);

export function Section({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  lead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="mx-auto flex w-full max-w-(--layout-content-max) scroll-mt-24 flex-col gap-6 px-5 rail:px-8"
    >
      <div className="flex max-w-2xl flex-col gap-2">
        <h2 id={`${id}-title`} className="font-display text-page-title text-foreground">
          {title}
        </h2>
        {lead ? <p className="text-body text-muted-foreground">{lead}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function PhoneShot({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return (
    <figure className={cx("flex flex-col items-center gap-2", className)}>
      <div className="w-full max-w-60 rounded-[2.4rem] bg-primary p-2 shadow-receipt">
        <img
          src={src}
          alt={alt}
          width={PHONE_WIDTH}
          height={PHONE_HEIGHT}
          loading="lazy"
          decoding="async"
          className="block aspect-[390/844] w-full rounded-[1.9rem] bg-card object-cover object-top"
        />
      </div>
      <figcaption className="text-meta text-muted-foreground">Testnet app, captured {CAPTURED_ON}</figcaption>
    </figure>
  );
}

const STEPS = [
  {
    title: "Pick a side and a ticket",
    body: `Up or Down, then one fixed ticket from ${SMALLEST} to ${LARGEST}. No amount field: every ticket of a size looks like every other.`,
    shot: CAPTURES.betTicket,
  },
  {
    title: "Paste a fresh shielded address",
    body: "From your wallet's Receive screen. Your browser checks it has an Orchard receiver and no transparent one. Winnings and refunds come back here.",
    shot: CAPTURES.betAddress,
  },
  {
    title: "Scan it with your wallet",
    body: "Zodl or Zingo. The QR is built on your device, never sent anywhere, and hides itself whenever you look away.",
    shot: CAPTURES.betQr,
  },
] as const;

export function PlaceABet() {
  return (
    <Section
      id="bet"
      title="Bet in three steps"
      lead="No account, no sign-in, no deposit. You pay from your own wallet, by QR."
    >
      <ol className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex flex-col gap-4 rounded-group bg-card p-5">
            <span className="font-display text-display-price text-text-3 tabular-nums">
              {String(index + 1).padStart(STEP_DIGITS, "0")}
            </span>
            <h3 className="text-title text-foreground">{step.title}</h3>
            <p className="text-row-detail text-muted-foreground">{step.body}</p>
            <PhoneShot src={step.shot.src} alt={step.shot.alt} className="mt-auto pt-2" />
          </li>
        ))}
      </ol>
    </Section>
  );
}

export function WhoSeesWhat() {
  return (
    <Section
      id="privacy"
      title="Who sees what"
      lead="The operator sees what was bet, never who bet it. It sees each bet's amount, side, arrival time and payout address; the published odds are signed reports, not proofs."
    >
      <ul className="flex flex-col gap-3 md:hidden">
        {PARTIES.map((row) => (
          <li key={row.party} className="flex flex-col gap-3 rounded-group bg-card p-4">
            <h3 className="text-row-strong text-foreground">{row.party}</h3>
            <div>
              <div className="text-label text-muted-foreground">Learns</div>
              <p className="mt-0.5 text-row-detail text-foreground">{row.learns}</p>
            </div>
            <div>
              <div className="text-label text-muted-foreground">Never learns</div>
              <p className="mt-0.5 text-row-detail text-foreground">{row.never}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="overflow-hidden rounded-group bg-card max-md:hidden">
        <table className="w-full text-left text-row-detail">
          <thead className="bg-raised-2 text-label text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-3">
                Who
              </th>
              <th scope="col" className="px-4 py-3">
                Learns
              </th>
              <th scope="col" className="px-4 py-3">
                Never learns
              </th>
            </tr>
          </thead>
          <tbody>
            {PARTIES.map((row) => (
              <tr key={row.party} className="align-top odd:bg-card even:bg-raised-2">
                <th scope="row" className="px-4 py-3 text-row-strong text-foreground">
                  {row.party}
                </th>
                <td className="px-4 py-3 text-foreground">{row.learns}</td>
                <td className="px-4 py-3 text-foreground">{row.never}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Link href="/privacy" className={buttonClass("secondary", "sm", "w-fit")}>
        Read what we can't hide
      </Link>
    </Section>
  );
}

const LIFECYCLE = [
  {
    icon: <Lock />,
    title: "Sealed",
    body: `Until each side has ${MIN_TICKETS_PER_SIDE} tickets, the odds stay hidden and only the ticket count is published.`,
  },
  {
    icon: <Users />,
    title: "In groups, never one by one",
    body: `The count, the ticket list and the totals change only when at least ${MIN_NEW_TICKETS_PER_RELEASE} new tickets have arrived, so no single bet shows.`,
  },
  {
    icon: <Undo2 />,
    title: "No group, no publish",
    body: `If fewer than ${MIN_NEW_TICKETS_PER_RELEASE} tickets are still waiting when betting closes for good, they're refunded in full and never published.`,
  },
  {
    icon: <Clock />,
    title: "On the clock",
    body: "A signed batch goes out every 10 minutes whether anything changed or not.",
  },
];

export function Lifecycle({ now }: { now: ReactNode }) {
  return (
    <Section
      id="sealed"
      title="Odds that can't give you away"
      lead="Live odds would let anyone watch a single bet land. Kakure's are batched and sealed."
    >
      <div className="grid grid-cols-1 gap-4 wide:grid-cols-[minmax(0,1fr)_22rem]">
        <ol className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {LIFECYCLE.map((step) => (
            <li key={step.title} className="flex gap-4 rounded-group bg-card p-5">
              <span
                aria-hidden
                className="grid size-10 shrink-0 place-items-center rounded-md bg-secondary text-foreground [&_svg]:size-5"
              >
                {step.icon}
              </span>
              <div>
                <h3 className="text-row-title text-foreground">{step.title}</h3>
                <p className="mt-1 text-row-detail text-muted-foreground">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        {now}
      </div>
    </Section>
  );
}

export function PortfolioAndReceipts() {
  return (
    <Section
      id="receipts"
      title="Your tickets stay on your device"
      lead="Kakure keeps no account and no server copy. Your tickets are encrypted in this browser, and only you can export them."
    >
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-4 rounded-group bg-card p-5 md:flex-row">
          <PhoneShot src={CAPTURES.portfolio.src} alt={CAPTURES.portfolio.alt} className="w-48 shrink-0 self-center" />
          <div className="flex flex-col gap-2">
            <h3 className="text-title text-foreground">Portfolio</h3>
            <p className="text-row-detail text-muted-foreground">
              Open and settled tickets, your result in ZEC, and a privacy eye that takes amounts off the page. While a
              position is open, a sound ladder climbs as the price moves your way.
            </p>
            <p className="text-row-detail text-muted-foreground">
              Replays of a market's price path come with the daily signed price history; none are faked before then.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-4 rounded-group bg-card p-5 md:flex-row">
          <PhoneShot src={CAPTURES.ticket.src} alt={CAPTURES.ticket.alt} className="w-48 shrink-0 self-center" />
          <div className="flex flex-col gap-2">
            <h3 className="text-title text-foreground">Receipts</h3>
            <p className="text-row-detail text-muted-foreground">
              A perforated slip made on your device: no payout address, no transaction id, no bet time. An outcome slip
              shows the result; a provable one lets anyone find your ticket in the signed list, and you choose when to
              share that.
            </p>
          </div>
        </div>
      </div>
    </Section>
  );
}
