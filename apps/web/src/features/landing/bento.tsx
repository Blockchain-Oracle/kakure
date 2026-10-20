import { AlignVerticalSpaceAround, EyeOff, Gamepad2, Layers, Swords } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { CryptoSparks, SparkRow } from "./bento-live";
import { SHIPPED, START, WORDS } from "./words";

/**
 * "Six assets. Seven Window lengths. Two buttons." (Mitoshi's bento, mitoshi-code-study §7; 21st.dev manuarora700/
 * bento-grid #1197's grid, reskinned): one idea a tile, a live fragment where there is one. Range and parlays trade
 * today; the arcade and Duel carry "Soon" until their stage flips `SHIPPED`.
 */
export function Bento() {
  const { bento } = WORDS;
  return (
    <section className="lp-section" aria-labelledby="lp-bento-title">
      <div className="lp-wrap">
        <p className="lp-kicker">{bento.kicker}</p>
        <h2 id="lp-bento-title" className="lp-h2 lp-silver max-w-3xl">
          <span>{bento.title}</span>
        </h2>
        <div className="lp-bento">
          <Link href={START} className="lp-tile lp-tile--crypto">
            <span className="lp-eyebrow">{bento.crypto.eyebrow}</span>
            <h3>{bento.crypto.title}</h3>
            <p>{bento.crypto.line}</p>
            <CryptoSparks />
          </Link>
          <Link href="/trade#ZEC" className="lp-tile lp-tile--wide">
            <span className="lp-eyebrow">{bento.zcash.eyebrow}</span>
            <h3>{bento.zcash.title}</h3>
            <p>{bento.zcash.line}</p>
            <div className="mt-auto">
              <SparkRow symbol="ZEC" stream="ZEC-USD" />
            </div>
          </Link>
          <Tile
            href="/games/range"
            icon={<AlignVerticalSpaceAround />}
            title={bento.range.title}
            line={bento.range.line}
          />
          <Tile href={START} icon={<Layers />} title={bento.parlay.title} line={bento.parlay.line} />
          <Tile href="/games" icon={<Gamepad2 />} title={bento.games.title} line={bento.games.line}>
            {SHIPPED.arcade ? null : <span className="lp-sticker">{bento.soon}</span>}
          </Tile>
          <Tile href="/games" icon={<Swords />} title={bento.duel.title} line={bento.duel.line}>
            {SHIPPED.duel ? null : <span className="lp-sticker">{bento.soon}</span>}
          </Tile>
          <Link href="/privacy" className="lp-tile lp-tile--wide">
            <span className="lp-tile-icon">
              <EyeOff aria-hidden />
            </span>
            <span className="lp-eyebrow mt-2">{bento.private.eyebrow}</span>
            <h3>{bento.private.title}</h3>
            <p>{bento.private.line}</p>
          </Link>
        </div>
      </div>
    </section>
  );
}

function Tile({
  href,
  icon,
  title,
  line,
  children,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  line: string;
  children?: ReactNode;
}) {
  return (
    <Link href={href} className="lp-tile">
      <span className="lp-tile-icon" aria-hidden>
        {icon}
      </span>
      <h3 className="mt-auto">{title}</h3>
      <p>{line}</p>
      {children}
    </Link>
  );
}
