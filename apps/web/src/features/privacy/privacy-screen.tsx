/**
 * How privacy works (surfaces.md, D1): the promise, who learns what, and the residual risks, in plain words.
 * Sources: context/11-chosen-direction/privacy-design.md (the promise, "Who learns what", residual risks) and
 * plan §6 (disclosed residuals). A server component: it ships no JavaScript of its own.
 */
import { MIN_NEW_TICKETS_PER_RELEASE } from "@kakure/domain";
import { PARTIES, RESIDUALS } from "./words";

export function PrivacyScreen() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <h1 className="font-display text-page-title text-foreground">How privacy works</h1>
      <section className="rounded-group border border-border bg-card p-5">
        <p className="font-display text-step-title text-foreground">
          The public sees nothing beyond what any shielded Zcash transaction shows. The operator sees what was bet,
          never who bet it.
        </p>
        <p className="mt-3 text-body text-muted-foreground">
          You pay from your own shielded wallet. Your bet travels in the encrypted memo with a fresh payout address, so
          there's no account, no sign-in and no claim step: winnings and refunds go back to that address on a timer.
        </p>
      </section>

      <section aria-labelledby="who-title" className="flex flex-col gap-3">
        <h2 id="who-title" className="font-display text-sheet-heading text-foreground">
          Who learns what
        </h2>
        <div className="overflow-x-auto rounded-group border border-border bg-card">
          <table className="w-full min-w-[36rem] text-left text-row-detail">
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
                  <th scope="row" className="w-40 px-4 py-3 text-row-strong text-foreground [overflow-wrap:normal]">
                    {row.party}
                  </th>
                  <td className="px-4 py-3 text-foreground">{row.learns}</td>
                  <td className="px-4 py-3 text-foreground">{row.never}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="residual-title" className="flex flex-col gap-3">
        <h2 id="residual-title" className="font-display text-sheet-heading text-foreground">
          What we can't hide
        </h2>
        <ol className="flex list-decimal flex-col gap-2 rounded-group border border-border bg-card p-5 pl-10 text-body text-foreground">
          {RESIDUALS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="real-title" className="flex flex-col gap-3">
        <h2 id="real-title" className="font-display text-sheet-heading text-foreground">
          Testnet and mainnet
        </h2>
        <div className="rounded-group border border-border bg-card p-5 text-body text-foreground">
          <p>
            Testnet uses TAZ, which has no value; it is where Kakure runs today. Mainnet uses real ZEC and needs a
            deliberate slide to switch to. Each network keeps its own markets, operator key, cached files and tickets on
            your device, and a ticket file from one network can't be imported into the other.
          </p>
          <p className="mt-3 text-muted-foreground">
            On the web, the site can't see your wallet. A ticket shows as counted only when its hash appears in a signed
            batch, which happens in groups of at least {MIN_NEW_TICKETS_PER_RELEASE} new tickets, and as paid only when
            the operator marks its market's payouts sent; your wallet is the only proof a payout arrived.
          </p>
        </div>
      </section>
    </div>
  );
}
