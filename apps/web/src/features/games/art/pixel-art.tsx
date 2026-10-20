/**
 * The games' arts, drawn here as pixel grids and painted with the design system's own tokens — so they
 * are ours (Flicky's and Pips's PNGs carry no license), they flip with the theme, and no hex reaches
 * TSX. The compositions are the references': a bull for UP and a bear for DOWN that react to the swipe,
 * a coin at rest, a card back that peeks behind the deck, the searching banner, the locked-in mark.
 * `shape-rendering: crispEdges` keeps every pixel square at any size.
 */
type Palette = Readonly<Record<string, string>>;

function Pixels({
  rows,
  palette,
  className,
  title,
}: {
  rows: readonly string[];
  palette: Palette;
  className?: string | undefined;
  title?: string | undefined;
}) {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const rects: { x: number; y: number; fill: string }[] = [];
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const fill = palette[ch];
      if (fill) rects.push({ x, y, fill });
    });
  });
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={1} height={1} fill={r.fill} />
      ))}
    </svg>
  );
}

const INK = "var(--canvas)";
const WHITE = "var(--foreground)";
const UP = "var(--up)";
const DOWN = "var(--down)";
const VERM = "var(--vermilion)";
const SOFT = "color-mix(in srgb, var(--foreground) 35%, transparent)";

/** The bull: horns up, the UP colour. Reacts to an upward lean. */
export function BullMark({ className }: { className?: string }) {
  return (
    <Pixels
      className={className}
      palette={{ G: UP, W: WHITE, K: INK }}
      rows={[
        "....W......W....",
        "....WW....WW....",
        ".....GGGGGG.....",
        "....GGGGGGGG....",
        "...GGKGGGGKGGG..",
        "...GGGGGGGGGGG..",
        "..GGGGGGGGGGGG..",
        "..GGGGGWWGGGGG..",
        "..GGGGGWWGGGGG..",
        "...GGGGGGGGGG...",
        "....GGGGGGGG....",
        ".....GG..GG.....",
        ".....GG..GG.....",
        "................",
      ]}
    />
  );
}

/** The bear: round ears, the DOWN colour. Reacts to a downward lean. */
export function BearMark({ className }: { className?: string }) {
  return (
    <Pixels
      className={className}
      palette={{ R: DOWN, W: WHITE, K: INK }}
      rows={[
        "..RR........RR..",
        ".RRRR......RRRR.",
        ".RRRRRRRRRRRRRR.",
        "..RRRRRRRRRRRR..",
        "..RRKRRRRRRKRR..",
        "..RRRRRRRRRRRR..",
        "..RRRRRWWWRRRR..",
        "..RRRRRWKWRRRR..",
        "...RRRRRWRRRR...",
        "....RRRRRRRR....",
        ".....RR..RR.....",
        ".....RR..RR.....",
        "................",
      ]}
    />
  );
}

/** The coin at rest: the brand's one spark of colour, with a glint. */
export function CoinMark({ className }: { className?: string }) {
  return (
    <Pixels
      className={className}
      palette={{ V: VERM, W: WHITE, K: INK }}
      rows={[
        ".....VVVVVV.....",
        "...VVVVVVVVVV...",
        "..VVWWVVVVVVVV..",
        ".VVWVVVVVVVVVVV.",
        ".VVVVVVKKVVVVVV.",
        "VVVVVVKKKKVVVVVV",
        "VVVVVKKVVKKVVVVV",
        "VVVVVKKVVKKVVVVV",
        "VVVVVKKVVKKVVVVV",
        "VVVVVVKKKKVVVVVV",
        ".VVVVVVKKVVVVVV.",
        ".VVVVVVVVVVVVVV.",
        "..VVVVVVVVVVVV..",
        "...VVVVVVVVVV...",
        ".....VVVVVV.....",
      ]}
    />
  );
}

/** The card back: a bordered plate with the mark in the middle, what peeks behind the deck. */
export function CardBack({ className }: { className?: string }) {
  return (
    <Pixels
      className={className}
      palette={{ B: SOFT, V: VERM, W: WHITE }}
      rows={[
        "BBBBBBBBBBBBBBBB",
        "B..............B",
        "B.B..........B.B",
        "B..............B",
        "B......VV......B",
        "B.....VVVV.....B",
        "B....VVWWVV....B",
        "B...VVVWWVVV...B",
        "B...VVVWWVVV...B",
        "B....VVWWVV....B",
        "B.....VVVV.....B",
        "B......VV......B",
        "B..............B",
        "B.B..........B.B",
        "B..............B",
        "BBBBBBBBBBBBBBBB",
      ]}
    />
  );
}

/** The searching banner: a bull and a bear, and the question between them. */
export function SearchingBanner({ className }: { className?: string }) {
  return (
    <Pixels
      className={className}
      title="searching for a duelist"
      palette={{ G: UP, R: DOWN, V: VERM, W: WHITE, K: INK }}
      rows={[
        ".W....W..............VVVV...............RR......RR..",
        ".WW..WW.............VV..VV..............RRRR..RRRR..",
        "..GGGGGG................VV..............RRRRRRRRRR..",
        ".GGGGGGGG..............VV................RRRRRRRR...",
        ".GGKGGGKG.............VV.................RRKRRRKR...",
        ".GGGGGGGG.............VV.................RRRRRRRR...",
        ".GGGGWWGG.................................RRRWWWRR...",
        "..GGGGGG..............VV..................RRRWKWRR...",
        "...GG.GG..............VV...................RRRRRR....",
        "....................................................",
      ]}
    />
  );
}

/** The locked-in mark: a padlock, closed, in the brand's colour. */
export function LockedInMark({ className }: { className?: string }) {
  return (
    <Pixels
      className={className}
      palette={{ V: VERM, K: INK }}
      rows={[
        "....VVVV....",
        "...VV..VV...",
        "...VV..VV...",
        "...VV..VV...",
        ".VVVVVVVVVV.",
        ".VVVVVVVVVV.",
        ".VVVVKKVVVV.",
        ".VVVVKKVVVV.",
        ".VVVVVKVVVV.",
        ".VVVVVVVVVV.",
        ".VVVVVVVVVV.",
        "..VVVVVVVV..",
      ]}
    />
  );
}

/** The season's trophy: a cup in signal with a white gleam, on the same grid as the coin. */
export function TrophyMark({ className }: { className?: string }) {
  return (
    <Pixels
      className={className}
      palette={{ v: VERM, w: WHITE, i: INK, s: SOFT }}
      rows={[
        "..iiiiiiiiii..",
        ".ivvvvvvvvvvi.",
        "iivvwvvvvvvvii",
        "isvvwvvvvvvvsi",
        "isvvvvvvvvvvsi",
        ".iivvvvvvvvii.",
        "..iivvvvvvii..",
        "...iivvvvii...",
        "....iivvii....",
        ".....ivvi.....",
        ".....ivvi.....",
        "....iivvii....",
        "...ivvvvvvi...",
        "..iiiiiiiiii..",
      ]}
    />
  );
}
