import { buttonClass } from "@kakure/ui-web";
import Link from "next/link";
import { DOCS_ORIGIN } from "@/constants";

/**
 * `/demo` (README's play button): the recorded product walkthrough, served from this site so watching it loads no third
 * party. When the owner publishes it on YouTube too, that's a plain link out, never an embed. Until the recording
 * exists the page says so plainly, under the cover artwork without its play button (`public/demo/still.webp`, made
 * from unchanged app screens; `.github/assets/provenance.json`), so nothing here looks playable that isn't.
 */
const DEMO = {
  /** The walkthrough and its English captions, as files under `public/demo/`; null until it's recorded. */
  video: null as string | null,
  captions: null as string | null,
  /** The same film on YouTube, when the owner publishes it there. */
  youtube: null as string | null,
};

export function DemoScreen() {
  return (
    <div className="mx-auto flex w-full max-w-(--layout-reading-max) flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-page-title text-foreground">Demo</h1>
        <p className="text-body text-muted-foreground">
          A deposit, a trade and its settlement on Zcash testnet, recorded from this app.
        </p>
      </header>
      {DEMO.video && DEMO.captions ? (
        <video
          src={DEMO.video}
          poster="/demo/cover.webp"
          controls
          playsInline
          preload="metadata"
          className="w-full rounded-group border border-border bg-black"
        >
          <track kind="captions" src={DEMO.captions} srcLang="en" label="English" default />
        </video>
      ) : (
        <figure className="flex flex-col gap-3">
          <img
            src="/demo/still.webp"
            alt="Kakure's Markets, terminal and positions screens: the demo's cover artwork"
            className="w-full rounded-group border border-border"
          />
          <figcaption className="rounded-row bg-secondary p-3 text-meta text-foreground">
            Recording in progress: the walkthrough plays here once it's recorded. The picture above is cover artwork
            made from unchanged app screens, not a recording.
          </figcaption>
        </figure>
      )}
      {DEMO.youtube ? (
        <a href={DEMO.youtube} rel="noopener noreferrer" target="_blank" className="text-body text-vermilion underline">
          Watch it on YouTube
        </a>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Link href="/trade" className={buttonClass("primary", "sm")}>
          Try it on testnet
        </Link>
        <a href={`${DOCS_ORIGIN}/first-trade`} className={buttonClass("secondary", "sm")}>
          Your first trade, step by step
        </a>
        <Link href="/privacy" className={buttonClass("quiet", "sm")}>
          Who sees what
        </Link>
      </div>
    </div>
  );
}
