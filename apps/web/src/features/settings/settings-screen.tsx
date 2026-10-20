"use client";

import { zatToZec } from "@kakure/domain";
import { fire, hapticsAvailable } from "@kakure/sounds";
import { Button, SegmentedControl, Sheet, SlideToConfirm, Switch } from "@kakure/ui-web";
import { Download, Lock, Upload } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useCallback, useRef, useState, useSyncExternalStore } from "react";
import { NETWORK_COIN, NETWORK_LABEL } from "@/constants";
import { useNetwork } from "@/features/network/network-store";
import { NetworkSwitch } from "@/features/network/network-switch";
import { NAV_ICONS } from "@/features/shell/nav-icons";
import { MORE_ITEMS } from "@/features/shell/places";
import { ThemeControl } from "@/features/theme/theme-control";
import { type BackupSummary, downloadBlob, exportVault, ImportError, importVault } from "@/features/vault/backup";
import { UnlockForm } from "@/features/vault/unlock-form";
import { useLockState } from "@/features/vault/use-lock";
import { lockNow, removeLock, setLock, VaultLockedError } from "@/features/vault/vault-db";
import { useWallet } from "@/features/wallet/wallet-store";
import { forgetThisDevice, type TakeDown, takeDownPublished } from "./forget";
import { setPrefs, usePrefs } from "./prefs-store";

/** Settings (surfaces.md): sound, haptics, motion, privacy eye, network, Tor guidance, backup, Forget this device. */
const PERCENT = 100;
const ABOUT = MORE_ITEMS.filter((item) => item.id === "proof" || item.id === "privacy" || item.id === "download");
const MIN_PASSPHRASE = 8;
const noSubscription = () => () => undefined;

/** Read after hydration, so the prerendered page and the browser agree. */
function useHapticsAvailable(): boolean {
  return useSyncExternalStore(noSubscription, hapticsAvailable, () => false);
}

export function SettingsScreen() {
  const prefs = usePrefs();
  const network = useNetwork();
  const canVibrate = useHapticsAvailable();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <h1 className="font-display text-page-title text-foreground">Settings</h1>

      <Group title="Sound and haptics">
        <Row
          label="Sounds"
          detail="Buys, closes, results and deposits landing, the live calls while you hold a position, and a soft tick on terminal taps."
        >
          <Switch label="Sounds" checked={prefs.sound} onChange={(sound) => setPrefs({ sound })} />
        </Row>
        <Row label="Volume" detail={`${Math.round(prefs.volume * PERCENT)} %`}>
          <input
            type="range"
            min={0}
            max={PERCENT}
            value={Math.round(prefs.volume * PERCENT)}
            onChange={(event) => setPrefs({ volume: Number(event.target.value) / PERCENT })}
            onPointerUp={() => fire("confirmed")}
            disabled={!prefs.sound}
            aria-label="Volume"
            className="w-36 accent-(--accent) disabled:opacity-50"
          />
        </Row>
        <Row
          label="Sound ladder"
          detail="While a position is open, rising notes as the price moves your way and a low blip when it doesn't."
        >
          <Switch label="Sound ladder" checked={prefs.ladder} onChange={(ladder) => setPrefs({ ladder })} />
        </Row>
        <Row
          label="Haptics"
          detail={
            canVibrate
              ? "Vibration with each sound."
              : "This browser can't vibrate (iPhone browsers can't); the Kakure app can."
          }
        >
          <Switch label="Haptics" checked={prefs.haptics} onChange={(haptics) => setPrefs({ haptics })} />
        </Row>
      </Group>

      <Group title="Display">
        <Row label="Theme" detail="Dark by default; cream light; or follow this device.">
          <ThemeControl />
        </Row>
        <Row label="Motion" detail="Reduced turns travel into short fades and stops the springs.">
          <SegmentedControl
            label="Motion"
            size="sm"
            value={prefs.motion}
            onChange={(motion) => setPrefs({ motion })}
            options={[
              { value: "system", label: "System" },
              { value: "full", label: "Full" },
              { value: "reduce", label: "Reduced" },
            ]}
          />
        </Row>
        <Row
          label="Hide amounts"
          detail="Removes amounts from the page (not just blurred), for screenshots and shoulders."
        >
          <Switch
            label="Hide amounts"
            checked={prefs.hideAmounts}
            onChange={(hideAmounts) => setPrefs({ hideAmounts })}
          />
        </Row>
      </Group>

      <Group title="Network">
        <Row
          label={NETWORK_LABEL[network]}
          detail="Testnet uses TAZ, which has no value. Mainnet is real ZEC and asks for a slide first."
        >
          <NetworkSwitch />
        </Row>
      </Group>

      <Group title="Connection">
        <div className="flex flex-col gap-2 p-4 text-row-detail text-muted-foreground">
          <p>
            This site never sees your bets, but its host sees your IP address. To hide it, open Kakure in Tor Browser.
            An onion address isn't live yet; it will be listed here when it is.
          </p>
          <p>
            Your wallet's server sees your IP when your wallet syncs and when you pay, and which transactions it
            fetches. Zodl can send over Tor: turn it on in Zodl's settings.
          </p>
        </div>
      </Group>

      <Backup network={network} />
      <VaultLock />
      <Forget network={network} />

      <Group title="About">
        {ABOUT.map((item) => {
          const Icon = NAV_ICONS[item.id];
          return (
            <Link
              key={item.id}
              href={item.href}
              className="flex items-center gap-3 p-4 text-row-strong text-foreground outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-5"
            >
              <Icon aria-hidden className="text-muted-foreground" />
              {item.name}
            </Link>
          );
        })}
      </Group>
    </div>
  );
}

function Group({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} aria-label={title} className="flex flex-col gap-2">
      <h2 className="px-1 text-label text-muted-foreground">{title}</h2>
      <div className="flex flex-col divide-y divide-border rounded-group border border-border bg-card">{children}</div>
    </section>
  );
}

function Row({ label, detail, children }: { label: string; detail?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 p-4">
      <div className="min-w-0">
        <div className="text-row-strong text-foreground">{label}</div>
        {detail ? <div className="mt-0.5 text-row-detail text-muted-foreground">{detail}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** "3 tickets and 0.35 TAZ in chips", or "nothing" for an empty vault. */
function describe(summary: BackupSummary, coin: string): string {
  const parts = [
    summary.chips > 0 ? `${zatToZec(BigInt(summary.chipZat))} ${coin} in chips` : null,
    summary.positions > 0 ? `${summary.positions} position${summary.positions === 1 ? "" : "s"}` : null,
    summary.tickets > 0 ? `${summary.tickets} ticket${summary.tickets === 1 ? "" : "s"}` : null,
    summary.inFlight > 0 ? `${summary.inFlight} deposit${summary.inFlight === 1 ? "" : "s"} or spends in flight` : null,
  ].filter((part) => part !== null);
  return parts.length === 0 ? "nothing" : parts.join(", ");
}

function Backup({ network }: { network: "mainnet" | "testnet" }) {
  const [passphrase, setPassphrase] = useState("");
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const ready = passphrase.length >= MIN_PASSPHRASE;
  const coin = NETWORK_COIN[network];
  const locked = "Your vault is locked. Unlock it below first.";

  const doExport = async () => {
    try {
      const { file: blob, name, summary } = await exportVault(network, passphrase);
      downloadBlob(blob, name);
      setMessage({
        text: `Exported ${describe(summary, coin)} on ${NETWORK_LABEL[network]}. Keep the passphrase: without it the file can't be opened.`,
        bad: false,
      });
    } catch (error) {
      setMessage({
        text: error instanceof VaultLockedError ? locked : "This browser can't open the vault.",
        bad: true,
      });
    }
  };
  const doImport = async (chosen: File) => {
    try {
      const summary = await importVault(network, await chosen.text(), passphrase);
      setMessage({
        text:
          summary.chips > 0
            ? `Imported ${describe(summary, coin)}. Chips join your balance once the mint confirms they weren't spent since.`
            : `Imported ${describe(summary, coin)}.`,
        bad: false,
      });
    } catch (error) {
      setMessage({
        text:
          error instanceof ImportError
            ? error.message
            : error instanceof VaultLockedError
              ? locked
              : "That file couldn't be imported.",
        bad: true,
      });
    }
  };

  return (
    <Group title="Backup" id="backup">
      <div className="flex flex-col gap-3 p-4">
        <p className="text-row-detail text-muted-foreground">
          Your chips and positions live only in this browser. Export them to an encrypted file to move them or keep a
          copy: it holds this network's chips (they're money: whoever has the file and its passphrase can spend them),
          open positions, deposits and withdrawals in flight, and any tickets from the earlier pool markets.
        </p>
        <label className="flex flex-col gap-1.5">
          <span className="text-label text-muted-foreground">Passphrase (at least {MIN_PASSPHRASE} characters)</span>
          <input
            type="password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            autoComplete="new-password"
            className="h-11 rounded-row bg-input px-4 text-row text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => (ready ? void doExport() : setMessage({ text: "Enter a passphrase first.", bad: true }))}
          >
            <Download aria-hidden className="size-4" /> Export
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              ready ? file.current?.click() : setMessage({ text: "Enter the file's passphrase first.", bad: true })
            }
          >
            <Upload aria-hidden className="size-4" /> Import
          </Button>
        </div>
        <input
          ref={file}
          type="file"
          accept=".kakure,application/json"
          className="hidden"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            if (chosen) void doImport(chosen);
            event.target.value = "";
          }}
        />
        {message ? (
          <p
            role="status"
            className={message.bad ? "text-row-detail text-destructive" : "text-row-detail text-foreground"}
          >
            {message.text}
          </p>
        ) : null}
      </div>
    </Group>
  );
}

const INPUT =
  "h-11 rounded-row bg-input px-4 text-row text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The optional passphrase lock for this device's vault (O23, plan §13.17): chips and tickets. Off by default: the
 * vault is encrypted either way, but without the lock its key sits beside the data in this browser.
 */
function VaultLock() {
  const state = useLockState();
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const ready = passphrase.length >= MIN_PASSPHRASE;

  const run = async (action: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await action();
      setPassphrase("");
      setMessage({ text: done, bad: false });
    } catch {
      setMessage({ text: "That didn't work, so nothing changed. Try again.", bad: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Group title="Vault lock" id="lock">
      <div className="flex flex-col gap-3 p-4">
        <p className="text-row-detail text-muted-foreground">
          {state === "off"
            ? "Your chips and positions are encrypted in this browser, but the key sits next to them. Add a passphrase and the key is kept only wrapped by it: you'll enter it once per tab to trade or see your positions. Forget it and only an exported backup brings them back."
            : state === "locked"
              ? "Your vault is locked. Enter the passphrase to open it in this tab."
              : "Your vault is open in this tab and locks again when it closes."}
        </p>
        {state === "locked" ? (
          <UnlockForm onUnlocked={() => setMessage({ text: "Unlocked for this tab.", bad: false })} />
        ) : state === null ? null : (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="text-label text-muted-foreground">
                {state === "off" ? "New passphrase" : "New passphrase (to change it)"} (at least {MIN_PASSPHRASE}{" "}
                characters)
              </span>
              <input
                type="password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                autoComplete="new-password"
                className={INPUT}
              />
            </label>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || !ready}
                onClick={() =>
                  void run(
                    () => setLock(passphrase),
                    state === "off" ? "Locked. Keep the passphrase somewhere safe." : "Passphrase changed.",
                  )
                }
              >
                <Lock aria-hidden className="size-4" />{" "}
                {state === "off" ? "Lock with a passphrase" : "Change passphrase"}
              </Button>
              {state === "unlocked" ? (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      lockNow();
                      setMessage({ text: "Locked.", bad: false });
                    }}
                  >
                    Lock now
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => void run(removeLock, "The lock is off.")}
                  >
                    Turn the lock off
                  </Button>
                </>
              ) : null}
            </div>
          </>
        )}
        {message ? (
          <p
            role="status"
            className={message.bad ? "text-row-detail text-destructive" : "text-row-detail text-foreground"}
          >
            {message.text}
          </p>
        ) : null}
      </div>
    </Group>
  );
}

function Forget({ network }: { network: "mainnet" | "testnet" }) {
  const [open, setOpen] = useState(false);
  const wallet = useWallet(network);
  // Published Bets calls come down first; when any couldn't, or the vault is locked, the sheet asks again.
  const [left, setLeft] = useState<TakeDown | null>(null);
  const confirm = useCallback(async () => {
    const takeDown = await takeDownPublished();
    if (takeDown.stranded > 0 || takeDown.locked) setLeft(takeDown);
    else await forgetThisDevice();
  }, []);
  const forgetAnyway = useCallback(() => void forgetThisDevice(), []);
  const coin = NETWORK_COIN[network];
  return (
    <Group title="This device">
      <Row
        label="Forget this device"
        detail="Deletes every chip, position, key, cached file and setting Kakure stored in this browser."
      >
        <Button variant="secondary" size="sm" className="text-destructive" onClick={() => setOpen(true)}>
          Forget
        </Button>
      </Row>
      <Sheet open={open} onClose={() => setOpen(false)} title="Forget this device">
        {wallet.balanceZat > 0 ? (
          <p className="mb-4 rounded-row bg-warn-surface p-3 text-body text-foreground">
            You hold {zatToZec(BigInt(wallet.balanceZat))} {coin} in chips on {NETWORK_LABEL[network]}. Chips exist only
            on this device: withdraw them or export a backup first, or they're gone for good.
          </p>
        ) : null}
        <p className="text-body text-foreground">
          Chips and tickets can't be recovered after this unless you exported a backup. Payouts already scheduled still
          arrive; only this browser's records are erased. Calls you published to the Bets board are taken down first,
          and come off at the week's turn.
        </p>
        {left ? (
          <>
            <p role="alert" className="mt-4 rounded-row bg-warn-surface p-3 text-body text-foreground">
              {left.locked
                ? "Your vault is locked, so this device can't take its published Bets calls down. Unlock it and try again, or forget anyway: any calls it published stay on the board for good."
                : `${left.stranded} published Bets call${left.stranded === 1 ? "" : "s"} couldn't be taken down (the arcade didn't answer). Try again later, or forget anyway: they stay on the board for good.`}
            </p>
            <SlideToConfirm
              className="mt-6"
              label="Slide to forget anyway"
              hint="Erases Kakure's data in this browser"
              onConfirm={forgetAnyway}
            />
          </>
        ) : (
          <SlideToConfirm
            className="mt-6"
            label="Slide to forget"
            hint="Takes your Bets calls down, then erases Kakure's data in this browser"
            onConfirm={() => void confirm()}
          />
        )}
      </Sheet>
    </Group>
  );
}
