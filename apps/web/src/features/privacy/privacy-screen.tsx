/**
 * How privacy works (surfaces.md, D1; plan §00 "Who sees what"): the promise, who learns what, and the residual risks,
 * in plain words. A server component: it ships no JavaScript of its own.
 */
import { NETWORKS, PARTIES, PROMISE, RESIDUALS } from "./words";

export function PrivacyScreen() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <h1 className="font-display text-page-title text-foreground">How privacy works</h1>
      <section className="rounded-group border border-border bg-card p-5">
        <p className="font-display text-step-title text-foreground">{PROMISE.lead}</p>
        <p className="mt-3 text-body text-muted-foreground">{PROMISE.line}</p>
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
          {NETWORKS.title}
        </h2>
        <div className="flex flex-col gap-3 rounded-group border border-border bg-card p-5 text-body text-foreground">
          {NETWORKS.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </section>
    </div>
  );
}
