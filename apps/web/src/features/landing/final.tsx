import { OPERATOR_PUBLIC_KEYS } from "@kakure/query";
import { DottedQr } from "@kakure/ui-web/qr";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { DOCS_ORIGIN, NETWORK_LABEL, REPO_URL, SITE_ORIGIN } from "@/constants";
import { Brand } from "@/features/shell/brand";
import { START, WORDS } from "./words";

/**
 * The final call and the footer (Mitoshi's LandingEnd): the one action and a QR to the download page, then the
 * columns, the operator keys built into this site, and the outlined 隠れ watermark. Server components.
 */
const QR_SIZE = 120;
const KEY_HEAD = 12;
const KEY_TAIL = 12;

export function FinalCall() {
  const { final } = WORDS;
  return (
    <section className="lp-section lp-final" aria-labelledby="lp-final-title">
      <div className="lp-wrap flex flex-col items-center gap-6">
        <h2 id="lp-final-title" className="lp-h2 lp-silver items-center">
          <span>{final.title[0]}</span>
          <span>
            <em>{final.title[1]}</em>
          </span>
        </h2>
        <p className="lp-lead -mt-2">{final.line}</p>
        <div className="flex flex-wrap items-center justify-center gap-6">
          <Link href={START} className="lp-btn lp-btn--accent lp-btn--lg">
            {final.start} <ArrowRight aria-hidden />
          </Link>
          <figure className="flex items-center gap-3 text-left">
            <span className="lp-qr">
              <DottedQr value={`${SITE_ORIGIN}/download`} size={QR_SIZE} label={final.qr} />
            </span>
            <figcaption className="max-w-[9rem] text-meta text-muted-foreground">{final.scan}</figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}

const COLUMNS: ReadonlyArray<{ title: string; links: ReadonlyArray<readonly [string, string]> }> = [
  {
    title: "Product",
    links: [
      [START, "Trade"],
      ["/markets", "Markets"],
      ["/portfolio", "Portfolio"],
      ["/games", "Games"],
    ],
  },
  {
    title: "Proof",
    links: [
      ["/privacy", "How privacy works"],
      ["/proof", "Signed files"],
      ["/verify", "Verify a ticket"],
      ["/status", "Status"],
    ],
  },
  {
    title: "Learn",
    links: [
      [DOCS_ORIGIN, "Docs"],
      [REPO_URL, "Source code"],
      ["/download", "Download"],
      ["/settings", "Settings"],
    ],
  },
];

export function LandingFooter() {
  const { footer } = WORDS;
  return (
    <footer className="lp-footer">
      <div className="lp-wrap">
        <div className="lp-footer-cols">
          <div className="flex flex-col gap-4">
            <Brand />
            <p className="font-display text-[18px] font-bold tracking-[-0.02em]">{footer.tagline}</p>
            <p className="max-w-sm text-row-detail text-muted-foreground">{footer.built}</p>
          </div>
          {COLUMNS.map((column) => (
            <nav key={column.title} aria-label={column.title} className="flex flex-col gap-2">
              <h4>{column.title}</h4>
              {column.links.map(([href, label]) => (
                <a key={href} href={href} className="lp-link w-fit">
                  {label}
                </a>
              ))}
            </nav>
          ))}
        </div>
        <dl className="mt-10 flex flex-col gap-1 font-mono text-[12px] text-muted-foreground">
          <dt className="font-sans font-semibold">{footer.keys}</dt>
          {(Object.keys(OPERATOR_PUBLIC_KEYS) as Array<keyof typeof OPERATOR_PUBLIC_KEYS>).map((network) => {
            const key = OPERATOR_PUBLIC_KEYS[network];
            return (
              <dd key={network} className="break-all">
                {NETWORK_LABEL[network]}: {key ? `${key.slice(0, KEY_HEAD)}…${key.slice(-KEY_TAIL)}` : footer.notSet}
              </dd>
            );
          })}
        </dl>
        <p className="mt-4 text-meta text-muted-foreground">{footer.license}</p>
      </div>
      <span className="lp-watermark" aria-hidden lang="ja">
        隠れ
      </span>
    </footer>
  );
}
