import { buttonClass } from "@kakure/ui-web";
import { DottedQr } from "@kakure/ui-web/qr";
import { RELEASES } from "@/constants";

/**
 * Download (surfaces.md): the Android APK from the public repo's GitHub Releases (tags `android-*`), read once when
 * this page is built, so a visitor's browser never calls GitHub. A QR to the APK for phones. TestFlight comes later.
 */
interface Release {
  tag: string;
  publishedAt: string;
  apk: { name: string; url: string; size: number };
  sha256: string | null;
  page: string;
}

interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GitHubRelease {
  tag_name: string;
  draft: boolean;
  published_at: string;
  html_url: string;
  assets: GitHubAsset[];
}

const API = `https://api.github.com/repos/${RELEASES.repo}/releases?per_page=30`;
const RELEASES_PAGE = `https://github.com/${RELEASES.repo}/releases`;
const BYTES_PER_MB = 1_048_576;
const SHA256_HEX = /\b[0-9a-f]{64}\b/;
const QR_SIZE = 168;

async function latestAndroid(): Promise<Release | null | "unreachable"> {
  try {
    const headers: Record<string, string> = { accept: "application/vnd.github+json" };
    if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const response = await fetch(API, { headers, cache: "force-cache" });
    if (!response.ok) return "unreachable";
    const releases = (await response.json()) as GitHubRelease[];
    for (const release of releases) {
      if (release.draft || !release.tag_name.startsWith(RELEASES.tagPrefix)) continue;
      const apk = release.assets.find((asset) => asset.name.endsWith(".apk"));
      if (!apk) continue;
      const sumAsset = release.assets.find(
        (asset) => asset.name === `${apk.name}.sha256` || asset.name.endsWith(".sha256"),
      );
      let sha256: string | null = null;
      if (sumAsset) {
        const sum = await fetch(sumAsset.browser_download_url, { cache: "force-cache" });
        sha256 = sum.ok ? (SHA256_HEX.exec(await sum.text())?.[0] ?? null) : null;
      }
      return {
        tag: release.tag_name,
        publishedAt: release.published_at,
        apk: { name: apk.name, url: apk.browser_download_url, size: apk.size },
        sha256,
        page: release.html_url,
      };
    }
    return null;
  } catch {
    return "unreachable";
  }
}

export async function DownloadScreen() {
  const release = await latestAndroid();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-5 py-6 rail:px-8 rail:py-8">
      <h1 className="font-display text-page-title text-foreground">Get the app</h1>
      <section className="flex flex-col gap-4 rounded-group bg-card p-5" aria-labelledby="android-title">
        <h2 id="android-title" className="text-title text-foreground">
          Android
        </h2>
        {release === "unreachable" ? (
          <p className="text-body text-muted-foreground">
            GitHub couldn't be reached when this page was built, so there's no link here. The builds are on the{" "}
            <a className="text-link underline" href={RELEASES_PAGE}>
              releases page
            </a>
            .
          </p>
        ) : release === null ? (
          <p className="text-body text-muted-foreground">
            No Android build is published yet. Each push to main will put an APK on the{" "}
            <a className="text-link underline" href={RELEASES_PAGE}>
              releases page
            </a>{" "}
            and here.
          </p>
        ) : (
          <div className="flex flex-col gap-5 md:flex-row md:items-center">
            <div className="shrink-0 self-start rounded-md bg-paper p-3">
              <DottedQr value={release.apk.url} size={QR_SIZE} label="Download link for the Android app" />
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <p className="text-body text-foreground">
                The APK, straight to your phone: scan the code, or download it here. Android asks you to allow installs
                from your browser once.
              </p>
              <a href={release.apk.url} className={buttonClass("primary", "md", "w-fit")}>
                Download {release.apk.name} ({(release.apk.size / BYTES_PER_MB).toFixed(1)} MB)
              </a>
              <dl className="text-row-detail text-muted-foreground">
                <div>
                  <dt className="inline">Build: </dt>
                  <dd className="inline">
                    <a className="text-link underline" href={release.page}>
                      {release.tag}
                    </a>
                  </dd>
                </div>
                <div className="break-all">
                  <dt className="inline">SHA-256: </dt>
                  <dd className="inline tabular-nums">{release.sha256 ?? "not published with this build"}</dd>
                </div>
              </dl>
            </div>
          </div>
        )}
      </section>
      <section className="rounded-group bg-card p-5" aria-labelledby="ios-title">
        <h2 id="ios-title" className="text-title text-foreground">
          iPhone
        </h2>
        <p className="mt-2 text-body text-muted-foreground">
          A TestFlight build is on its way through Apple's review. Until it's open, iPhone users can bet from the web
          with Zodl or Zingo.
        </p>
      </section>
    </div>
  );
}
