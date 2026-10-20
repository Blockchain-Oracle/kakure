import type { Metadata } from "next";
import { DemoScreen } from "@/features/demo/demo-screen";

/** `/demo`: the recorded walkthrough, served from this site (README's play button). */
export const metadata: Metadata = { title: "Demo" };

export default function DemoPage() {
  return <DemoScreen />;
}
