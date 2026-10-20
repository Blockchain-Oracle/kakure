"use client";

import { buttonClass } from "@kakure/ui-web";
import { Download } from "lucide-react";
import { Fragment, useState } from "react";
import { useInstallPrompt } from "./install-store";
import { INSTALL, installWhere } from "./words";
import "./install.css";

/**
 * The web app's one action (Mitoshi `features/install/InstallCta.tsx`, Owarine's `InstallCta`), made stateful: the
 * browser decides what it does, and it never claims a store. A held prompt opens the browser's install sheet; on an
 * iPhone it shows Safari's three steps and the storage note; once installed it says so. With no prompt it is not a
 * button at all: it names where this browser keeps "install" (the menu path as key caps, 21st.dev ai2/kbd-combo's
 * SequenceKbd as Mitoshi uses it), or where to go instead. `fill` keeps the pill full width (the terminal's sheet).
 */
export function InstallCta({ primary = false, fill = false }: { primary?: boolean; fill?: boolean }) {
  const { state, hint, install, busy } = useInstallPrompt();
  const [open, setOpen] = useState(false);
  const pill = buttonClass(primary ? "primary" : "secondary", "md", fill ? "w-full" : "w-full md:w-fit");
  const view = state === "manual" ? hint : state;

  if (view === "installed") return <p className="get-done">{INSTALL.cta.installed}</p>;

  if (view === "prompt") {
    return (
      <button type="button" className={pill} disabled={busy} aria-busy={busy} onClick={() => void install()}>
        {busy ? INSTALL.cta.installing : INSTALL.cta.prompt}
        <Download aria-hidden className="size-4" />
      </button>
    );
  }

  if (view === "ios") {
    return (
      <div className="get-install">
        <button type="button" className={pill} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {INSTALL.cta.ios}
          <Download aria-hidden className="size-4" />
        </button>
        {open ? (
          <>
            <ol className="get-steps">
              {INSTALL.iosSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <p className="get-note">{INSTALL.iosStorage}</p>
          </>
        ) : null}
      </div>
    );
  }

  const where = installWhere(view);
  if (!where) return <p className="get-how">{INSTALL.elsewhere}</p>;
  return (
    <p className="get-how">
      <Download aria-hidden className="get-how-icon" />
      <span>{where.in}:</span>
      <kbd className="get-path">
        <span className="sr-only">
          {where.path.map((step) => ("label" in step ? step.label : step.item)).join(", then ")}
        </span>
        <span aria-hidden className="get-path-keys">
          {where.path.map((step, i) => (
            <Fragment key={step.item}>
              {i > 0 ? <span className="get-path-then">→</span> : null}
              <kbd>{step.item}</kbd>
            </Fragment>
          ))}
        </span>
      </kbd>
    </p>
  );
}
