import { Phone } from "./phone";
import { WORDS } from "./words";

/** "Deposit. Trade. Withdraw." (Mitoshi's "Pick. Call. Settle."): three steps over cropped captures of the real app. */
export function How() {
  const { how } = WORDS;
  return (
    <section id="how" className="lp-section" aria-labelledby="lp-how-title">
      <div className="lp-wrap">
        <p className="lp-kicker">{how.kicker}</p>
        <h2 id="lp-how-title" className="lp-h2 lp-silver">
          <span>{how.title}</span>
        </h2>
        <ol className="lp-steps">
          {how.steps.map((step) => (
            <li key={step.n} className="lp-card overflow-hidden">
              <div className="lp-step-shot">
                <Phone shot={step.shot} place={`how-${step.n}`} alt={step.alt} />
              </div>
              <div className="flex flex-col gap-2 p-5">
                <span className="lp-step-n">{step.n}</span>
                <h3 className="font-display text-[20px] font-bold tracking-[-0.02em]">{step.title}</h3>
                <p className="text-row-detail text-muted-foreground">{step.line}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
