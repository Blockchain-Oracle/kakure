import type { Metadata } from "next";
import { RealtimeProof } from "@/features/proof/realtime-proof";

/** `/proof`: what this browser checks itself, every minute (plan §00). */
export const metadata: Metadata = { title: "Proof" };

export default function ProofPage() {
  return <RealtimeProof />;
}
