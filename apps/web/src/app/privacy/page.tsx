import type { Metadata } from "next";
import { PrivacyScreen } from "@/features/privacy/privacy-screen";

export const metadata: Metadata = { title: "How privacy works" };

export default function PrivacyPage() {
  return <PrivacyScreen />;
}
