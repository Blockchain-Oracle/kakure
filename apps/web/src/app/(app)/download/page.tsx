import type { Metadata } from "next";
import { DownloadScreen } from "@/features/download/download-screen";

export const metadata: Metadata = { title: "Get the app" };

export default function DownloadPage() {
  return <DownloadScreen />;
}
