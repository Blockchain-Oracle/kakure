"use client";

import { Eye, EyeOff, Volume2, VolumeX } from "lucide-react";
import { setPrefs, usePrefs } from "@/features/settings/prefs-store";

/** The rail footer's privacy eye and sound switch (surfaces.md App shell), one tap each. */
export function QuickToggles() {
  const prefs = usePrefs();
  const button =
    "kk-press grid size-11 place-items-center rounded-full bg-secondary text-foreground outline-none hover:bg-row-pressed focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4";
  return (
    <div className="flex flex-col gap-2 wide:flex-row">
      <button
        type="button"
        aria-pressed={prefs.hideAmounts}
        aria-label={prefs.hideAmounts ? "Show amounts" : "Hide amounts"}
        title={prefs.hideAmounts ? "Show amounts" : "Hide amounts"}
        onClick={() => setPrefs({ hideAmounts: !prefs.hideAmounts })}
        className={button}
      >
        {prefs.hideAmounts ? <EyeOff /> : <Eye />}
      </button>
      <button
        type="button"
        aria-pressed={!prefs.sound}
        aria-label={prefs.sound ? "Mute sounds" : "Turn sounds on"}
        title={prefs.sound ? "Mute sounds" : "Turn sounds on"}
        onClick={() => setPrefs({ sound: !prefs.sound })}
        className={button}
      >
        {prefs.sound ? <Volume2 /> : <VolumeX />}
      </button>
    </div>
  );
}
