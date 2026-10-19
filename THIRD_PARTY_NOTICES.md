# Third-party notices

Kakure's own code is MIT licensed (see `LICENSE`). This file lists the third-party components, assets and fonts
it adapts or ships, with their sources and licences. Each adapted file also names its source in its header comment.

## UI components from the 21st.dev catalog (`packages/ui-web`)

Pulled with the official `21st` CLI (`21st get <id>`, signed-in paid plan) on 2026-10-17 and rewritten for Kakure:
Kawase's tokens, fills instead of borders, no gradients or glow, CSS springs instead of `framer-motion`/`motion`,
no Radix/Base UI/Tabler dependencies. None of the components states a licence of its own; they are used under the
[21st.dev Terms](https://21st.dev/terms), which keep ownership with each author ("the sole and exclusive property
of their respective authors and 21st Labs Inc."). Credit goes to the authors below.

| Kakure file | 21st.dev component (author/slug, id) | What was kept |
| --- | --- | --- |
| `segmented-control.tsx` | ddoemonn/segmented-control (#23552) | Radio group, sliding thumb with masked labels, the 520/34/0.45 spring, arrow/Home/End keys |
| `tabs.tsx` | chetanverma16/animated-tabs (#525) | One pill sliding to the active tab |
| `chips.tsx` | ddoemonn/filter-grid (#23525), preetsuthar17/selector-chips (#1963) | Filter chips with per-filter counts |
| `pill.tsx` | haydenbleasel/pill (#1600) | Capsule with a status indicator |
| `partition-bar.tsx` | 8starlabs/partition-bar (#26545) | Proportional segments with a title and value under each |
| `timeline.tsx` | preetsuthar17/timeline (#5157) | Vertical steps with status markers |
| `empty-state.tsx` | serafimcloud/empty-state (#1435) | Icon, title, description and one action |
| `skeleton.tsx` | anurag-mishra22/animated-loading-skeleton (#54) | Pulsing placeholder blocks |
| `slide-to-confirm.tsx` | reuno-ui/slide-button (#3124) | Drag-to-commit knob with a fill and a spring back |
| `search-field.tsx` | jolbol1/searchfield (#1469) | Search input with a glyph and a clear button |
| `sheet.tsx` | wensity/drawer (#31360) | Bottom sheet / side drawer with a scrim (rebuilt on the native `<dialog>`) |
| `apps/web/src/features/markets/market-card.tsx` | isaiahbjork/prediction-market-card (#2537) | Mark, question, countdown and two-sided bar on one card |
| `dotted-qr.tsx` | tom_ui/qr-code (#12248) | Rounded finder patterns and dot modules (matrix from `uqr` instead of `qrcode`) |
| `ticket-stub.tsx` | ravikatiyar162/ticket-confirmation-card (#6492) | Perforated stub with side notches in the ground colour |
| `switch.tsx` | serafimcloud/switch (#21948) | A spring-eased switch thumb (native button instead of Base UI) |
| `glow-toggle.tsx` | daiwiikharihar/cinematic-glow-toggle (#9705) | The labelled switch, inset track, glossy thumb, its 500 / 30 spring and the glowing ON label; recoloured to vermilion (the network switch, the app's one sanctioned glow) |

**R1 revamp (2026-10-19).** `glow-toggle.tsx` was installed with `21st add daiwiikharihar/cinematic-glow-toggle`
(signed-in paid plan; the CLI runs `npx shadcn@latest add` against the 21st registry, which wrote
`components/ui/cinematic-glow-toggle.tsx` and added `framer-motion` in a scratch project), then reskinned into the kit
with Mitoshi's tokens: `framer-motion` replaced by CSS transitions on the token spring, a native `role="switch"`
button, the emerald glow made vermilion. The app shell's rail and dock are now written for Kakure in
`apps/web/src/features/shell` after Mitoshi's shell (values and behaviour only; see "Design
values"), so the kit's `rail.tsx` and `dock.tsx` (from wensity/sidebar #31454, unlumen/sidebar-001 #21517 and
arunachalam/bottom-nav-bar #8343) were removed.

The countdown on cards and the detail page uses plain tabular digits; reuno-ui/countdown-number (#4409) was the
reference, but its NumberFlow/motion dependencies were left out to stay within the JS budget.

## Libraries added in S04 part 2

| Package | Where | Licence |
| --- | --- | --- |
| [uqr](https://github.com/unjs/uqr) 0.1.3 | QR matrices (bet QR, market link, receipts, download) | MIT |
| [zcash_address](https://github.com/zcash/librustzcash) =0.14.0-pre.2, zcash_protocol =0.11.0-pre.1 | `packages/zaddr-wasm`, compiled to WebAssembly | MIT OR Apache-2.0 |
| [wasm-bindgen](https://github.com/wasm-bindgen/wasm-bindgen) 0.2.129 | `packages/zaddr-wasm` bindings | MIT OR Apache-2.0 |

## Libraries added in the real-time revamp (plan §00)

| Package | Where | Licence |
| --- | --- | --- |
| [ohttp](https://github.com/martinthomson/ohttp) 0.8.0 (features `server`, `rust-hpke`) | The operator's Oblivious HTTP gateway (`services/operator/src/gateway.rs`) | MIT OR Apache-2.0 |
| [bhttp](https://github.com/martinthomson/ohttp) 0.8.0 | Binary HTTP inside the gateway | MIT OR Apache-2.0 |
| [axum](https://github.com/tokio-rs/axum) 0.8 | The gateway's HTTP server (already in the tree through tonic) | MIT |
| [ohttp-ts](https://github.com/thibmeu/ohttp-ts) 0.6.1 | The browser's Oblivious HTTP client (`packages/ohttp`) | MIT |
| [hpke](https://github.com/panva/hpke) 1.1.7 | HPKE for that client (X25519, HKDF-SHA256, AES-128-GCM via WebCrypto) | MIT |

Sounds are synthesised at runtime from code (`packages/sounds`); no audio file ships.

## Docs site (`apps/docs`)

| Package | Where | Licence |
| --- | --- | --- |
| [Fumadocs](https://github.com/fuma-nama/fumadocs) (fumadocs-core 16.17.5, fumadocs-ui 16.17.5, fumadocs-mdx 15.4.7) | Layout, MDX pipeline, static search | MIT |
| [zbsearch](https://github.com/micheleriva/zbsearch) 4.0.1 | The search engine behind Fumadocs' static index (dependency of fumadocs-core) | Apache-2.0 |
| [Mermaid](https://github.com/mermaid-js/mermaid) 12.2.0 | System maps, rendered in the browser | MIT |
| [next-themes](https://github.com/pacocoursey/next-themes) 0.4.6 | Light and dark theme switch | MIT |

## Asset marks (`apps/web/src/features/markets/mark-sprite.generated.ts`, generated by `apps/web/scripts/marks.mjs`)

Vendored into the site as one inline SVG sprite in every page, so showing a logo makes no request at all.

| Marks | Source | Licence |
| --- | --- | --- |
| BTC, ETH, SOL, ZEC, XRP | [@web3icons/core](https://github.com/0xa3k5/web3icons) 4.0.58, "background" variants | MIT (© 0xa3k5 and contributors) |
| DOGE (Dogecoin), AAPL (Apple), TSLA (Tesla), NVDA (NVIDIA) | [simple-icons](https://github.com/simple-icons/simple-icons) 16.35.0: Dogecoin's disc in its brand hex on white; the stock logos drawn white on each brand's own hex | Icon data CC0-1.0. The logos are trademarks of their owners; Simple Icons' [disclaimer](https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md) applies. Used only to identify the asset a market is about, with no endorsement implied |

ETFs (SPY, QQQ) and any asset without a mark use a labelled neutral disc, never a stand-in logo.

## Fonts

Sora, Inter and JetBrains Mono are downloaded at build time by `next/font/google` and served from this site (no
runtime request to Google). Noto Serif JP ships as a subset of the four glyphs Kakure uses (隠れ試本, weights 500 and
700, about 2.4 KB each), fetched once from Google Fonts' `css2?text=` endpoint and kept in
`apps/web/src/fonts/noto-serif-jp/` with its `OFL.txt`.

| Font | Where | Licence |
| --- | --- | --- |
| Sora (Jonathan Barnbrook, Julián Moncada) | Web app display face | SIL Open Font License 1.1 ([google/fonts `ofl/sora`](https://github.com/google/fonts/tree/main/ofl/sora)) |
| Inter (Rasmus Andersson) | Web app and docs interface | SIL Open Font License 1.1 ([google/fonts `ofl/inter`](https://github.com/google/fonts/tree/main/ofl/inter)) |
| JetBrains Mono (JetBrains) | Every figure in the web app | SIL Open Font License 1.1 ([google/fonts `ofl/jetbrainsmono`](https://github.com/google/fonts/tree/main/ofl/jetbrainsmono)) |
| Noto Serif JP (Adobe, © 2017-2024) | 隠れ and the network stamps, subset | SIL Open Font License 1.1 (`apps/web/src/fonts/noto-serif-jp/OFL.txt`) |
| Roboto Condensed (Google) | Docs site only, until its restyle (R3) | SIL Open Font License 1.1 ([google/fonts `ofl/robotocondensed`](https://github.com/google/fonts/tree/main/ofl/robotocondensed), `OFL.txt`) |

## Icons

| Package | Licence |
| --- | --- |
| [lucide-react](https://lucide.dev) 1.57.0 | ISC (© Lucide Icons and contributors) |

## Libraries shipped to the browser

Installed from npm and used as published: React and React DOM (MIT), Next.js (MIT), TanStack Query and its
persister core (MIT), zod (MIT), @noble/ed25519 and @noble/hashes (MIT), Tailwind CSS (MIT, build time only).

## Design values

The design tokens in `packages/tokens/tokens.json` (since the R1 revamp, 2026-10-19) and the app shell's geometry are
values re-typed from Mitoshi's design system (`crypto-world-fair`, the reference product studied in
`context/12-reference-products/mitoshi-code-study.md`); no Mitoshi file is copied. They replace the earlier values from
the author's Kawase design system ([Blockchain-Oracle/Kawase](https://github.com/Blockchain-Oracle/Kawase), MIT).
