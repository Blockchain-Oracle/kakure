"use client";

import { Button } from "@kakure/ui-web";
import { LockOpen } from "lucide-react";
import { useState } from "react";
import { unlock } from "./vault-db";

/** Opens the vault lock for this tab (O23). Shown wherever tickets or chips are needed while the vault is locked. */
export function UnlockForm({ onUnlocked }: { onUnlocked?: () => void }) {
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);
  const submit = async () => {
    setBusy(true);
    const ok = await unlock(passphrase).catch(() => false);
    setBusy(false);
    setWrong(!ok);
    if (ok) {
      setPassphrase("");
      onUnlocked?.();
    }
  };
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (passphrase) void submit();
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-label text-muted-foreground">Vault passphrase</span>
        <input
          type="password"
          value={passphrase}
          onChange={(event) => {
            setPassphrase(event.target.value);
            setWrong(false);
          }}
          autoComplete="current-password"
          className="h-11 rounded-row bg-input px-4 text-row text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>
      {wrong ? (
        <p role="alert" className="text-row-detail text-destructive">
          That passphrase doesn't open the vault.
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="sm" className="w-fit" disabled={busy || !passphrase}>
        <LockOpen aria-hidden className="size-4" /> {busy ? "Unlocking…" : "Unlock"}
      </Button>
    </form>
  );
}
