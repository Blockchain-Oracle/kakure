"use client";

import { Sheet } from "@kakure/ui-web";
import { useModalSfx } from "./audio";
import { type GameId, gameEntry } from "./catalog";
import { GAMES } from "./copy";

/**
 * Each game's HOW TO (Pips, Mitoshi `HowToSheet.tsx`) on Kakure's one sheet (a bottom sheet on phones, a drawer from
 * 768 px): the eyebrow is whose money is at risk, the body three fragments with the proof line last.
 */
export function HowToSheet({ id, open, onClose }: { id: GameId; open: boolean; onClose: () => void }) {
  useModalSfx(open);
  const entry = gameEntry(id);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={entry.name}
      className="gm-sheet"
      footer={
        <button type="button" className="gm-cta w-full" onClick={onClose}>
          {GAMES.howToWords.got}
        </button>
      }
    >
      <p className="gm-howto-eyebrow">{entry.economicLabel}</p>
      <ol className="gm-howto-steps">
        {GAMES.howTo[id].map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
    </Sheet>
  );
}
