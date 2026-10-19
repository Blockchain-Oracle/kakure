import Link from "next/link";
import { SHIPPED, WORDS } from "./words";

/** The arcade strip (Mitoshi's games hall, Senryo's cabinets): checkered cabinets with sticker labels. */
export function Arcade() {
  const { games, bento } = WORDS;
  return (
    <section className="lp-section" aria-labelledby="lp-arcade-title">
      <div className="lp-wrap">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="lp-kicker">{games.kicker}</p>
            <h2 id="lp-arcade-title" className="lp-h2 lp-silver">
              <span>{games.title}</span>
            </h2>
            <p className="lp-lead">{games.line}</p>
          </div>
          <Link href="/games" className="lp-btn lp-btn--glass lp-btn--sm">
            {games.open}
          </Link>
        </div>
        <ul className="lp-cabinets">
          {games.cabinets.map((cabinet) => (
            <li key={cabinet.name} className="lp-cabinet">
              <span className="lp-cabinet-tag">{SHIPPED.games ? cabinet.tag : bento.soon}</span>
              <h3>{cabinet.name}</h3>
              <p>{cabinet.line}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
