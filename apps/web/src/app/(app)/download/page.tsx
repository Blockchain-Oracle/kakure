import type { Metadata } from "next";
import { DownloadScreen } from "@/features/install/download-screen";
import { DOWNLOAD } from "@/features/install/words";
import "@/features/install/download.css";

export const metadata: Metadata = { title: DOWNLOAD.title, description: DOWNLOAD.description };

export default function DownloadPage() {
  return <DownloadScreen />;
}
