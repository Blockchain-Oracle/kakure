import { CAPTURES, type CaptureName } from "./captures";

/**
 * A phone around a real capture of the app (21st.dev solaceui/phone-mockups-1, #20020, installed with `21st add`):
 * its iPhone 15 Pro frame drawn in SVG, the screen clipped to its rounded rect. Reskinned for the landing's dark world:
 * a graphite body with a cream hairline, the screen as a plain lazy `<img>` (the site is a static export, so no
 * next/image), and no carousel controls. Server component: it ships no script.
 */
const VIEW_W = 433;
const VIEW_H = 882;
const SCREEN = { x: 21.25, y: 19.25, w: 389.5, h: 843.5, r: 55.75 };
/** Captures are taken at 390 × 844 CSS px (the screen's own aspect) at 2×. */
const CAPTURE_W = 780;
const CAPTURE_H = 1688;

export function Phone({
  shot,
  place,
  eager = false,
  alt,
}: {
  shot: CaptureName;
  /** Where on the page this phone stands; keeps its clip path's id unique when a capture appears twice. */
  place: string;
  eager?: boolean;
  alt?: string;
}) {
  const capture = CAPTURES[shot];
  const clip = `lp-screen-${place}`;
  return (
    <div className="lp-phone">
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label={alt ?? capture.alt}>
        <path
          d="M2 73C2 32.68 34.68 0 75 0H357C397.32 0 430 32.68 430 73V809C430 849.32 397.32 882 357 882H75C34.68 882 2 849.32 2 809V73Z"
          fill="#2A2A2A"
        />
        <path d="M0 171a1 1 0 0 1 1-1h2v34H1a1 1 0 0 1-1-1Z" fill="#2A2A2A" />
        <path d="M1 234a1 1 0 0 1 1-1h1.5v67H2a1 1 0 0 1-1-1Z" fill="#2A2A2A" />
        <path d="M1 319a1 1 0 0 1 1-1h1.5v67H2a1 1 0 0 1-1-1Z" fill="#2A2A2A" />
        <path d="M430 279h2a1 1 0 0 1 1 1v104a1 1 0 0 1-1 1h-2Z" fill="#2A2A2A" />
        <path
          d="M6 74C6 35.34 37.34 4 76 4H356C394.66 4 426 35.34 426 74V808C426 846.66 394.66 878 356 878H76C37.34 878 6 846.66 6 808V74Z"
          fill="#0B0B0B"
          stroke="rgba(244,238,227,0.18)"
          strokeWidth="1"
        />
        <defs>
          <clipPath id={clip}>
            <rect x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={SCREEN.r} ry={SCREEN.r} />
          </clipPath>
        </defs>
        <rect x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={SCREEN.r} fill="#050505" />
        <foreignObject x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} clipPath={`url(#${clip})`}>
          <img
            src={capture.src}
            alt=""
            width={CAPTURE_W}
            height={CAPTURE_H}
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            style={{ display: "block", width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }}
          />
        </foreignObject>
        <path
          d="M154 48.5C154 38.28 162.28 30 172.5 30H259.5C269.72 30 278 38.28 278 48.5C278 58.72 269.72 67 259.5 67H172.5C162.28 67 154 58.72 154 48.5Z"
          fill="#000"
        />
        <circle cx="259.5" cy="48.5" r="6" fill="#141414" />
      </svg>
    </div>
  );
}
