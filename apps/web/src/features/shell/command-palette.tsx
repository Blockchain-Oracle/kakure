"use client";

import { Mark, Modal } from "@kakure/ui-web";
import { ArrowUpRight, CornerDownLeft, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, type KeyboardEvent, type ReactNode, useMemo, useState } from "react";
import { DOCS_ORIGIN } from "@/constants";
import { useMarkets } from "@/features/data/use-markets";
import { assetFor } from "@/features/markets/assets";
import { shortTitle, WINDOW_LABEL } from "@/features/markets/market-view";
import { NAV_ICONS } from "./nav-icons";
import { MORE_ITEMS, PLACES } from "./places";
import { setOverlay } from "./shell-store";

interface Hit {
  key: string;
  group: "Markets" | "Pages";
  title: string;
  detail: string;
  href: string;
  external?: boolean | undefined;
  icon: ReactNode;
  words: string;
}

/** How many market rows show before the query narrows them. */
const MARKET_LIMIT = 8;

function usePageHits(): Hit[] {
  return useMemo(
    () =>
      [...PLACES, ...MORE_ITEMS].map((entry) => {
        const Icon = NAV_ICONS[entry.id];
        return {
          key: `page-${entry.id}`,
          group: "Pages" as const,
          title: entry.name,
          detail: entry.description,
          href: entry.external ? DOCS_ORIGIN : entry.href,
          external: entry.external,
          icon: <Icon aria-hidden />,
          words: `${entry.name} ${entry.tile} ${entry.description} ${entry.keywords ?? ""}`.toLowerCase(),
        };
      }),
    [],
  );
}

function useMarketHits(): Hit[] {
  const data = useMarkets();
  return useMemo(() => {
    if (data.status !== "ready") return [];
    return data.bundle.markets.map((market) => {
      const asset = assetFor(market);
      return {
        key: `market-${market.id}`,
        group: "Markets" as const,
        title: shortTitle(market, asset.symbol),
        detail: `${asset.name} · ${WINDOW_LABEL[market.window]}`,
        href: `/m#${data.network}/${market.id}`,
        icon: <Mark mark={asset.mark} label={asset.symbol} size="inline" />,
        words: `${asset.symbol} ${asset.name} ${market.window} ${shortTitle(market, asset.symbol)}`.toLowerCase(),
      };
    });
  }, [data]);
}

/**
 * The ⌘K / `/` palette over markets and pages (Mitoshi TopLine's command palette): type to narrow, arrows to move,
 * Enter to open. Markets come from the signed bundle every page already loads; nothing new is requested.
 */
export function CommandPalette({ open }: { open: boolean }) {
  const router = useRouter();
  const pages = usePageHits();
  const markets = useMarketHits();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (hit: Hit) => q === "" || q.split(/\s+/).every((word) => hit.words.includes(word));
    return [...markets.filter(match).slice(0, MARKET_LIMIT), ...pages.filter(match)];
  }, [query, markets, pages]);

  const close = () => {
    setOverlay(null);
    setQuery("");
    setCursor(0);
  };

  const go = (hit: Hit | undefined) => {
    if (!hit) return;
    close();
    if (hit.external) window.open(hit.href, "_blank", "noopener,noreferrer");
    else router.push(hit.href);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setCursor((current) => (hits.length === 0 ? 0 : (current + step + hits.length) % hits.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(hits[cursor]);
    }
  };

  return (
    <Modal open={open} onClose={close} title="Search markets and pages" hideTitle size="wide">
      <div className="kk-palette">
        <label className="kk-palette-field">
          <Search aria-hidden />
          <input
            // biome-ignore lint/a11y/noAutofocus: the palette exists to be typed into
            autoFocus
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search markets and pages"
            aria-label="Search markets and pages"
            aria-controls="kk-palette-list"
            aria-activedescendant={hits[cursor] ? `kk-hit-${hits[cursor].key}` : undefined}
            autoComplete="off"
          />
          <kbd className="kk-kbd">esc</kbd>
        </label>
        <div id="kk-palette-list" role="listbox" aria-label="Results" className="kk-palette-list">
          {hits.length === 0 ? <p className="kk-palette-empty">Nothing matches “{query}”.</p> : null}
          {hits.map((hit, i) => (
            <Fragment key={hit.key}>
              {i === 0 || hits[i - 1]?.group !== hit.group ? (
                <div role="presentation" className="kk-palette-group">
                  {hit.group}
                </div>
              ) : null}
              <div
                id={`kk-hit-${hit.key}`}
                role="option"
                tabIndex={-1}
                aria-selected={i === cursor}
                className="kk-palette-hit"
                onMouseMove={() => setCursor(i)}
                onClick={() => go(hit)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") go(hit);
                }}
              >
                <span className="kk-palette-icon">{hit.icon}</span>
                <span className="kk-palette-copy">
                  <span className="kk-palette-title">{hit.title}</span>
                  <span className="kk-palette-detail">{hit.detail}</span>
                </span>
                {hit.external ? <ArrowUpRight aria-hidden className="kk-palette-enter" /> : null}
                {i === cursor && !hit.external ? <CornerDownLeft aria-hidden className="kk-palette-enter" /> : null}
              </div>
            </Fragment>
          ))}
        </div>
      </div>
    </Modal>
  );
}
