import { Phone } from "./phone";
import { WORDS } from "./words";

/**
 * "One app" (Mitoshi's phone stage, mitoshi-code-study §7): the trade terminal in front, Markets and open positions
 * fanned behind it, over the neon 隠れ outline that breathes and sweeps. Real captures of the testnet app.
 */
export function Stage() {
  const { stage } = WORDS;
  return (
    <section className="lp-section" aria-labelledby="lp-stage-title">
      <div className="lp-wrap text-center">
        <p className="lp-kicker">{stage.kicker}</p>
        <h2 id="lp-stage-title" className="lp-h2 lp-silver items-center">
          <span>{stage.title[0]}</span>
          <span>{stage.title[1]}</span>
        </h2>
        <p className="lp-lead mx-auto">{stage.line}</p>
        <figure className="lp-stage" aria-label={stage.label}>
          <span className="lp-wordmark lp-neon" aria-hidden lang="ja" data-text="隠れ">
            隠れ
          </span>
          <div className="lp-stage-side lp-stage-side--l" aria-hidden>
            <Phone shot="markets" place="stage-l" />
          </div>
          <div className="lp-stage-side lp-stage-side--r" aria-hidden>
            <Phone shot="positions" place="stage-r" />
          </div>
          <div className="lp-stage-main">
            <Phone shot="trade" place="stage-main" />
          </div>
        </figure>
      </div>
    </section>
  );
}
