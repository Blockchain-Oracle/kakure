import type { Metadata } from "next";
import { StatusScreen } from "@/features/status/status-screen";

export const metadata: Metadata = { title: "Status" };

export default function StatusPage() {
  return <StatusScreen />;
}
