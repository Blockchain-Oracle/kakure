"use client";

import { Modal } from "@kakure/ui-web";
import { PLACES } from "./places";
import { setOverlay } from "./shell-store";

/** Every row is a shortcut that exists (Mitoshi ShortcutsModal): the places' digits, search, this list. */
const ROWS: ReadonlyArray<readonly [string, string]> = [
  ...PLACES.map((place, i) => [String(i + 1), `Go to ${place.name}`] as const),
  ["⌘ K", "Search markets and pages"],
  ["/", "Search markets and pages"],
  ["?", "Show these shortcuts"],
  ["esc", "Close a sheet or dialog"],
];

export function Shortcuts({ open }: { open: boolean }) {
  return (
    <Modal open={open} onClose={() => setOverlay(null)} title="Keyboard shortcuts">
      <dl className="kk-shortcuts">
        {ROWS.map(([keys, what]) => (
          <div key={`${keys}-${what}`} className="kk-shortcut">
            <dt>{what}</dt>
            <dd>
              <kbd className="kk-kbd">{keys}</kbd>
            </dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
