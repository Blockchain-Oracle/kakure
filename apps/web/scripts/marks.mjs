/**
 * Vendors the real asset marks into public/marks/ so the site never fetches a logo from a third party (D10, R4).
 *
 * - Crypto: @web3icons/core (MIT), the "background" variant (the brand's own disc), clipped round by the UI.
 * - Stocks: simple-icons (CC0-1.0 icon data; the marks remain their owners' trademarks), drawn white on the
 *   brand's own hex. ETFs (SPY, QQQ) have no mark and use the labelled neutral disc instead.
 *
 * Run `pnpm --filter @kakure/web marks` after changing the lists; the output is committed.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MODULES = fileURLToPath(new URL("../node_modules/", import.meta.url));
const OUT = new URL("../public/marks/", import.meta.url);

const CRYPTO = { BTC: "Bitcoin", ETH: "Ethereum", SOL: "Solana", ZEC: "Zcash", XRP: "XRP", DOGE: "Dogecoin" };
const STOCKS = { AAPL: "apple", TSLA: "tesla", NVDA: "nvidia" };
const GLYPH_SCALE = 0.58;
const VIEWBOX = 24;

mkdirSync(OUT, { recursive: true });

const web3icons = join(MODULES, "@web3icons/core");
for (const [symbol, title] of Object.entries(CRYPTO)) {
  const module = readFileSync(join(web3icons, "dist/svgs/tokens/background", `${symbol}.svg.js`), "utf8");
  const svg = /'(<svg[\s\S]*<\/svg>)\\n'/.exec(module)?.[1];
  if (!svg) throw new Error(`No SVG in web3icons ${symbol}`);
  const clean = svg
    .replaceAll("\\n", "\n")
    .replace(' class="web3icons"', "")
    .replace(/(<svg[^>]*>)/, `$1<title>${title}</title>`);
  writeFileSync(new URL(`${symbol.toLowerCase()}.svg`, OUT), `${clean}\n`);
}

const simpleIcons = join(MODULES, "simple-icons");
const data = JSON.parse(readFileSync(join(simpleIcons, "data/simple-icons.json"), "utf8"));
for (const [symbol, slug] of Object.entries(STOCKS)) {
  const icon = readFileSync(join(simpleIcons, "icons", `${slug}.svg`), "utf8");
  const path = /<path d="([^"]+)"/.exec(icon)?.[1];
  const entry = (Array.isArray(data) ? data : data.icons).find(
    (item) => (item.slug ?? item.title.toLowerCase()) === slug,
  );
  if (!path || !entry) throw new Error(`No simple-icons data for ${slug}`);
  const offset = ((VIEWBOX * (1 - GLYPH_SCALE)) / 2).toFixed(2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><title>${entry.title}</title><rect width="24" height="24" fill="#${entry.hex}"/><path fill="#fff" transform="translate(${offset} ${offset}) scale(${GLYPH_SCALE})" d="${path}"/></svg>\n`;
  writeFileSync(new URL(`${symbol.toLowerCase()}.svg`, OUT), svg);
}

console.log(
  `marks: ${Object.keys(CRYPTO).length} crypto + ${Object.keys(STOCKS).length} stock marks written to public/marks/`,
);
