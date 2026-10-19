"use client";

import { cx, GlowToggle } from "@kakure/ui-web";
import { type MouseEvent, useCallback, useRef, useState } from "react";
import { NETWORK_LABEL } from "@/constants";
import { MainnetSheet } from "./mainnet-sheet";
import { centreOf, switchNetwork, useNetwork } from "./network-store";

/** The flood starts once the sheet has slid away, so it visibly spreads from the switch. */
function afterSheetExit(run: () => void) {
  const ms = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--duration-drawer-out"));
  setTimeout(run, Number.isFinite(ms) ? ms : 0);
}

/**
 * The network switch: the 21st cinematic glow toggle (the app's one sanctioned glow). Off is Testnet, on is Mainnet,
 * and on glows vermilion. One tap returns to Testnet; Mainnet asks for "Slide to use real money" first. Either way the
 * new world floods out from the switch. Its position follows <html data-network> in CSS (`.kk-net-toggle`), so the
 * prerendered page is never in the wrong state.
 */
export function NetworkSwitch({ labels = true, className }: { labels?: boolean; className?: string }) {
  const network = useNetwork();
  const [confirming, setConfirming] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const mainnet = network === "mainnet";

  const onToggle = (event: MouseEvent<HTMLButtonElement>) => {
    if (mainnet) {
      switchNetwork("testnet", event.detail > 0 ? { x: event.clientX, y: event.clientY } : centreOf(button.current));
    } else {
      setConfirming(true);
    }
  };

  const onConfirmed = useCallback(() => {
    setConfirming(false);
    afterSheetExit(() => switchNetwork("mainnet", centreOf(button.current)));
  }, []);

  return (
    <>
      <GlowToggle
        ref={button}
        checked={mainnet}
        onToggle={onToggle}
        label={`Network: ${NETWORK_LABEL[network]}. ${mainnet ? "Switch to Testnet" : "Switch to Mainnet (real ZEC)"}`}
        offLabel={labels ? "Test" : undefined}
        onLabel={labels ? "Main" : undefined}
        className={cx("kk-net-toggle", className)}
      />
      <MainnetSheet open={confirming} onClose={() => setConfirming(false)} onConfirm={onConfirmed} />
    </>
  );
}

/** The world's hanko: 試 (test) on Testnet, 本 (real) on Mainnet, in Noto Serif JP, as Mitoshi's mode stamp. */
export function NetworkHanko({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cx("kk-hanko", className)} lang="ja">
      <span className="kk-when-testnet">試</span>
      <span className="kk-when-mainnet">本</span>
    </span>
  );
}

/** Which world you are in, said in words (CSS picks the word from <html data-network>). */
export function NetworkWord() {
  return (
    <>
      <span className="kk-when-testnet">{NETWORK_LABEL.testnet}</span>
      <span className="kk-when-mainnet">{NETWORK_LABEL.mainnet}</span>
    </>
  );
}

/**
 * The rail head's network plate (Mitoshi ModePlate: a ticket torn from the rail, its stub holding the hanko): TESTNET
 * on vermilion, MAINNET on ink, with what the coin is worth; the glow switch sits under it.
 */
export function NetworkPlate() {
  return (
    <div className="kk-plate">
      <div className="kk-plate-ticket">
        <span className="kk-plate-stub">
          <NetworkHanko />
        </span>
        <span aria-hidden className="kk-plate-perf" />
        <span className="kk-plate-copy">
          <span className="kk-plate-label">
            <NetworkWord />
          </span>
          <span className="kk-plate-line">
            <span className="kk-when-testnet">TAZ · no value</span>
            <span className="kk-when-mainnet">Real ZEC</span>
          </span>
        </span>
      </div>
      <NetworkSwitch className="kk-plate-switch" />
    </div>
  );
}

/** The compact rail's stamp tile and switch (88 px rail). */
export function NetworkStamp() {
  return (
    <div className="kk-stamp">
      <span className="kk-stamp-tile" title="Network">
        <NetworkHanko />
        <span className="sr-only">
          <NetworkWord />
        </span>
      </span>
      <NetworkSwitch labels={false} />
    </div>
  );
}

/** The phone's network chip (Mitoshi ModeChip): the hanko and the word on the plate colour, not a button. */
export function NetworkChip() {
  return (
    <span className="kk-net-chip">
      <NetworkHanko className="kk-net-chip-hanko" />
      <span className="kk-net-chip-word">
        <NetworkWord />
      </span>
    </span>
  );
}
