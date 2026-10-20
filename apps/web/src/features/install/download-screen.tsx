import { DottedQr } from "@kakure/ui-web/qr";
import { Globe } from "lucide-react";
import type { ReactNode } from "react";
import { SITE_ORIGIN } from "@/constants";
import { Phone } from "@/features/landing/phone";
import { BrandDisc } from "@/features/shell/brand";
import { AndroidGlyph, AppleGlyph } from "./glyphs";
import { InstallCta } from "./install-cta";
import { DOWNLOAD } from "./words";

/**
 * `/download` (Mitoshi `features/install/DownloadPage.tsx`, `PlatformCard.tsx`; Owarine's `/download`): a band with the
 * title and, for a desktop reader, a QR, beside three real captures of the app fanned; then one card per way in
 * (21st.dev 18105 shadcnspace/download-01's anatomy as Mitoshi reskins it: icon tile, status chip, name over one line,
 * one action). The web app is the one that works today, so it leads, wide, with the page's one accent action. Android
 * is paused (plan §00: the APK was built for the pool markets) and there is no iPhone app, so those cards carry no
 * button at all. Server component; only the install action runs script.
 */
const QR_SIZE = 112;
const HERO_QR_SIZE = 104;

const SHOTS = [
  { name: "markets", side: "l" },
  { name: "trade", side: "c" },
  { name: "positions", side: "r" },
] as const;

type Tone = "live" | "soon";

interface CardProps {
  id: "web" | "android" | "ios";
  name: string;
  glyph: ReactNode;
  chip: string;
  tone: Tone;
  line: string;
  action?: ReactNode;
  qr?: { value: string; caption: string };
}

function PlatformCard({ id, name, glyph, chip, tone, line, action, qr }: CardProps) {
  return (
    <article id={id} className="get-card" aria-labelledby={`get-${id}-name`}>
      <div className="get-card-top">
        <span className="get-card-icon">{glyph}</span>
        <span className="get-chip" data-tone={tone}>
          {chip}
        </span>
      </div>
      <div className="get-card-copy">
        <h2 id={`get-${id}-name`} className="get-card-name">
          {name}
        </h2>
        <p className="get-card-line">{line}</p>
      </div>
      {action || qr ? (
        <div className="get-card-foot">
          {action ? <div className="get-card-action">{action}</div> : null}
          {qr ? (
            <figure className="get-qr">
              <span className="get-qr-plate">
                <DottedQr value={qr.value} size={QR_SIZE} label={DOWNLOAD.qrLabel(qr.caption)} />
              </span>
              <figcaption className="get-qr-caption">{qr.caption}</figcaption>
            </figure>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function DownloadScreen() {
  const install = `${SITE_ORIGIN}/download`;
  return (
    <div className="get">
      <header className="get-hero">
        <div className="get-hero-copy">
          <BrandDisc />
          <h1 className="get-title">
            {DOWNLOAD.heading.lead}
            <em>{DOWNLOAD.heading.em}</em>
          </h1>
          <p className="get-line">{DOWNLOAD.line}</p>
          <figure className="get-hero-qr">
            <span className="get-qr-plate">
              <DottedQr value={install} size={HERO_QR_SIZE} label={DOWNLOAD.qrLabel(DOWNLOAD.heroScan)} />
            </span>
            <figcaption>{DOWNLOAD.heroScan}</figcaption>
          </figure>
        </div>
        <div className="get-phones" aria-hidden>
          {SHOTS.map((shot) => (
            <div key={shot.name} className="get-phone" data-side={shot.side}>
              <Phone shot={shot.name} place={`get-${shot.side}`} eager={shot.side === "c"} />
            </div>
          ))}
        </div>
      </header>
      <div className="get-grid">
        <PlatformCard
          id="web"
          name={DOWNLOAD.web.name}
          glyph={<Globe aria-hidden />}
          chip={DOWNLOAD.web.chip}
          tone="live"
          line={DOWNLOAD.web.line}
          action={<InstallCta primary />}
          qr={{ value: install, caption: DOWNLOAD.web.scan }}
        />
        <PlatformCard
          id="android"
          name={DOWNLOAD.android.name}
          glyph={<AndroidGlyph />}
          chip={DOWNLOAD.android.chip}
          tone="soon"
          line={DOWNLOAD.android.line}
        />
        <PlatformCard
          id="ios"
          name={DOWNLOAD.ios.name}
          glyph={<AppleGlyph />}
          chip={DOWNLOAD.ios.chip}
          tone="soon"
          line={DOWNLOAD.ios.line}
        />
      </div>
    </div>
  );
}
