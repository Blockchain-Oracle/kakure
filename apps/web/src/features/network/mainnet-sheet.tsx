"use client";

import { Sheet, SlideToConfirm } from "@kakure/ui-web";

/**
 * The deliberate step before real money (senryo.md §5.5: one sentence, then "Slide to use real money";
 * only the completed slide switches). Testnet is one tap back.
 */
export function MainnetSheet({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Switch to Mainnet">
      <p className="text-body text-foreground">Real ZEC from here.</p>
      <ul className="mt-4 flex flex-col gap-2 rounded-group bg-raised-2 p-4 text-row-detail text-muted-foreground">
        <li>On Mainnet you deposit real ZEC from your own wallet, and withdrawals pay out real ZEC.</li>
        <li>Testnet chips, positions and cached data stay separate on this device.</li>
        <li>You can switch back to Testnet with one tap.</li>
      </ul>
      <SlideToConfirm
        className="mt-6"
        label="Slide to use real money"
        hint="Switches the whole app to Mainnet"
        onConfirm={onConfirm}
      />
    </Sheet>
  );
}
