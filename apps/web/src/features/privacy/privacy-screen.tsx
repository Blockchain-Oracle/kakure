/**
 * How privacy works (surfaces.md, D1): the promise, who learns what, and the residual risks, in plain words.
 * Sources: context/11-chosen-direction/privacy-design.md (the promise, "Who learns what", residual risks) and
 * plan §6 (disclosed residuals). A server component: it ships no JavaScript of its own.
 */
const PARTIES: ReadonlyArray<{ party: string; learns: string; never: string }> = [
  {
    party: "Anyone watching the chain",
    learns: "That shielded transactions happened, with their timing, fee and shape.",
    never: "Who paid whom, how much, the memo, or that a transaction is a bet.",
  },
  {
    party: "The operator (us)",
    learns: "Each bet's amount, side, arrival time and payout address.",
    never: "Who you are or which wallet paid. Clients never contact the operator; it only publishes signed files.",
  },
  {
    party: "This website's host",
    learns: "Your IP address, when you visited and which pages you opened.",
    never: "Your bets, sides or payout address. The QR is built in your browser and market ids stay in the #fragment.",
  },
  {
    party: "Your wallet's server",
    learns: "Your IP and when you broadcast, unless your wallet uses Tor.",
    never: "The memo or the amount.",
  },
  {
    party: "Other bettors and the public",
    learns: "Odds in scheduled batches, once each side has 3 tickets, and the result.",
    never: "Any single bet: odds move only after 3 new tickets.",
  },
  {
    party: "An exchange where you cash out",
    learns: "The amount you deposit.",
    never: "Which bet it came from: every same-size winning ticket pays the same.",
  },
];

const RESIDUALS = [
  "The operator sees every bet's amount, side and payout address, though not who placed it.",
  "Odds are reports signed by the operator, not cryptographic proofs.",
  "Custody and resolution are trusted: there are no smart contracts on Zcash.",
  "The final totals become public after the cutoff, and a determined observer can try the n−1 attack on a market with few bets.",
  "Miners set block timestamps within consensus limits, so the cutoff block has some latitude.",
  "Your own funding history and your wallet's server are outside Kakure's control.",
  "While few people use Kakure, the set of bettors you hide among is small.",
  "The published market addresses could be decrypted by a future break of today's cryptography (harvest now, decrypt later).",
  "Stock markets settle on two keyed sources (Pyth and Alpaca) that you can't re-fetch yourself.",
  "The mainnet node runs from an unsigned snapshot.",
];

export function PrivacyScreen() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-6 rail:px-8 rail:py-8">
      <h1 className="font-display text-page-title text-foreground">How privacy works</h1>
      <section className="rounded-group bg-card p-5">
        <p className="font-display text-step-title font-black text-foreground">
          The public sees nothing beyond what any shielded Zcash transaction shows. The operator sees what was bet,
          never who bet it.
        </p>
        <p className="mt-3 text-body text-muted-foreground">
          You pay from your own shielded wallet. Your bet travels in the encrypted memo with a fresh payout address, so
          there's no account, no sign-in and no claim step: winnings and refunds go back to that address on a timer.
        </p>
      </section>

      <section aria-labelledby="who-title" className="flex flex-col gap-3">
        <h2 id="who-title" className="text-sheet-heading text-foreground">
          Who learns what
        </h2>
        <div className="overflow-x-auto rounded-group bg-card">
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
      </section>

      <section aria-labelledby="residual-title" className="flex flex-col gap-3">
        <h2 id="residual-title" className="text-sheet-heading text-foreground">
          What we can't hide
        </h2>
        <ol className="flex list-decimal flex-col gap-2 rounded-group bg-card p-5 pl-10 text-body text-foreground">
          {RESIDUALS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="real-title" className="flex flex-col gap-3">
        <h2 id="real-title" className="text-sheet-heading text-foreground">
          Testnet and mainnet
        </h2>
        <div className="rounded-group bg-card p-5 text-body text-foreground">
          <p>
            Testnet uses TAZ, which has no value; it is where Kakure runs today. Mainnet uses real ZEC and needs a
            deliberate slide to switch to. Each network keeps its own markets, operator key, cached files and tickets on
            your device, and a ticket file from one network can't be imported into the other.
          </p>
          <p className="mt-3 text-muted-foreground">
            On the web, the site can't see your wallet. A ticket shows as counted only when its hash appears in a signed
            batch, and as paid only when the operator marks its market's payouts sent; your wallet is the only proof a
            payout arrived.
          </p>
        </div>
      </section>
    </div>
  );
}
