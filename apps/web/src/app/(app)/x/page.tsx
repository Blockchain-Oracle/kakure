import type { Metadata } from "next";
import { XCallback } from "@/features/games/player/x-callback";

/** `/x`: Sign in with X's callback (plan §0 R7); the code leaves the address bar at once and is never cached. */
export const metadata: Metadata = { title: "Sign in with X", robots: { index: false } };

export default function XPage() {
  return <XCallback />;
}
