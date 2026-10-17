/**
 * WCAG 2.x contrast gate. For every theme (light, dark, testnet-light, testnet-dark) and every text pairing
 * listed in tokens.json, it composites translucent colours on the page background and fails the build when
 * any pairing is below the minimum (4.5:1). Exit code 1 on failure.
 */
import { composite, contrastRatio, parseHex, readTokens, resolveThemes, THEME_NAMES } from "./lib.mjs";

const tokens = readTokens();
const themes = resolveThemes(tokens);
const { minimum, text } = tokens.contrast;
const DECIMALS = 2;

const failures = [];
let checked = 0;

for (const name of THEME_NAMES) {
  const theme = themes[name];
  const page = parseHex(theme.background);
  if (page.a !== 1) {
    failures.push(`${name}: background must be opaque`);
    continue;
  }
  for (const [fg, bg] of text) {
    if (!(fg in theme) || !(bg in theme)) {
      failures.push(`${name}: unknown token in pair ${fg} on ${bg}`);
      continue;
    }
    const ground = composite(parseHex(theme[bg]), page);
    const ink = composite(parseHex(theme[fg]), ground);
    const ratio = contrastRatio(ink, ground);
    checked += 1;
    if (ratio < minimum) {
      failures.push(`${name}: ${fg} (${theme[fg]}) on ${bg} (${theme[bg]}) is ${ratio.toFixed(DECIMALS)}:1`);
    }
  }
}

if (failures.length > 0) {
  console.error(`Contrast gate FAILED (minimum ${minimum}:1):`);
  for (const failure of failures) {
    console.error(`  ✗ ${failure}`);
  }
  process.exit(1);
}
console.log(`Contrast gate passed: ${checked} text pairings across ${THEME_NAMES.length} themes are ≥ ${minimum}:1.`);
