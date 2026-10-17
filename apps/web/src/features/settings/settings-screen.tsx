"use client";

import { fire, hapticsAvailable } from "@kakure/sounds";
import { Button, SegmentedControl, Sheet, SlideToConfirm, Switch } from "@kakure/ui-web";
import { Download, Upload } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useCallback, useRef, useState, useSyncExternalStore } from "react";
import { NETWORK_LABEL } from "@/constants";
import { NetworkCapsule } from "@/features/network/network-capsule";
import { useNetwork } from "@/features/network/network-store";
import { ABOUT_LINKS } from "@/features/shell/nav-items";
import { downloadBlob, exportTickets, ImportError, importTickets } from "@/features/tickets/export";
import { reloadTickets } from "@/features/tickets/use-tickets";
import { forgetThisDevice } from "./forget";
import { setPrefs, usePrefs } from "./prefs-store";

/** Settings (surfaces.md): sound, haptics, motion, privacy eye, network, Tor guidance, backup, Forget this device. */
const PERCENT = 100;
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
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-5 py-6 rail:px-8 rail:py-8">
      <h1 className="font-display text-page-title text-foreground">Settings</h1>

      <Group title="Sound and haptics">
        <Row
          label="Sounds"
          detail="Money moments only: a bet built, odds released, a result. No sound for taps or navigation."
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
        <Row label="Motion" detail="Reduced turns travel into short fades and stops the springs.">
          <SegmentedControl
            label="Motion"
            size="sm"
            value={prefs.motion}
            onChange={(motion) => setPrefs({ motion })}
            options={[
              { value: "system", label: "System" },
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
          <NetworkCapsule />
        </Row>
      </Group>

      <Group title="Connection">
        <div className="flex flex-col gap-2 p-4 text-row-detail text-muted-foreground">
          <p>
            This site never sees your bets, but its host sees your IP address. To hide it, open Kakure in Tor Browser.
            An onion address isn't live yet; it will be listed here when it is.
          </p>
          <p>Your wallet's server sees your IP when you pay. Zodl can send over Tor: turn it on in Zodl's settings.</p>
        </div>
      </Group>

      <Backup network={network} />
      <Forget />

      <Group title="About">
        {ABOUT_LINKS.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className="flex items-center gap-3 p-4 text-row-strong text-foreground outline-none hover:bg-row-pressed focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-5"
          >
            {item.icon}
            {item.label}
          </Link>
        ))}
      </Group>
    </div>
  );
}

function Group({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} aria-label={title} className="flex flex-col gap-2">
      <h2 className="px-1 text-label text-muted-foreground">{title}</h2>
      <div className="flex flex-col divide-y divide-row-pressed rounded-group bg-card">{children}</div>
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

function Backup({ network }: { network: "mainnet" | "testnet" }) {
  const [passphrase, setPassphrase] = useState("");
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const ready = passphrase.length >= MIN_PASSPHRASE;

  const doExport = async () => {
    const { file: blob, name, count } = await exportTickets(network, passphrase);
    downloadBlob(blob, name);
    setMessage({
      text: `Exported ${count} ${NETWORK_LABEL[network]} ticket${count === 1 ? "" : "s"}. Keep the passphrase: without it the file can't be opened.`,
      bad: false,
    });
  };
  const doImport = async (chosen: File) => {
    try {
      const count = await importTickets(network, await chosen.text(), passphrase);
      reloadTickets();
      setMessage({ text: `Imported ${count} ticket${count === 1 ? "" : "s"}.`, bad: false });
    } catch (error) {
      setMessage({ text: error instanceof ImportError ? error.message : "That file couldn't be imported.", bad: true });
    }
  };

  return (
    <Group title="Backup" id="backup">
      <div className="flex flex-col gap-3 p-4">
        <p className="text-row-detail text-muted-foreground">
          Your tickets live only in this browser. Export them to an encrypted file to move them or keep a copy; it holds
          this network's tickets only, including their payout addresses and nonces.
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

function Forget() {
  const [open, setOpen] = useState(false);
  const confirm = useCallback(() => void forgetThisDevice(), []);
  return (
    <Group title="This device">
      <Row
        label="Forget this device"
        detail="Deletes every ticket, key, cached file and setting Kakure stored in this browser."
      >
        <Button variant="secondary" size="sm" className="text-destructive" onClick={() => setOpen(true)}>
          Forget
        </Button>
      </Row>
      <Sheet open={open} onClose={() => setOpen(false)} title="Forget this device">
        <p className="text-body text-foreground">
          Tickets can't be recovered after this unless you exported them. Payouts still go to the addresses in your
          bets; only this browser's records are erased.
        </p>
        <SlideToConfirm
          className="mt-6"
          label="Slide to forget"
          hint="Erases Kakure's data in this browser"
          onConfirm={confirm}
        />
      </Sheet>
    </Group>
  );
}
