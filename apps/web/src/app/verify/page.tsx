import type { Metadata } from "next";
import { VerifyScreen } from "@/features/verify/verify-screen";

/** `/verify#<receipt>`: the receipt stays in the fragment, which browsers never send to the host. */
export const metadata: Metadata = { title: "Verify" };

export default function VerifyPage() {
  return <VerifyScreen />;
}
