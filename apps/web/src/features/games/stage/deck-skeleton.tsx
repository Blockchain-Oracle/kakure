/**
 * The deal's placeholder (Mitoshi `stage/DeckSkeleton.tsx`, from 21st.dev uiable/card-skeleton): the strip's five tiles,
 * a card in the dealt card's bands and the two calls, sized one to one so nothing moves when the cards land.
 */
const TILES = ["a", "b", "c", "d", "e"] as const;

export function DeckSkeleton() {
  return (
    <div className="dsk" aria-hidden>
      <div className="dsk-strip">
        {TILES.map((tile) => (
          <span key={tile} className="dsk-bone dsk-tile" />
        ))}
      </div>
      <div className="dsk-card">
        <span className="dsk-bone dsk-title" />
        <span className="dsk-bone dsk-line" />
        <span className="dsk-bone dsk-quote" />
        <span className="dsk-pills">
          <span className="dsk-bone dsk-pill" />
          <span className="dsk-bone dsk-pill" />
        </span>
      </div>
      <div className="dsk-calls">
        <span className="dsk-bone dsk-call" />
        <span className="dsk-bone dsk-call" />
      </div>
    </div>
  );
}
