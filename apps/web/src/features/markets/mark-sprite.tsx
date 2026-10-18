import { MARK_SPRITE } from "./mark-sprite.generated";

/**
 * Every asset mark as one inline sprite, written into each page by the root layout (O7). A server component: the
 * markup is in the HTML (about 2.5 KB gzipped), not in any script, and no page ever requests a mark file.
 * Sized to nothing rather than `display: none`, which would stop the marks' clip paths from rendering in `<use>`.
 */
export function MarkSprite() {
  return (
    <svg
      aria-hidden
      width="0"
      height="0"
      className="pointer-events-none absolute overflow-hidden"
      // A build-time constant from scripts/marks.mjs (vendored SVG, no user input).
      dangerouslySetInnerHTML={{ __html: MARK_SPRITE }}
    />
  );
}
