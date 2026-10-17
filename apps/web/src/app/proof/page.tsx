import type { Metadata } from "next";
import { ProofScreen } from "@/features/proof/proof-screen";

export const metadata: Metadata = { title: "Proof" };

export default function ProofPage() {
  return <ProofScreen />;
}
