import { OPERATOR_PUBLIC_KEYS } from "@kakure/query";
import { buttonClass } from "@kakure/ui-web";
import { DottedQr } from "@kakure/ui-web/qr";
import Link from "next/link";
import { DOCS_ORIGIN, FAUCETS, NETWORK_LABEL, REPO_URL, SITE_ORIGIN } from "@/constants";
import { Brand } from "@/features/shell/brand";
import { Section } from "./sections";

/**
 * Docs, download and footer (refero-design-research §3.9; 21st.dev ravikatiyar162/app-download-section and
 * arihantcodes_1f7b8c4d/footer-section, reskinned). The QR points at the download page, which lists only builds
 * that exist. The footer carries the operator keys built into this site.
 */
const GUIDES = [
  { slug: "first-bet", title: "Your first bet in 30 seconds", body: "From Zingo or Zodl by QR, step by step." },
  { slug: "wallet-and-ironwood", title: "Your wallet and Ironwood", body: "Why funds must sit in Ironwood first." },
  { slug: "privacy", title: "The privacy model", body: "The promise, who sees what, and what leaks." },
  { slug: "rules", title: "Rules and formulas", body: "Payouts, the fee, the cutoff block and refunds." },
  { slug: "receipts-and-backup", title: "Receipts and backup", body: "Export, import and Forget this device." },
  { slug: "troubleshooting", title: "Troubleshooting", body: "When a ticket isn't counted, and what to check." },
];
const QR_SIZE = 132;
const KEY_HEAD = 12;
const KEY_TAIL = 12;

export function GetStarted() {
  return (
    <Section id="start" title="Start here">
      <div className="grid grid-cols-1 gap-4 wide:grid-cols-[minmax(0,1fr)_24rem]">
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {GUIDES.map((guide) => (
            <li key={guide.slug}>
              <a
                href={`${DOCS_ORIGIN}/${guide.slug}`}
                className="flex h-full flex-col gap-1 rounded-group bg-card p-5 outline-none hover:bg-row-pressed focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="text-row-title text-foreground">{guide.title}</span>
                <span className="text-row-detail text-muted-foreground">{guide.body}</span>
              </a>
            </li>
          ))}
        </ul>
        <aside className="flex flex-col gap-4 rounded-group bg-card p-5" aria-label="Get the app">
          <h3 className="text-title text-foreground">Kakure on your phone</h3>
          <div className="flex items-center gap-4">
            <div className="shrink-0 rounded-md bg-paper p-2">
              <DottedQr value={`${SITE_ORIGIN}/download`} size={QR_SIZE} label="Link to the download page" />
            </div>
            <p className="text-row-detail text-muted-foreground">
              The Android APK and the iPhone TestFlight build are listed on the download page as soon as each one is
              published. Until then, bet from the web with your own wallet.
            </p>
          </div>
          <Link href="/download" className={buttonClass("secondary", "sm", "w-fit")}>
            Open the download page
          </Link>
          <p className="text-meta text-muted-foreground">
            Testnet coins: get TAZ from{" "}
            {FAUCETS.map((faucet, index) => (
              <span key={faucet.href}>
                {index > 0 ? " or " : ""}
                <a className="text-link underline" href={faucet.href} rel="noreferrer noopener" target="_blank">
                  {faucet.name}
                </a>
              </span>
            ))}
            .
          </p>
        </aside>
      </div>
    </Section>
  );
}

export function LandingFooter() {
  return (
    <footer className="mt-24 bg-card">
      <div className="mx-auto grid w-full max-w-(--layout-content-max) grid-cols-1 gap-8 px-5 py-10 rail:px-8 md:grid-cols-[1fr_auto_auto_auto]">
        <div className="flex flex-col gap-3">
          <Brand />
          <p className="max-w-sm text-row-detail text-muted-foreground">
            A private prediction market on Zcash. No accounts, no analytics, no cookies. Testnet TAZ has no value.
          </p>
        </div>
        <FooterColumn
          title="Product"
          links={[
            ["/markets", "Markets"],
            ["/portfolio", "Portfolio"],
            ["/verify", "Verify"],
            ["/proof", "Proof"],
          ]}
        />
        <FooterColumn
          title="Learn"
          links={[
            ["/privacy", "How privacy works"],
            [DOCS_ORIGIN, "Docs"],
            [REPO_URL, "Source code"],
          ]}
        />
        <FooterColumn
          title="App"
          links={[
            ["/download", "Get the app"],
            ["/settings", "Settings"],
          ]}
        />
      </div>
      <div className="mx-auto w-full max-w-(--layout-content-max) px-5 pb-10 rail:px-8">
        <dl className="flex flex-col gap-1 rounded-group bg-raised-2 p-4 text-meta text-muted-foreground">
          <dt className="text-label">Operator keys built into this site</dt>
          {(Object.keys(OPERATOR_PUBLIC_KEYS) as Array<keyof typeof OPERATOR_PUBLIC_KEYS>).map((network) => {
            const key = OPERATOR_PUBLIC_KEYS[network];
            return (
              <dd key={network} className="break-all tabular-nums">
                {NETWORK_LABEL[network]}: {key ? `${key.slice(0, KEY_HEAD)}…${key.slice(-KEY_TAIL)}` : "not set yet"}
              </dd>
            );
          })}
        </dl>
        <p className="mt-4 text-meta text-muted-foreground">MIT licensed. Third-party notices are in the repository.</p>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: ReadonlyArray<readonly [string, string]> }) {
  return (
    <nav aria-label={title} className="flex flex-col gap-2">
      <span className="text-label text-muted-foreground">{title}</span>
      {links.map(([href, label]) => (
        <a
          key={href}
          href={href}
          className="rounded-xs text-row-detail text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
